using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Viritura.Api.Mcp;
using Xunit;

namespace Viritura.Api.Tests;

public sealed class McpSessionRegistryTests
{
    [Fact]
    public async Task HeartbeatsRenewTheLease_ReconnectPreservesIdentity_AndExpiredSessionsStayExpired()
    {
        var clock = new AdjustableClock(DateTimeOffset.UtcNow);
        using var registry = new McpSessionRegistry(clock);
        Assert.True(registry.TryCreate("user", out var registration));
        Assert.NotNull(registration);
        await WithHostAsync(registry, registration, async (first, token) =>
        {
            clock.Advance(TimeSpan.FromMinutes(59));
            first.SendToServer(new { type = "heartbeat" });
            Assert.Equal("heartbeat_ack", await first.ReadTypeAsync(token));
            clock.Advance(TimeSpan.FromMinutes(2));
            Assert.True(registry.Exists(registration.SessionId));
        });
        clock.Advance(TimeSpan.FromMinutes(5));
        Assert.True(registry.CanResumeHost(registration.SessionId, registration.HostToken));
        Assert.False(registry.CanResumeHost(registration.SessionId, "wrong-token"));
        Assert.True(registry.TryResolveOwnedSession(registration.SessionId, "user", false, out var owned));
        Assert.Equal(registration.SessionId, owned);
        var offline = await Assert.ThrowsAsync<McpRelayException>(() =>
            registry.InvokeToolAsync(registration.SessionId, "score.overview", JsonSerializer.SerializeToElement(new { }), CancellationToken.None));
        Assert.Equal("editor_offline", offline.Code);

        await WithHostAsync(registry, registration, (second, _) =>
        {
            clock.Advance(TimeSpan.FromHours(1) + TimeSpan.FromMinutes(1));
            Assert.False(registry.Exists(registration.SessionId));
            second.SendToServer(new { type = "heartbeat" });
            return Task.CompletedTask;
        });
        Assert.False(registry.CanResumeHost(registration.SessionId, registration.HostToken));
        var expired = await Assert.ThrowsAsync<McpRelayException>(() =>
            registry.InvokeToolAsync(registration.SessionId, "score.overview", JsonSerializer.SerializeToElement(new { }), CancellationToken.None));
        Assert.Equal("session_not_found", expired.Code);
    }

    [Fact]
    public async Task DisconnectedAndUnattachedRegistrationsExpire()
    {
        var clock = new AdjustableClock(DateTimeOffset.UtcNow);
        using var registry = new McpSessionRegistry(clock);
        Assert.True(registry.TryCreate("user", out var unused));
        clock.Advance(TimeSpan.FromMinutes(3));
        Assert.False(registry.Exists(unused!.SessionId));
        Assert.True(registry.TryCreate("user", out var connected));
        Assert.NotNull(connected);
        await WithHostAsync(registry, connected, (_, _) => Task.CompletedTask);
        clock.Advance(TimeSpan.FromMinutes(11));
        Assert.False(registry.Exists(connected.SessionId));
        Assert.True(registry.TryCreate("user", out _));
    }

    [Fact]
    public async Task AuthenticatedReconnectReplacesAnUnresponsiveHostAndFailsInterruptedCalls()
    {
        using var registry = new McpSessionRegistry();
        Assert.True(registry.TryCreate("user", out var registration));
        Assert.NotNull(registration);
        using var first = new ScriptedSocket();
        using var second = new ScriptedSocket();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
#pragma warning disable CA2025 // Both host tasks are awaited in finally before their sockets are disposed.
        var oldHost = registry.AuthenticateAndRunHostAsync(registration.SessionId, first, timeout.Token);
        Task<bool>? newHost = null;
#pragma warning restore CA2025
        try
        {
            first.SendToServer(new { type = "authenticate", hostToken = registration.HostToken });
            Assert.Equal("ready", await first.ReadTypeAsync(timeout.Token));
            var interrupted = registry.InvokeToolAsync(
                registration.SessionId, "score.overview", JsonSerializer.SerializeToElement(new { }), timeout.Token);
            Assert.Equal("tool_call", await first.ReadTypeAsync(timeout.Token));
#pragma warning disable CA2025 // The new host task is awaited in finally before its socket is disposed.
            newHost = registry.AuthenticateAndRunHostAsync(registration.SessionId, second, timeout.Token);
#pragma warning restore CA2025
            second.SendToServer(new { type = "authenticate", hostToken = registration.HostToken });
            Assert.Equal("ready", await second.ReadTypeAsync(timeout.Token));
            var error = await Assert.ThrowsAsync<McpRelayException>(() => interrupted);
            Assert.Equal("editor_offline", error.Code);
            Assert.True(first.WasAborted);
            second.SendToServer(new { type = "heartbeat" });
            Assert.Equal("heartbeat_ack", await second.ReadTypeAsync(timeout.Token));
        }
        finally
        {
            first.Disconnect();
            second.Disconnect();
            await oldHost;
            if (newHost is not null) await newHost;
        }
    }

