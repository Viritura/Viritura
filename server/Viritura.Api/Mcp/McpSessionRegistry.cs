using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Viritura.Api.Mcp;

internal sealed record McpSessionRegistration(
    string SessionId,
    string HostToken,
    DateTimeOffset ExpiresAt);

internal sealed record McpBrowserSession(
    string SessionId,
    string? Title,
    string? FileName,
    string? DocumentId,
    bool Focused,
    DateTimeOffset ConnectedAt,
    bool DuplicateDocument);

/// <summary>
/// In-memory rendezvous between one browser host and MCP HTTP callers. The
/// score never resides here: requests are forwarded to the authoritative tab.
/// Sessions intentionally disappear on restart and after a short idle window.
/// </summary>
internal sealed class McpSessionRegistry : IDisposable
{
    private static readonly TimeSpan RegistrationLifetime = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(1);
    private static readonly TimeSpan ToolTimeout = TimeSpan.FromMinutes(2);
    private const int MaxRegistrations = 512;
    private const int MaxRegistrationsPerUser = 16;
    private const int MaxConnectedSessionsPerUser = 8;
    private const int MaxConcurrentToolsPerSession = 4;
    private const int MaxHostResultBytes = 16 * 1024 * 1024;
    private const string DevelopmentUserKey = "\0development-user";
    private readonly ConcurrentDictionary<string, Session> _sessions = new(StringComparer.Ordinal);
    private readonly object _capacityLock = new();
    private readonly Timer _sweeper;

    public McpSessionRegistry()
    {
        _sweeper = new Timer(_ => SweepExpired(), null, TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(2));
    }

    public bool TryCreate(string? userId, out McpSessionRegistration? registration)
    {
        lock (_capacityLock)
        {
            SweepExpiredCore(DateTimeOffset.UtcNow);
            var userKey = userId ?? DevelopmentUserKey;
            if (_sessions.Count >= MaxRegistrations
                || _sessions.Values.Count(session => session.UserKey == userKey) >= MaxRegistrationsPerUser)
            {
                registration = null;
                return false;
            }

            while (true)
            {
                var id = RandomToken(24);
                var hostToken = RandomToken(32);
                var session = new Session(
                    id,
                    hostToken,
                    userId,
                    DateTimeOffset.UtcNow.Add(RegistrationLifetime));
                if (_sessions.TryAdd(id, session))
                {
                    registration = new McpSessionRegistration(
                        session.Id,
                        hostToken,
                        session.ExpiresAt);
                    return true;
                }
            }
        }
    }

    public bool Exists(string sessionId) =>
        _sessions.TryGetValue(sessionId, out var session) && session.ExpiresAt > DateTimeOffset.UtcNow;

    public bool CanAuthorizeOAuth(string sessionId, string? userId, bool isDevelopment) =>
        _sessions.TryGetValue(sessionId, out var session)
        && session.ExpiresAt > DateTimeOffset.UtcNow
        && (string.Equals(session.UserId, userId, StringComparison.Ordinal)
            || (isDevelopment && session.UserId is null));

    public static bool CanAuthorizeStaticOAuth(string? userId, bool isDevelopment) =>
        isDevelopment || !string.IsNullOrEmpty(userId);

    public IReadOnlyList<McpBrowserSession> ListConnectedSessions(string? userId, bool isDevelopment)
    {
        var userKey = UserKey(userId, isDevelopment);
        if (userKey is null)
        {
            return [];
        }

        var sessions = _sessions.Values
            .Where(session => session.ExpiresAt > DateTimeOffset.UtcNow
                && session.IsHostConnected
                && string.Equals(session.UserKey, userKey, StringComparison.Ordinal))
            .OrderByDescending(session => session.HostAttachedAt)
            .ToArray();
        var duplicateIds = sessions
            .Where(session => session.Metadata.DocumentId is not null)
            .GroupBy(session => session.Metadata.DocumentId, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToHashSet(StringComparer.Ordinal);

        return sessions.Select(session => new McpBrowserSession(
            session.Id,
            session.Metadata.Title,
            session.Metadata.FileName,
            session.Metadata.DocumentId,
            session.Metadata.Focused,
            new DateTimeOffset(session.HostAttachedAt, TimeSpan.Zero),
            session.Metadata.DocumentId is not null && duplicateIds.Contains(session.Metadata.DocumentId)))
            .ToArray();
    }

    public bool TryResolveOwnedSession(
        string requestedSessionId,
        string? userId,
        bool isDevelopment,
        out string sessionId)
    {
        var userKey = UserKey(userId, isDevelopment);
        if (userKey is not null && IsConnectedSessionForUser(requestedSessionId, userKey))
        {
            sessionId = requestedSessionId;
            return true;
        }

        sessionId = string.Empty;
        return false;
    }

    public async Task<bool> AuthenticateAndRunHostAsync(
        string sessionId,
        WebSocket socket,
        CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionId, out var session) || session.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            return false;
        }

