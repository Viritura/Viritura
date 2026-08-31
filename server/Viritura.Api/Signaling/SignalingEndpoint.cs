// SignalingEndpoint — y-webrtc–compatible WebSocket signaling relay.
//
// y-webrtc has no built-in peer discovery — every WebRTC peer needs a
// signaling channel to swap SDP offers/answers and ICE candidates before
// the direct P2P connection comes up. The free public servers Yjs used to
// ship (signaling.yjs.dev, y-webrtc-eu.fly.dev) are both dead as of 2025,
// so we host our own minimal relay here.
//
// Protocol (matches the y-webrtc 10.x reference server in
// node_modules/y-webrtc/bin/server.js — keep this file's switch arms
// byte-compatible with that file, or clients won't recognise us):
//
//   client → server  { "type":"subscribe",   "topics":["roomA","roomB"] }
//                    { "type":"unsubscribe", "topics":["roomA"]         }
//                    { "type":"publish",     "topic":"roomA", ... }      ← server fans this
//                                                                          out to every other
//                                                                          subscriber of "roomA"
//                    { "type":"ping" }                                     ← server replies "pong"
//
//   server → client  the raw "publish" payload (with .clients = current
//                    subscriber count tacked on, exactly like the JS
//                    reference does), or { "type":"pong" }.
//
// State lives entirely in process memory — a single Topic→Subscribers
// dictionary. That's fine while we run a single API replica; if we ever
// scale out, a Redis pub/sub broadcast layer underneath this same wire
// protocol is the standard fix.

using System.Buffers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

using Microsoft.Extensions.Options;

namespace Viritura.Api.Signaling;

/// <summary>
/// Tunables for <see cref="SignalingHub"/>. Defaults are sized for the
/// realistic ceiling of one self-hosted instance: 32 topics per connection
/// covers a heavy power-user (a handful of open collab rooms × a few topics
/// each); 4 096 global topics covers ~thousands of concurrent rooms; 100
/// msgs/sec per connection is well above the y-webrtc steady-state cadence
/// (a few pings + occasional SDP/ICE) but low enough to drop a flooder.
/// </summary>
public sealed class SignalingHubOptions
{
    public int MaxSubscriptionsPerConnection { get; set; } = 32;
    public int MaxTotalTopics { get; set; } = 4_096;
    public int MaxMessagesPerSecondPerConnection { get; set; } = 100;
    public int MaxSubscribersPerTopic { get; set; } = 64;
    public int MaxTotalConnections { get; set; } = 1_024;
    public int MaxConnectionsPerSourceIp { get; set; } = 32;
    public int MaxMessageBytes { get; set; } = 16 * 1024;
    public int MaxPublishPayloadBytes { get; set; } = 12 * 1024;
}

public sealed partial class SignalingHub : IActiveRoomQuery
{
    private readonly SignalingHubOptions _options;
    private readonly Dictionary<string, HashSet<SignalingConnection>> _topics =
        new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _connectionsBySourceIp =
        new(StringComparer.Ordinal);
    private readonly object _topicLock = new();
    private readonly object _connectionLock = new();
    private int _activeConnections;

    // IActiveRoomQuery: the snapshot store uses this to protect rooms with
    // live WebSocket subscribers from pressure-eviction under storage DoS.
    bool IActiveRoomQuery.HasActiveSubscribers(string roomId)
    {
        lock (_topicLock)
        {
            return _topics.TryGetValue("viritura.live." + roomId, out var subs) && subs.Count > 0;
        }
    }

    public SignalingHub(IOptions<SignalingHubOptions>? options = null)
    {
        _options = options?.Value ?? new SignalingHubOptions();
    }

    [GeneratedRegex("^viritura\\.live\\.[a-z2-9]{16}$")]
    private static partial Regex TopicRegex();

    internal int ActiveTopicCount
    {
        get
        {
            lock (_topicLock)
            {
                return _topics.Count;
            }
        }
    }

    internal bool TryAcquireConnection(string sourceIp)
    {
        lock (_connectionLock)
        {
            _connectionsBySourceIp.TryGetValue(sourceIp, out var sourceCount);
            if (_activeConnections >= Math.Max(1, _options.MaxTotalConnections) ||
                sourceCount >= Math.Max(1, _options.MaxConnectionsPerSourceIp))
            {
                return false;
            }

            _activeConnections++;
            _connectionsBySourceIp[sourceIp] = sourceCount + 1;
            return true;
        }
    }

    internal void ReleaseConnection(string sourceIp)
    {
        lock (_connectionLock)
        {
            _activeConnections = Math.Max(0, _activeConnections - 1);
            if (!_connectionsBySourceIp.TryGetValue(sourceIp, out var sourceCount) || sourceCount <= 1)
            {
                _connectionsBySourceIp.Remove(sourceIp);
                return;
            }
            _connectionsBySourceIp[sourceIp] = sourceCount - 1;
        }
    }

