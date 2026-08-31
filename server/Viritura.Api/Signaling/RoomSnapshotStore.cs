// RoomSnapshotStore — keyed-byte-blob storage for live-collab room snapshots.
//
// Why this exists. WebRTC's SCTP data channel caps individual messages at
// 256 KB (Chromium ↔ Chromium; less on other interop matrices). The y-webrtc
// sync protocol delivers a freshly-joining peer's *entire* initial state as
// one such message via <c>Y.encodeStateAsUpdate</c> — anything larger gets
// silently dropped, so a 365 KB Beethoven score never reaches the guest even
// though signaling, peer connect, and post-connect small updates all work.
// The fix is to deliver initial state out of band over HTTPS (no size cap)
// and keep P2P for the small incremental updates it's good at.
//
// Storage model. Each room id maps to ONE snapshot blob, which is the most
// recent <c>Y.encodeStateAsUpdate(doc)</c> any participating peer pushed.
// Snapshots are CRDT-idempotent — applying any pair in either order yields
// the same Y.Doc state — so "last write wins" is safe even with concurrent
// uploaders. The blob is opaque on the server side; we never deserialize
// the Yjs binary format here.
//
// Lifetime / scaling. In-process dictionary, lost on restart. That's the
// right starting point because the canonical document for an unsaved /
// in-flight collab session is the union of what every peer holds — the
// server snapshot is acceleration for late joiners, not the source of
// truth. Persistence + cross-replica fan-out are scoped to the cloud
// backend roadmap item (D2 in <c>docs/plans/crdt-collaboration.md</c>),
// where this interface gets a Redis / Postgres-backed implementation.

using Microsoft.Extensions.Options;

namespace Viritura.Api.Signaling;

/// <summary>
/// Lets the snapshot store ask the signaling hub whether a room currently
/// has live WebSocket subscribers. Used to protect actively-collaborative
/// rooms from pressure-eviction when storage is full.
/// </summary>
public interface IActiveRoomQuery
{
    bool HasActiveSubscribers(string roomId);
}

/// <summary>
/// Backing store for live-collab room snapshots — see file header for the
/// architectural rationale.
/// </summary>
public interface IRoomSnapshotStore
{
    /// <summary>
    /// Retrieve the most recent snapshot pushed for <paramref name="roomId"/>,
    /// or <c>null</c> if no peer has uploaded one yet.
    /// </summary>
    byte[]? TryGet(string roomId);

    /// <summary>
    /// Atomically replace the stored snapshot for <paramref name="roomId"/>.
    /// </summary>
    SnapshotPutResult TryPut(string roomId, byte[] snapshot);

    /// <summary>
    /// Forget the snapshot for <paramref name="roomId"/>. Currently unused;
    /// reserved for the eventual room-expiry sweep.
    /// </summary>
    bool Remove(string roomId);

    /// <summary>
    /// Sweep entries that have not been touched (read or written) since
    /// <paramref name="cutoff"/>. Called by the periodic background sweeper.
    /// </summary>
    int EvictIdleOlderThan(DateTimeOffset cutoff);

    /// <summary>Sweep entries created before <paramref name="cutoff"/> regardless of activity.</summary>
    int EvictCreatedOlderThan(DateTimeOffset cutoff);
}

public enum SnapshotPutResult
{
    Stored,
    CapacityExceeded
}

/// <summary>
/// Tunables for <see cref="InMemoryRoomSnapshotStore"/>. Defaults pick a
/// 128 MB total ceiling, 512 rooms, and a 24h idle cutoff — enough for a
/// single-replica self-hosted instance to absorb traffic spikes without
/// letting an anonymous attacker pin arbitrary memory by spraying room
/// ids.
/// </summary>
public sealed class RoomSnapshotStoreOptions
{
    /// <summary>Hard cap on the sum of <c>snapshot.Length</c> across all rooms.</summary>
    public long MaxTotalBytes { get; set; } = 128L * 1024 * 1024;

    /// <summary>Hard cap on the number of rooms stored.</summary>
    public int MaxRoomCount { get; set; } = 512;

    /// <summary>Rooms untouched for longer than this are dropped by the periodic sweeper.</summary>
    public TimeSpan IdleEviction { get; set; } = TimeSpan.FromHours(24);