        var firstMessage = await ReceiveJsonAsync(socket, maxBytes: 4 * 1024, cancellationToken);
        if (firstMessage is null
            || !firstMessage.Value.TryGetProperty("type", out var type)
            || type.GetString() != "authenticate"
            || !firstMessage.Value.TryGetProperty("hostToken", out var suppliedToken)
            || !FixedTimeEquals(session.HostToken, suppliedToken.GetString()))
        {
            return false;
        }

        session.UpdateMetadata(firstMessage.Value);

        lock (_capacityLock)
        {
            var connectedForUser = _sessions.Values.Count(candidate =>
                candidate.IsHostConnected && candidate.UserKey == session.UserKey);
            if (connectedForUser >= MaxConnectedSessionsPerUser || !session.TryAttach(socket))
            {
                session = null;
            }
        }
        if (session is null)
        {
            await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "The connected-session limit was reached.", cancellationToken);
            return true;
        }

        await session.SendAsync(new { type = "ready" }, cancellationToken);
        try
        {
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var message = await ReceiveJsonAsync(socket, MaxHostResultBytes, cancellationToken);
                if (message is null)
                {
                    break;
                }

                session.UpdateMetadata(message.Value);
                session.HandleHostMessage(message.Value);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Request shutdown closes the socket underneath the receive loop.
        }
        catch (WebSocketException)
        {
            // A browser tab may disappear without completing a close handshake.
        }
        catch (IOException)
        {
            // TestServer and some reverse proxies surface abrupt closes as IO failures.
        }
        finally
        {
            session.Detach(socket);
        }

        return true;
    }

    public async Task<JsonElement> InvokeToolAsync(
        string sessionId,
        string name,
        JsonElement arguments,
        CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionId, out var session) || session.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            throw new McpRelayException("session_not_found", "This MCP session has expired or was disconnected.");
        }

        if (!McpToolCatalog.Contains(name))
        {
            throw new McpRelayException("tool_not_found", $"Unknown tool: {name}");
        }

        return await session.InvokeAsync(name, arguments, ToolTimeout, cancellationToken);
    }

    public bool Stop(string sessionId, string? hostToken = null)
    {
        if (!_sessions.TryGetValue(sessionId, out var existing))
        {
            return false;
        }

        if (hostToken is not null && !FixedTimeEquals(existing.HostToken, hostToken))
        {
            return false;
        }

        if (!_sessions.TryRemove(sessionId, out var removed))
        {
            return false;
        }

        removed.Dispose();
        return true;
    }

    public async Task NotifyHostAsync(string sessionId, string type, JsonElement? detail, CancellationToken cancellationToken)
    {
        if (_sessions.TryGetValue(sessionId, out var session) && session.IsHostConnected)
        {
            await session.SendAsync(new { type, detail }, cancellationToken);
        }
    }

    public async Task NotifyOwnedHostsAsync(
        string? userId,
        bool isDevelopment,
        string type,
        JsonElement? detail,
        CancellationToken cancellationToken)
    {
        var userKey = UserKey(userId, isDevelopment);
        if (userKey is null)
        {
            return;
        }

        var sessions = _sessions.Values
            .Where(session => session.ExpiresAt > DateTimeOffset.UtcNow
                && session.IsHostConnected
                && string.Equals(session.UserKey, userKey, StringComparison.Ordinal))
            .ToArray();
        await Task.WhenAll(sessions.Select(session => session.SendAsync(new { type, detail }, cancellationToken)));
    }

    public void Dispose()
    {
        _sweeper.Dispose();
        foreach (var id in _sessions.Keys)
        {
            Stop(id);
        }
    }

    private void SweepExpired()
    {
        lock (_capacityLock)
        {
            SweepExpiredCore(DateTimeOffset.UtcNow);
        }
    }

    private void SweepExpiredCore(DateTimeOffset now)
    {
        foreach (var pair in _sessions)
        {
            if (pair.Value.ExpiresAt <= now && _sessions.TryRemove(pair.Key, out var removed))
            {
                removed.Dispose();
            }
        }
    }

    private bool IsConnectedSessionForUser(string sessionId, string userKey) =>
        _sessions.TryGetValue(sessionId, out var session)
        && session.ExpiresAt > DateTimeOffset.UtcNow
        && session.IsHostConnected
        && string.Equals(session.UserKey, userKey, StringComparison.Ordinal);

    private static string? UserKey(string? userId, bool isDevelopment) =>
        isDevelopment && (string.IsNullOrEmpty(userId)
            || string.Equals(userId, McpOAuthEndpoint.DevelopmentSubject, StringComparison.Ordinal))
            ? DevelopmentUserKey
            : !string.IsNullOrEmpty(userId) ? userId : null;

    private static string RandomToken(int byteCount) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(byteCount))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

    private static bool FixedTimeEquals(string expected, string? supplied)
    {
        if (supplied is null)
        {
            return false;
        }

        var left = Encoding.UTF8.GetBytes(expected);
        var right = Encoding.UTF8.GetBytes(supplied);
        return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    }

    private static async Task<JsonElement?> ReceiveJsonAsync(
        WebSocket socket,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }

            if (result.MessageType != WebSocketMessageType.Text || stream.Length + result.Count > maxBytes)
            {
                await socket.CloseAsync(WebSocketCloseStatus.InvalidPayloadData, "Invalid host message.", cancellationToken);
                return null;
            }

            await stream.WriteAsync(buffer.AsMemory(0, result.Count), cancellationToken);
        }
        while (!result.EndOfMessage);

        try
        {
            return JsonDocument.Parse(stream.ToArray()).RootElement.Clone();
        }
        catch (JsonException)
        {
            await socket.CloseAsync(WebSocketCloseStatus.InvalidPayloadData, "Invalid JSON.", cancellationToken);
            return null;
        }
    }

    private sealed class Session : IDisposable
    {
        private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
        private readonly SemaphoreSlim _sendLock = new(1, 1);
        private WebSocket? _host;
        private long _hostAttachedAt;
        private int _activeToolCalls;
        private SessionMetadata _metadata = new(null, null, null, false);

        internal Session(
            string id,
            string hostToken,
            string? userId,
            DateTimeOffset expiresAt)
        {
            Id = id;
            HostToken = hostToken;
            UserId = userId;
            ExpiresAt = expiresAt;
        }

        internal string Id { get; }
        internal string HostToken { get; }
        internal string? UserId { get; }
        internal string UserKey => UserId ?? DevelopmentUserKey;
        internal DateTimeOffset ExpiresAt { get; private set; }
        internal bool IsHostConnected => Volatile.Read(ref _host)?.State == WebSocketState.Open;
        internal long HostAttachedAt => Interlocked.Read(ref _hostAttachedAt);
        internal SessionMetadata Metadata => Volatile.Read(ref _metadata);

        internal bool TryAttach(WebSocket socket)
        {
            if (Interlocked.CompareExchange(ref _host, socket, null) is not null)
            {
                return false;
            }

            Interlocked.Exchange(ref _hostAttachedAt, DateTimeOffset.UtcNow.UtcTicks);
            ExpiresAt = DateTimeOffset.UtcNow.Add(SessionLifetime);
            return true;
        }

        internal void Detach(WebSocket socket)
        {
            Interlocked.CompareExchange(ref _host, null, socket);
            FailPending("editor_offline", "The Viritura editor tab disconnected.");
        }

        internal void UpdateMetadata(JsonElement message)
        {
            if (!message.TryGetProperty("metadata", out var metadata) || metadata.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            Interlocked.Exchange(ref _metadata, new SessionMetadata(
                ReadBoundedString(metadata, "title", 240),
                ReadBoundedString(metadata, "fileName", 500),
                ReadBoundedString(metadata, "documentId", 1000),
                metadata.TryGetProperty("focused", out var focused) && focused.ValueKind == JsonValueKind.True));
        }

        private static string? ReadBoundedString(JsonElement value, string property, int maxLength) =>
            value.TryGetProperty(property, out var element) && element.ValueKind == JsonValueKind.String
                ? element.GetString()![..Math.Min(element.GetString()!.Length, maxLength)]
                : null;

        internal async Task<JsonElement> InvokeAsync(
            string name,
            JsonElement arguments,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            if (!IsHostConnected)
            {
                throw new McpRelayException("editor_offline", "The Viritura editor tab is not connected.");
            }
            if (Interlocked.Increment(ref _activeToolCalls) > MaxConcurrentToolsPerSession)
            {
                Interlocked.Decrement(ref _activeToolCalls);
                throw new McpRelayException("session_busy", "This Viritura session already has too many tool calls in progress.");
            }

            var requestId = Guid.NewGuid().ToString("N");
            var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!_pending.TryAdd(requestId, completion))
            {
                Interlocked.Decrement(ref _activeToolCalls);
                throw new McpRelayException("relay_error", "Unable to allocate a tool request.");
            }

            try
            {
                await SendAsync(new { type = "tool_call", requestId, name, arguments }, cancellationToken);
                return await completion.Task.WaitAsync(timeout, cancellationToken);
            }
            catch (TimeoutException)
            {
                throw new McpRelayException("tool_timeout", "The editor did not complete the tool call in time.");
            }
            finally
            {
                _pending.TryRemove(requestId, out _);
                Interlocked.Decrement(ref _activeToolCalls);
            }
        }

        internal void HandleHostMessage(JsonElement message)
        {
            if (!message.TryGetProperty("type", out var type)
                || type.GetString() != "tool_result"
                || !message.TryGetProperty("requestId", out var idElement)
                || idElement.GetString() is not { } requestId
                || !_pending.TryRemove(requestId, out var completion))
            {
                return;
            }

            if (!message.TryGetProperty("result", out var result))
            {
                completion.TrySetException(new McpRelayException("invalid_host_response", "The editor returned no result."));
                return;
            }

            completion.TrySetResult(result.Clone());
        }

        internal async Task SendAsync(object value, CancellationToken cancellationToken)
        {
            var socket = Volatile.Read(ref _host);
            if (socket?.State != WebSocketState.Open)
            {
                throw new McpRelayException("editor_offline", "The Viritura editor tab is not connected.");
            }

            var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
            await _sendLock.WaitAsync(cancellationToken);
            try
            {
                await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        internal void Stop()
        {
            FailPending("session_stopped", "The MCP session was stopped.");
            var socket = Interlocked.Exchange(ref _host, null);
            if (socket?.State == WebSocketState.Open)
            {
                _ = socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Session stopped.", CancellationToken.None);
            }
        }

        public void Dispose()
        {
            Stop();
            _sendLock.Dispose();
        }

        private void FailPending(string code, string message)
        {
            foreach (var pair in _pending)
            {
                if (_pending.TryRemove(pair.Key, out var completion))
                {
                    completion.TrySetException(new McpRelayException(code, message));
                }
            }
        }
    }

    internal sealed record SessionMetadata(string? Title, string? FileName, string? DocumentId, bool Focused);
}

internal sealed class McpRelayException : Exception
{
    public McpRelayException()
        : this("relay_error", "The MCP relay failed.")
    {
    }

    public McpRelayException(string message)
        : this("relay_error", message)
    {
    }

    public McpRelayException(string message, Exception innerException)
        : base(message, innerException)
    {
        Code = "relay_error";
    }

    public McpRelayException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    internal string Code { get; }
}