    [Fact]
    public async Task ReconnectDoesNotSendQueuedOldCallsOrFailNewCalls()
    {
        using var registry = new McpSessionRegistry();
        Assert.True(registry.TryCreate("user", out var registration));
        Assert.NotNull(registration);
        using var first = new ScriptedSocket();
        using var second = new ScriptedSocket();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
#pragma warning disable CA2025 // Both host tasks are awaited in finally before their sockets are disposed.
        var oldHost = registry.AuthenticateAndRunHostAsync(registration.SessionId, first, timeout.Token);
        Task<bool>? newHost = null;
#pragma warning restore CA2025
        try
        {
            first.SendToServer(new { type = "authenticate", hostToken = registration.HostToken });
            Assert.Equal("ready", await first.ReadTypeAsync(timeout.Token));
            first.PauseNextSend();
            var inFlight = registry.InvokeToolAsync(
                registration.SessionId, "score.overview", JsonSerializer.SerializeToElement(new { }), timeout.Token);
            Assert.Equal("tool_call", await first.ReadTypeAsync(timeout.Token));
            var queued = registry.InvokeToolAsync(
                registration.SessionId, "score.overview", JsonSerializer.SerializeToElement(new { }), timeout.Token);

#pragma warning disable CA2025 // The new host task is awaited in finally before its socket is disposed.
            newHost = registry.AuthenticateAndRunHostAsync(registration.SessionId, second, timeout.Token);
#pragma warning restore CA2025
            second.SendToServer(new { type = "authenticate", hostToken = registration.HostToken });
            await first.Aborted.WaitAsync(timeout.Token);
            first.ResumeSend();
            Assert.Equal("ready", await second.ReadTypeAsync(timeout.Token));
            Assert.Equal("editor_offline", (await Assert.ThrowsAsync<McpRelayException>(() => inFlight)).Code);
            Assert.Equal("editor_offline", (await Assert.ThrowsAsync<McpRelayException>(() => queued)).Code);
            Assert.False(first.HasPendingSend);

            var current = registry.InvokeToolAsync(
                registration.SessionId, "score.overview", JsonSerializer.SerializeToElement(new { }), timeout.Token);
            var call = await second.ReadMessageAsync(timeout.Token);
            Assert.Equal("tool_call", call.GetProperty("type").GetString());
            second.SendToServer(new
            {
                type = "tool_result",
                requestId = call.GetProperty("requestId").GetString(),
                result = new { ok = true }
            });
            Assert.True((await current).GetProperty("ok").GetBoolean());
        }
        finally
        {
            first.ResumeSend();
            first.Disconnect();
            second.Disconnect();
            await oldHost;
            if (newHost is not null) await newHost;
        }
    }

    [Fact]
    public async Task StoppingSessionWhileSendingFailsTheCallWithoutDisposingItsSemaphoreEarly()
    {
        using var registry = new McpSessionRegistry();
        Assert.True(registry.TryCreate("user", out var registration));
        Assert.NotNull(registration);
        await WithHostAsync(registry, registration, async (socket, token) =>
        {
            socket.PauseNextSend();
            var call = registry.InvokeToolAsync(
                registration.SessionId, "score.overview", JsonSerializer.SerializeToElement(new { }), token);
            Assert.Equal("tool_call", await socket.ReadTypeAsync(token));
            Assert.True(registry.Stop(registration.SessionId));
            socket.ResumeSend();
            Assert.Equal("session_stopped", (await Assert.ThrowsAsync<McpRelayException>(() => call)).Code);
        });
    }