    /// <summary>Absolute lifetime even when reads keep an entry active.</summary>
    public TimeSpan AbsoluteTtl { get; set; } = TimeSpan.FromHours(72);

    /// <summary>How often the background sweeper runs.</summary>
    public TimeSpan SweepInterval { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>Maximum simultaneous request bodies admitted for snapshot upload.</summary>
    public int MaxConcurrentUploads { get; set; } = 4;

    /// <summary>Per-source upload bytes admitted during one fixed minute.</summary>
    public long MaxUploadBytesPerIpPerMinute { get; set; } = 64L * 1024 * 1024;

    /// <summary>Per-source download bytes admitted during one fixed minute.</summary>
    public long MaxDownloadBytesPerIpPerMinute { get; set; } = 256L * 1024 * 1024;

    /// <summary>
    /// Rooms idle for at least this long without active signaling subscribers
    /// become candidates for pressure-eviction when the store is full.
    /// Shorter than <see cref="IdleEviction"/> so a full-store attack cannot
    /// block legitimate uploads for 24 h.
    /// </summary>
    public TimeSpan PressureEvictionMinAge { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Maximum number of distinct new room IDs a single source IP may
    /// introduce into the store within a 24-hour window. Re-uploading to a
    /// room the same source has already touched does not consume quota.
    /// </summary>
    public int MaxNewRoomsPerSourcePerDay { get; set; } = 16;
}

/// <summary>
/// In-process <see cref="IRoomSnapshotStore"/> backed by a
/// <see cref="ConcurrentDictionary{TKey, TValue}"/>. Single-replica only.
/// <para/>
/// Bounded: total bytes, room count, idle age, and absolute age are capped. A
/// put that would breach byte/count ceilings is rejected rather than evicting
/// an unrelated active room, and a background sweeper drops anything older than
/// <see cref="RoomSnapshotStoreOptions.IdleEviction"/>.
/// </summary>
public sealed class InMemoryRoomSnapshotStore : IRoomSnapshotStore
{
    private readonly RoomSnapshotStoreOptions _options;
    private readonly IActiveRoomQuery? _activeRooms;
    private readonly Dictionary<string, Entry> _snapshots = new(StringComparer.Ordinal);
    private long _totalBytes;
    // Single writer lock — keeps total-bytes accounting and LRU eviction consistent.
    private readonly object _writeLock = new();

    public InMemoryRoomSnapshotStore(
        IOptions<RoomSnapshotStoreOptions>? options = null,
        IActiveRoomQuery? activeRooms = null)
    {
        _options = options?.Value ?? new RoomSnapshotStoreOptions();
        _activeRooms = activeRooms;
    }

    public byte[]? TryGet(string roomId)
    {
        lock (_writeLock)
        {
            if (!_snapshots.TryGetValue(roomId, out var entry)) return null;
            entry.LastAccess = DateTimeOffset.UtcNow;
            return entry.Bytes;
        }
    }

    public SnapshotPutResult TryPut(string roomId, byte[] snapshot)
    {
        var now = DateTimeOffset.UtcNow;
        lock (_writeLock)
        {
            var existingLength = _snapshots.TryGetValue(roomId, out var existing)
                ? existing.Bytes.LongLength
                : 0;
            var prospectiveBytes = _totalBytes - existingLength + snapshot.LongLength;
            var prospectiveRooms = existing is null ? _snapshots.Count + 1 : _snapshots.Count;
            if (prospectiveBytes > Math.Max(1, _options.MaxTotalBytes) ||
                prospectiveRooms > Math.Max(1, _options.MaxRoomCount))
            {
                // Try to make room by evicting the LRU idle/unattached entry.
                // This collapses the DoS window from 24–72 h to effectively 0
                // while protecting rooms with active signaling connections.
                if (!TryEvictCandidateForPressure(now))
                    return SnapshotPutResult.CapacityExceeded;
                // Recalculate accounting after the eviction.
                existingLength = _snapshots.TryGetValue(roomId, out existing)
                    ? existing.Bytes.LongLength : 0;
                prospectiveBytes = _totalBytes - existingLength + snapshot.LongLength;
                prospectiveRooms = existing is null ? _snapshots.Count + 1 : _snapshots.Count;
                if (prospectiveBytes > Math.Max(1, _options.MaxTotalBytes) ||
                    prospectiveRooms > Math.Max(1, _options.MaxRoomCount))
                {
                    return SnapshotPutResult.CapacityExceeded;
                }
            }

            var entry = new Entry(snapshot, now, now);
            _snapshots[roomId] = entry;
            _totalBytes = prospectiveBytes;
            return SnapshotPutResult.Stored;
        }
    }

    // Called under _writeLock. Finds the LRU entry that:
    //   - has been idle long enough (PressureEvictionMinAge), and
    //   - has no active signaling subscribers.
    // Returns true and evicts it if found; returns false if all stored
    // rooms are either too recent or actively in use.
    private bool TryEvictCandidateForPressure(DateTimeOffset now)
    {
        var cutoff = now - _options.PressureEvictionMinAge;
        string? evictKey = null;
        var oldestAccess = DateTimeOffset.MaxValue;
        foreach (var kv in _snapshots)
        {
            if (kv.Value.LastAccess > cutoff) continue; // too recently accessed — protected
            if (_activeRooms?.HasActiveSubscribers(kv.Key) == true) continue; // live signaling — protected
            if (kv.Value.LastAccess < oldestAccess)
            {
                oldestAccess = kv.Value.LastAccess;
                evictKey = kv.Key;
            }
        }
        if (evictKey is null) return false;
        if (_snapshots.Remove(evictKey, out var evicted))
            _totalBytes -= evicted.Bytes.LongLength;
        return true;
    }

    public bool Remove(string roomId)
    {
        lock (_writeLock)
        {
            if (_snapshots.Remove(roomId, out var removed))
            {
                _totalBytes -= removed.Bytes.LongLength;
                return true;
            }
            return false;
        }
    }

    public int EvictIdleOlderThan(DateTimeOffset cutoff)
    {
        lock (_writeLock)
        {
            return EvictWhere(entry => entry.LastAccess < cutoff);
        }
    }

    public int EvictCreatedOlderThan(DateTimeOffset cutoff)
    {
        lock (_writeLock)
        {
            return EvictWhere(entry => entry.CreatedAt < cutoff);
        }
    }

    internal long TotalBytes
    {
        get
        {
            lock (_writeLock)
            {
                return _totalBytes;
            }
        }
    }

    private int EvictWhere(Func<Entry, bool> predicate)
    {
        var dropped = 0;
        foreach (var kv in _snapshots)
        {
            if (predicate(kv.Value) && _snapshots.Remove(kv.Key, out var removed))
            {
                _totalBytes -= removed.Bytes.LongLength;
                dropped++;
            }
        }
        return dropped;
    }

    private sealed class Entry(byte[] bytes, DateTimeOffset createdAt, DateTimeOffset lastAccess)
    {
        public byte[] Bytes { get; } = bytes;
        public DateTimeOffset CreatedAt { get; } = createdAt;
        public DateTimeOffset LastAccess { get; set; } = lastAccess;
    }
}

/// <summary>
/// Periodic sweeper for <see cref="IRoomSnapshotStore.EvictIdleOlderThan"/>.
/// </summary>
public sealed class RoomSnapshotIdleSweeper(
    IRoomSnapshotStore store,
    IOptions<RoomSnapshotStoreOptions> options,
    ILogger<RoomSnapshotIdleSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var opts = options.Value;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(opts.SweepInterval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            try
            {
                var now = DateTimeOffset.UtcNow;
                var idleDropped = store.EvictIdleOlderThan(now - opts.IdleEviction);
                var expiredDropped = store.EvictCreatedOlderThan(now - opts.AbsoluteTtl);
                if (idleDropped > 0 || expiredDropped > 0)
                {
                    logger.LogInformation(
                        "RoomSnapshotIdleSweeper: dropped {IdleCount} idle and {ExpiredCount} expired snapshots.",
                        idleDropped,
                        expiredDropped);
                }
            }
#pragma warning disable CA1031 // background sweeper: must survive any store failure and retry next tick
            catch (Exception ex)
#pragma warning restore CA1031
            {
                logger.LogWarning(ex, "RoomSnapshotIdleSweeper: sweep failed; will retry on next interval.");
            }
        }
    }
}