using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Viritura.Api.Signaling;

/// <summary>
/// Bounds snapshot transfer cost in dimensions request-count rate limiting cannot
/// express: simultaneous request-body allocations, bytes transferred per source,
/// and new distinct room IDs a source may introduce per day.
/// </summary>
public sealed class SnapshotTransferLimiter : IDisposable
{
    private static readonly TimeSpan WindowDuration = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan PartitionIdleEviction = TimeSpan.FromMinutes(10);

    private readonly RoomSnapshotStoreOptions _options;
    private readonly SemaphoreSlim _uploadSlots;
    private readonly MemoryCache _windows = new(new MemoryCacheOptions { SizeLimit = 20_000 });
    // Per-source room quotas — each entry lives 24 h then resets.
    private readonly MemoryCache _sourceRooms = new(new MemoryCacheOptions { SizeLimit = 10_000 });
    private readonly object _windowLock = new();

    public SnapshotTransferLimiter(IOptions<RoomSnapshotStoreOptions> options)
    {
        _options = options.Value;
        _uploadSlots = new SemaphoreSlim(Math.Max(1, _options.MaxConcurrentUploads));
    }

    public IDisposable? TryAcquireUpload()
    {
        return _uploadSlots.Wait(0) ? new UploadLease(() => _uploadSlots.Release()) : null;
    }

    public bool TryConsumeUpload(string sourceIp, long bytes) =>
        TryConsume("upload:" + sourceIp, bytes, _options.MaxUploadBytesPerIpPerMinute);

    public bool TryConsumeDownload(string sourceIp, long bytes) =>
        TryConsume("download:" + sourceIp, bytes, _options.MaxDownloadBytesPerIpPerMinute);

    /// <summary>
    /// Returns <c>true</c> if <paramref name="sourceIp"/> may upload to
    /// <paramref name="roomId"/>. A source may revisit rooms it has already
    /// touched without consuming additional quota; only rooms that are new
    /// to this source count against <see cref="RoomSnapshotStoreOptions.MaxNewRoomsPerSourcePerDay"/>.
    /// </summary>
    public bool TryConsumeNewRoom(string sourceIp, string roomId)
    {
        var key = "rooms:" + sourceIp;
        RoomQuota quota;
        lock (_windowLock)
        {
            quota = _sourceRooms.GetOrCreate(key, entry =>
            {
                entry.Size = 1;
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromDays(1);
                return new RoomQuota();
            })!;
        }
        return quota.TryAdd(roomId, Math.Max(1, _options.MaxNewRoomsPerSourcePerDay));
    }

    private bool TryConsume(string key, long bytes, long limit)
    {
        if (bytes < 0 || bytes > Math.Max(1, limit)) return false;

        ByteWindow window;
        lock (_windowLock)
        {
            window = _windows.GetOrCreate(key, entry =>
            {
                entry.Size = 1;
                entry.SlidingExpiration = PartitionIdleEviction;
                return new ByteWindow();
            })!;
        }
        return window.TryConsume(bytes, Math.Max(1, limit));
    }

    public void Dispose()
    {
        _uploadSlots.Dispose();
        _windows.Dispose();
        _sourceRooms.Dispose();
    }

    private sealed class UploadLease(Action release) : IDisposable
    {
        private Action? _release = release;

        public void Dispose()
        {
            Interlocked.Exchange(ref _release, null)?.Invoke();
        }
    }

    private sealed class ByteWindow
    {
        private readonly object _lock = new();
        private DateTimeOffset _startedAt = DateTimeOffset.UtcNow;
        private long _consumed;

        public bool TryConsume(long bytes, long limit)
        {
            lock (_lock)
            {
                var now = DateTimeOffset.UtcNow;
                if (now - _startedAt >= WindowDuration || now < _startedAt)
                {
                    _startedAt = now;
                    _consumed = 0;
                }
                if (_consumed > limit - bytes) return false;
                _consumed += bytes;
                return true;
            }
        }
    }

    // Per-source room set: tracks distinct room IDs introduced by one source
    // in the current 24-hour window. Thread-safe because multiple concurrent
    // uploads from the same IP can race.
    private sealed class RoomQuota
    {
        private readonly object _lock = new();
        private readonly HashSet<string> _seen = new(StringComparer.Ordinal);

        public bool TryAdd(string roomId, int limit)
        {
            lock (_lock)
            {
                if (_seen.Contains(roomId)) return true; // repeat upload — not a new room
                if (_seen.Count >= limit) return false;  // per-source daily quota exhausted
                _seen.Add(roomId);
                return true;
            }
        }
    }
}