    public async Task HandleAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var conn = new SignalingConnection(socket, _options.MaxMessagesPerSecondPerConnection);
        try
        {
            await PumpAsync(conn, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            // Remove this connection from every topic it had joined.
            lock (_topicLock)
            {
                foreach (var topic in conn.SubscribedTopics)
                {
                    if (_topics.TryGetValue(topic, out var subscribers))
                    {
                        subscribers.Remove(conn);
                        if (subscribers.Count == 0)
                        {
                            _topics.Remove(topic);
                        }
                    }
                }
                conn.SubscribedTopics.Clear();
            }

            // Release the per-connection send lock now the socket loop is done.
            conn.Dispose();
        }
    }

    private async Task PumpAsync(SignalingConnection conn, CancellationToken cancellationToken)
    {
        // Read frames into a reusable buffer. y-webrtc messages are tiny
        // (SDP offers are a few KB at most) so a single 16 KB rent is
        // plenty; if a peer ever sends something larger we'll grow it.
        var buffer = ArrayPool<byte>.Shared.Rent(Math.Max(1_024, _options.MaxMessageBytes));
        try
        {
            while (conn.Socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var message = await ReceiveFullMessageAsync(conn.Socket, buffer, cancellationToken).ConfigureAwait(false);
                if (message is null) return; // close handshake

                // Per-connection message-rate throttle: a flooder gets its
                // frames silently dropped rather than crashing the relay.
                if (!conn.TryAdmitMessage())
                {
                    await conn.ClosePolicyViolationAsync("Signaling message rate exceeded.", cancellationToken)
                        .ConfigureAwait(false);
                    return;
                }

                JsonNode? payload;
                try
                {
                    payload = JsonNode.Parse(message);
                }
                catch (JsonException)
                {
                    continue; // ignore malformed frames, exactly like the JS reference
                }
                if (payload is not JsonObject obj) continue;

                if (!TryReadString(obj["type"], out var type)) continue;
                switch (type)
                {
                    case "subscribe":
                        HandleSubscribe(conn, obj["topics"] as JsonArray);
                        break;

                    case "unsubscribe":
                        HandleUnsubscribe(conn, obj["topics"] as JsonArray);
                        break;

                    case "publish":
                        await HandlePublishAsync(conn, obj, cancellationToken).ConfigureAwait(false);
                        break;

                    case "ping":
                        await conn.SendAsync("{\"type\":\"pong\"}", cancellationToken).ConfigureAwait(false);
                        break;

                    default:
                        // Unknown type — silently ignore. The reference
                        // server does the same.
                        break;
                }
            }
        }
        catch (WebSocketException)
        {
            // Client crashed / went away mid-read. The finally in the
            // caller will unsubscribe from every topic.
        }
        catch (OperationCanceledException)
        {
            // App shutdown.
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private void HandleSubscribe(SignalingConnection conn, JsonArray? topics)
    {
        if (topics is null) return;
        foreach (var node in topics)
        {
            if (!TryReadString(node, out var topic) || !TopicRegex().IsMatch(topic)) continue;
            lock (_topicLock)
            {
                if (conn.SubscribedTopics.Contains(topic)) continue;
                // Per-connection cap: a single peer can't pin arbitrary
                // memory by subscribing to thousands of topics.
                if (conn.SubscribedTopics.Count >= Math.Max(1, _options.MaxSubscriptionsPerConnection)) return;
                if (!_topics.TryGetValue(topic, out var subscribers))
                {
                    // The cap check and insertion share one lock so concurrent
                    // first subscribers cannot overshoot the global ceiling.
                    if (_topics.Count >= Math.Max(1, _options.MaxTotalTopics)) continue;
                    subscribers = [];
                    _topics.Add(topic, subscribers);
                }
                if (subscribers.Count >= Math.Max(1, _options.MaxSubscribersPerTopic)) continue;
                subscribers.Add(conn);
                conn.SubscribedTopics.Add(topic);
            }
        }
    }

    private void HandleUnsubscribe(SignalingConnection conn, JsonArray? topics)
    {
        if (topics is null) return;
        foreach (var node in topics)
        {
            if (!TryReadString(node, out var topic) || !TopicRegex().IsMatch(topic)) continue;
            lock (_topicLock)
            {
                if (_topics.TryGetValue(topic, out var subscribers))
                {
                    subscribers.Remove(conn);
                    if (subscribers.Count == 0)
                    {
                        _topics.Remove(topic);
                    }
                }
                conn.SubscribedTopics.Remove(topic);
            }
        }
    }

    private async Task HandlePublishAsync(SignalingConnection sender, JsonObject payload, CancellationToken cancellationToken)
    {
        if (!TryReadString(payload["topic"], out var topic) || !TopicRegex().IsMatch(topic)) return;
        // Publisher must be subscribed to the topic. The reference y-webrtc
        // server doesn't enforce this, but allowing arbitrary cross-topic
        // publishes lets an anonymous attacker spray every active room
        // with junk SDP frames without ever joining them. Legitimate
        // y-webrtc peers always subscribe to a room before publishing.
        SignalingConnection[] receivers;
        int subscriberCount;
        lock (_topicLock)
        {
            if (!sender.SubscribedTopics.Contains(topic)) return;
            if (!_topics.TryGetValue(topic, out var subscribers) || subscribers.Count == 0) return;
            subscriberCount = subscribers.Count;
            receivers = [.. subscribers];
        }

        // Tack on the subscriber count, matching the JS reference. Some
        // y-webrtc client behaviours (room "alone" detection) depend on
        // seeing this field, so don't drop it.
        payload["clients"] = subscriberCount;
        var json = payload.ToJsonString();
        if (Encoding.UTF8.GetByteCount(json) > Math.Max(1_024, _options.MaxPublishPayloadBytes)) return;

        // Snapshot the subscriber set before fanning out — a peer that
        // disconnects mid-broadcast just falls through into a closed
        // socket which SendAsync handles by closing.
        var sends = new Task[receivers.Length];
        for (var i = 0; i < receivers.Length; i++)
        {
            sends[i] = receivers[i].SendAsync(json, cancellationToken);
        }
        await Task.WhenAll(sends).ConfigureAwait(false);
    }

    private static bool TryReadString(JsonNode? node, out string value)
    {
        value = string.Empty;
        if (node is not JsonValue jsonValue || !jsonValue.TryGetValue<string>(out var candidate) ||
            string.IsNullOrEmpty(candidate))
        {
            return false;
        }
        value = candidate;
        return true;
    }

    private static async Task<string?> ReceiveFullMessageAsync(WebSocket socket, byte[] buffer, CancellationToken cancellationToken)
    {
        var written = 0;
        while (true)
        {
            ArraySegment<byte> segment = new(buffer, written, buffer.Length - written);
            WebSocketReceiveResult result;
            try
            {
                result = await socket.ReceiveAsync(segment, cancellationToken).ConfigureAwait(false);
            }
            catch (WebSocketException)
            {
                return null;
            }

            if (result.MessageType == WebSocketMessageType.Close)
            {
                if (socket.State == WebSocketState.CloseReceived)
                {
                    await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, cancellationToken).ConfigureAwait(false);
                }
                return null;
            }

            written += result.Count;
            if (result.EndOfMessage) break;

            if (written == buffer.Length)
            {
                // Refuse messages larger than the rented buffer rather than
                // unbounded-growing — protects against a misbehaving client
                // flooding us. 16 KB is comfortably above any legitimate
                // SDP/ICE payload.
                return null;
            }
        }
        return Encoding.UTF8.GetString(buffer, 0, written);
    }
}

internal sealed class SignalingConnection : IDisposable
{
    public WebSocket Socket { get; }
    public HashSet<string> SubscribedTopics { get; } = new(StringComparer.Ordinal);

