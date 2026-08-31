using System.Net.WebSockets;
using System.Text;

using Microsoft.Extensions.Options;

using Viritura.Api.Signaling;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class SignalingHubTests
{
    [Fact]
    public async Task Unsubscribe_RemovesEmptyTopicsImmediately()
    {
        var hub = CreateHub(maxTopics: 4);
        using var socket = new ScriptedWebSocket(
            "{\"type\":\"subscribe\",\"topics\":[\"viritura.live.aaaaaaaaaaaaaaaa\",\"viritura.live.bbbbbbbbbbbbbbbb\"]}",
            "{\"type\":\"unsubscribe\",\"topics\":[\"viritura.live.aaaaaaaaaaaaaaaa\",\"viritura.live.bbbbbbbbbbbbbbbb\"]}");

        await hub.HandleAsync(socket, CancellationToken.None);

        Assert.Equal(0, hub.ActiveTopicCount);
    }

    [Fact]
    public async Task SubscriptionChurn_DoesNotExhaustGlobalTopicCapacity()
    {
        var hub = CreateHub(maxTopics: 4);
        using var socket = new ScriptedWebSocket(
            "{\"type\":\"subscribe\",\"topics\":[\"viritura.live.aaaaaaaaaaaaaaaa\",\"viritura.live.bbbbbbbbbbbbbbbb\",\"viritura.live.cccccccccccccccc\",\"viritura.live.dddddddddddddddd\"]}",
            "{\"type\":\"unsubscribe\",\"topics\":[\"viritura.live.aaaaaaaaaaaaaaaa\",\"viritura.live.bbbbbbbbbbbbbbbb\",\"viritura.live.cccccccccccccccc\",\"viritura.live.dddddddddddddddd\"]}",
            "{\"type\":\"subscribe\",\"topics\":[\"viritura.live.eeeeeeeeeeeeeeee\",\"viritura.live.ffffffffffffffff\",\"viritura.live.gggggggggggggggg\",\"viritura.live.hhhhhhhhhhhhhhhh\"]}",
            "{\"type\":\"unsubscribe\",\"topics\":[\"viritura.live.eeeeeeeeeeeeeeee\",\"viritura.live.ffffffffffffffff\",\"viritura.live.gggggggggggggggg\",\"viritura.live.hhhhhhhhhhhhhhhh\"]}");

        await hub.HandleAsync(socket, CancellationToken.None);

        Assert.Equal(0, hub.ActiveTopicCount);
    }

    [Fact]
    public async Task WrongJsonValueTypes_AreIgnoredWithoutEscapingTheConnectionBoundary()
    {
        var hub = CreateHub(maxTopics: 4);
        using var socket = new ScriptedWebSocket(
            "{\"type\":123}",
            "{\"type\":\"subscribe\",\"topics\":[123,{}]}",
            "{\"type\":\"publish\",\"topic\":123}");

        var exception = await Record.ExceptionAsync(() => hub.HandleAsync(socket, CancellationToken.None));

        Assert.Null(exception);
        Assert.Equal(0, hub.ActiveTopicCount);
    }

    [Fact]
    public void ConnectionCaps_AreAtomicAndReleased()
    {
        var hub = new SignalingHub(Options.Create(new SignalingHubOptions
        {
            MaxTotalConnections = 1,
            MaxConnectionsPerSourceIp = 1
        }));

        Assert.True(hub.TryAcquireConnection("192.0.2.1"));
        Assert.False(hub.TryAcquireConnection("192.0.2.1"));
        Assert.False(hub.TryAcquireConnection("192.0.2.2"));

        hub.ReleaseConnection("192.0.2.1");

        Assert.True(hub.TryAcquireConnection("192.0.2.2"));
        hub.ReleaseConnection("192.0.2.2");
    }

    private static SignalingHub CreateHub(int maxTopics) =>
        new(Options.Create(new SignalingHubOptions
        {
            MaxTotalTopics = maxTopics,
            MaxSubscriptionsPerConnection = maxTopics,
            MaxSubscribersPerTopic = 4,
            MaxMessagesPerSecondPerConnection = 100
        }));

    private sealed class ScriptedWebSocket : WebSocket
    {
        private readonly Queue<byte[]> _messages;
        private WebSocketState _state = WebSocketState.Open;
        private WebSocketCloseStatus? _closeStatus;
        private string? _closeStatusDescription;

        public ScriptedWebSocket(params string[] messages)
        {
            _messages = new Queue<byte[]>(messages.Select(Encoding.UTF8.GetBytes));
        }

        public override WebSocketCloseStatus? CloseStatus => _closeStatus;

        public override string? CloseStatusDescription => _closeStatusDescription;

        public override WebSocketState State => _state;

        public override string? SubProtocol => null;

        public override void Abort() => _state = WebSocketState.Aborted;

        public override Task CloseAsync(
            WebSocketCloseStatus closeStatus,
            string? statusDescription,
            CancellationToken cancellationToken)
        {
            _closeStatus = closeStatus;
            _closeStatusDescription = statusDescription;
            _state = WebSocketState.Closed;
            return Task.CompletedTask;
        }

        public override Task CloseOutputAsync(
            WebSocketCloseStatus closeStatus,
            string? statusDescription,
            CancellationToken cancellationToken)
        {
            _closeStatus = closeStatus;
            _closeStatusDescription = statusDescription;
            _state = WebSocketState.Closed;
            return Task.CompletedTask;
        }

        public override void Dispose() => _state = WebSocketState.Closed;

        public override Task<WebSocketReceiveResult> ReceiveAsync(
            ArraySegment<byte> buffer,
            CancellationToken cancellationToken)
        {
            if (_messages.Count == 0)
            {
                _state = WebSocketState.CloseReceived;
                return Task.FromResult(new WebSocketReceiveResult(
                    0,
                    WebSocketMessageType.Close,
                    endOfMessage: true,
                    WebSocketCloseStatus.NormalClosure,
                    null));
            }

            var message = _messages.Dequeue();
            Assert.True(message.Length <= buffer.Count);
            message.CopyTo(buffer.Array!, buffer.Offset);
            return Task.FromResult(new WebSocketReceiveResult(
                message.Length,
                WebSocketMessageType.Text,
                endOfMessage: true));
        }

        public override Task SendAsync(
            ArraySegment<byte> buffer,
            WebSocketMessageType messageType,
            bool endOfMessage,
            CancellationToken cancellationToken) => Task.CompletedTask;
    }
}