    private static async Task WithHostAsync(
        McpSessionRegistry registry,
        McpSessionRegistration registration,
        Func<ScriptedSocket, CancellationToken, Task> action)
    {
        using var socket = new ScriptedSocket();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
#pragma warning disable CA2025 // The host task is awaited in finally before the socket is disposed.
        var host = registry.AuthenticateAndRunHostAsync(registration.SessionId, socket, timeout.Token);
#pragma warning restore CA2025
        try
        {
            socket.SendToServer(new { type = "authenticate", hostToken = registration.HostToken });
            Assert.Equal("ready", await socket.ReadTypeAsync(timeout.Token));
            await action(socket, timeout.Token);
        }
        finally
        {
            socket.Disconnect();
            var authenticated = await host;
            Assert.True(authenticated);
        }
    }

    private sealed class AdjustableClock(DateTimeOffset initial) : TimeProvider
    {
        private long _ticks = initial.UtcTicks;
        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);
        public void Advance(TimeSpan amount) => Interlocked.Add(ref _ticks, amount.Ticks);
    }

    private sealed class ScriptedSocket : WebSocket
    {
        private readonly Channel<byte[]?> _incoming = Channel.CreateUnbounded<byte[]?>();
        private readonly Channel<string> _outgoing = Channel.CreateUnbounded<string>();
        private readonly TaskCompletionSource _aborted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _resumeSend = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private WebSocketState _state = WebSocketState.Open;
        private int _pauseNextSend;
        public bool WasAborted { get; private set; }
        public Task Aborted => _aborted.Task;
        public bool HasPendingSend => _outgoing.Reader.TryPeek(out _);

        public override WebSocketCloseStatus? CloseStatus => null;
        public override string? CloseStatusDescription => null;
        public override WebSocketState State => _state;
        public override string? SubProtocol => null;

        public void SendToServer(object value) => _incoming.Writer.TryWrite(JsonSerializer.SerializeToUtf8Bytes(value));
        public void Disconnect() => _incoming.Writer.TryWrite(null);
        public void PauseNextSend() => Interlocked.Exchange(ref _pauseNextSend, 1);
        public void ResumeSend() => _resumeSend.TrySetResult();
        public async Task<string?> ReadTypeAsync(CancellationToken cancellationToken)
            => (await ReadMessageAsync(cancellationToken)).GetProperty("type").GetString();
        public async Task<JsonElement> ReadMessageAsync(CancellationToken cancellationToken)
        {
            var message = await _outgoing.Reader.ReadAsync(cancellationToken);
            using var document = JsonDocument.Parse(message);
            return document.RootElement.Clone();
        }

        public override async Task<WebSocketReceiveResult> ReceiveAsync(
            ArraySegment<byte> buffer,
            CancellationToken cancellationToken)
        {
            var payload = await _incoming.Reader.ReadAsync(cancellationToken);
            if (payload is null)
            {
                _state = WebSocketState.CloseReceived;
                return new WebSocketReceiveResult(0, WebSocketMessageType.Close, true);
            }
            payload.CopyTo(buffer.Array!, buffer.Offset);
            return new WebSocketReceiveResult(payload.Length, WebSocketMessageType.Text, true);
        }

        public override Task SendAsync(
            ArraySegment<byte> buffer,
            WebSocketMessageType messageType,
            bool endOfMessage,
            CancellationToken cancellationToken)
        {
            _outgoing.Writer.TryWrite(Encoding.UTF8.GetString(buffer));
            return Interlocked.Exchange(ref _pauseNextSend, 0) == 1 ? _resumeSend.Task : Task.CompletedTask;
        }

        public override Task CloseAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
        {
            _state = WebSocketState.Closed;
            return Task.CompletedTask;
        }

        public override Task CloseOutputAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken) =>
            CloseAsync(closeStatus, statusDescription, cancellationToken);

        public override void Abort()
        {
            WasAborted = true;
            _state = WebSocketState.Aborted;
            _aborted.TrySetResult();
            Disconnect();
        }
        public override void Dispose() => _state = WebSocketState.Closed;
    }
}