    // Serialize writes per-connection. WebSocket.SendAsync isn't safe to
    // call concurrently on the same socket; the publish fan-out can race
    // multiple topics into the same subscriber, so a per-connection lock
    // is the cheapest correct fix.
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    // Rolling 1-second message-rate accounting. Cheap and accurate enough
    // for "drop the obvious flooder"; we don't need token-bucket smoothing.
    private readonly int _maxMessagesPerSecond;
    private long _windowStartTicks;
    private int _windowCount;

    public SignalingConnection(WebSocket socket, int maxMessagesPerSecond)
    {
        Socket = socket;
        _maxMessagesPerSecond = Math.Max(1, maxMessagesPerSecond);
        _windowStartTicks = DateTimeOffset.UtcNow.UtcTicks;
    }

    public void Dispose() => _sendLock.Dispose();

    public bool TryAdmitMessage()
    {
        var now = DateTimeOffset.UtcNow.UtcTicks;
        var elapsedTicks = now - Interlocked.Read(ref _windowStartTicks);
        if (elapsedTicks >= TimeSpan.TicksPerSecond)
        {
            Interlocked.Exchange(ref _windowStartTicks, now);
            Interlocked.Exchange(ref _windowCount, 0);
        }
        var count = Interlocked.Increment(ref _windowCount);
        return count <= _maxMessagesPerSecond;
    }

    public async Task SendAsync(string json, CancellationToken cancellationToken)
    {
        if (Socket.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(json);
        await _sendLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await Socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (WebSocketException)
        {
            // Peer is gone. The receive loop will observe the same and
            // unsubscribe it from every topic in its finally clause.
        }
        catch (ObjectDisposedException)
        {
            // Same — socket torn down mid-send.
        }
        finally
        {
            _sendLock.Release();
        }
    }

    public async Task ClosePolicyViolationAsync(string reason, CancellationToken cancellationToken)
    {
        if (Socket.State != WebSocketState.Open) return;
        try
        {
            await Socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, reason, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (WebSocketException)
        {
            // Peer disappeared while the policy close was in flight.
        }
        catch (ObjectDisposedException)
        {
            // Socket was torn down concurrently.
        }
    }
}