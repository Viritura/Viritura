using Microsoft.Extensions.Options;

using Viritura.Api.Signaling;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class RoomSnapshotStoreTests
{
    // ── Baseline byte-accounting and capacity ───────────────────────────────

    [Fact]
    public void TryPut_WhenCapacityIsFull_AndRecentEntry_RejectsWithoutEviction()
    {
        // Room-a was stored just now — within PressureEvictionMinAge — so it
        // is protected; the second put must still return CapacityExceeded.
        var store = CreateStore(maxBytes: 4, maxRooms: 2, pressureEvictionMinAge: TimeSpan.FromMinutes(5));

        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-a", [1, 2, 3, 4]));
        Assert.Equal(SnapshotPutResult.CapacityExceeded, store.TryPut("room-b", [5]));

        Assert.Equal(new byte[] { 1, 2, 3, 4 }, store.TryGet("room-a"));
        Assert.Null(store.TryGet("room-b"));
        Assert.Equal(4, store.TotalBytes);
    }

    [Fact]
    public void TryPut_ReplacingExistingRoom_AccountsOnlyForReplacementBytes()
    {
        var store = CreateStore(maxBytes: 5, maxRooms: 2);
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-a", [1, 2, 3, 4]));

        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-a", [7, 8]));
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-b", [9, 10, 11]));

        Assert.Equal(5, store.TotalBytes);
        Assert.Equal(new byte[] { 7, 8 }, store.TryGet("room-a"));
        Assert.Equal(new byte[] { 9, 10, 11 }, store.TryGet("room-b"));
    }

    [Fact]
    public async Task ConcurrentReplacement_KeepsByteAccountingConsistent()
    {
        var store = CreateStore(maxBytes: 32, maxRooms: 1);

        await Task.WhenAll(Enumerable.Range(1, 100).Select(index => Task.Run(() =>
        {
            var bytes = new byte[(index % 16) + 1];
            Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-a", bytes));
        })));

        var retained = store.TryGet("room-a");
        Assert.NotNull(retained);
        Assert.Equal(retained!.LongLength, store.TotalBytes);
        Assert.InRange(store.TotalBytes, 1, 16);
    }

    [Fact]
    public void AbsoluteExpiry_RemovesActiveEntry()
    {
        var store = CreateStore(maxBytes: 8, maxRooms: 1);
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-a", [1, 2]));
        Assert.NotNull(store.TryGet("room-a"));

        var dropped = store.EvictCreatedOlderThan(DateTimeOffset.UtcNow.AddSeconds(1));

        Assert.Equal(1, dropped);
        Assert.Null(store.TryGet("room-a"));
        Assert.Equal(0, store.TotalBytes);
    }

    // ── Pressure eviction — core DoS mitigation ─────────────────────────────

    [Fact]
    public void PressureEviction_EvictsLruIdleUnattachedRoom_WhenStoreFull()
    {
        // Zero MinAge so any stored entry is immediately eligible; no active
        // signaling (default null query) so nothing is protected.
        // Store is capped at 2 bytes; attack-room fills it; legit-room must
        // evict attack-room to fit (both are 2 bytes).
        var store = CreateStore(maxBytes: 2, maxRooms: 2, pressureEvictionMinAge: TimeSpan.Zero);

        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("attack-room", [1, 2]));

        // Legitimate room needs space → attack-room is evicted.
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("legit-room", [3, 4]));

        Assert.Null(store.TryGet("attack-room"));
        Assert.Equal(new byte[] { 3, 4 }, store.TryGet("legit-room"));
        Assert.Equal(2, store.TotalBytes);
    }

    [Fact]
    public void PressureEviction_EvictsLruFirst_WhenMultipleIdleEntries()
    {
        // Three rooms, two bytes each; after a small delay the first is
        // clearly the oldest. MinAge = zero so age is the only criterion.
        var store = CreateStore(maxBytes: 4, maxRooms: 10, pressureEvictionMinAge: TimeSpan.Zero);

        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-old", [0xAA, 0xBB]));
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-new", [0xCC, 0xDD]));
        // Touch room-new so it has the most-recent LastAccess.
        store.TryGet("room-new");

        // Now full (4 bytes); a new 2-byte room should evict room-old (LRU).
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-third", [0xEE, 0xFF]));

        Assert.Null(store.TryGet("room-old"));
        Assert.NotNull(store.TryGet("room-new"));
        Assert.NotNull(store.TryGet("room-third"));
    }

    [Fact]
    public void PressureEviction_ProtectsRoomWithActiveSignalingSubscribers()
    {
        // room-attack has an active signaling session → must never be evicted.
        var activeRooms = new FakeActiveRoomQuery(activeRoomId: "attack-room");
        var store = CreateStore(maxBytes: 2, maxRooms: 2,
            pressureEvictionMinAge: TimeSpan.Zero, activeRooms: activeRooms);

        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("attack-room", [0xAA, 0xBB]));

        // Store is full; attack-room is protected → must reject.
        Assert.Equal(SnapshotPutResult.CapacityExceeded, store.TryPut("legit-room", [0xCC, 0xDD]));

        Assert.NotNull(store.TryGet("attack-room"));
        Assert.Null(store.TryGet("legit-room"));
    }

    [Fact]
    public void PressureEviction_AfterSignalingDrops_AttackRoomBecomesEvictable()
    {
        // Same setup — but now the attacker's signaling session has ended.
        var activeRooms = new FakeActiveRoomQuery(); // no active rooms
        var store = CreateStore(maxBytes: 2, maxRooms: 2,
            pressureEvictionMinAge: TimeSpan.Zero, activeRooms: activeRooms);

        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("attack-room", [0xAA, 0xBB]));

        // No signaling subscribers → evictable → legitimate room succeeds.
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("legit-room", [0xCC, 0xDD]));

        Assert.Null(store.TryGet("attack-room"));
        Assert.Equal(new byte[] { 0xCC, 0xDD }, store.TryGet("legit-room"));
    }

    [Fact]
    public void PressureEviction_MultipleAttackRooms_LegitRoomAlwaysGetIn()
    {
        // Simulate eight 1-byte attack rooms filling a 8-byte store, then
        // verify that a legitimate 1-byte room always displaces the LRU one.
        var store = CreateStore(maxBytes: 8, maxRooms: 20,
            pressureEvictionMinAge: TimeSpan.Zero);

        for (var i = 0; i < 8; i++)
        {
            Assert.Equal(SnapshotPutResult.Stored, store.TryPut($"attack-{i}", [0xFF]));
        }
        Assert.Equal(8, store.TotalBytes);

        // Legitimate room should always succeed by evicting one attack room.
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("legit", [0x01]));
        Assert.Equal(new byte[] { 0x01 }, store.TryGet("legit"));
        // Total should remain bounded.
        Assert.Equal(8, store.TotalBytes);
    }

    [Fact]
    public void PressureEviction_ByteAccountingRemainsConsistent_AfterEviction()
    {
        var store = CreateStore(maxBytes: 4, maxRooms: 10, pressureEvictionMinAge: TimeSpan.Zero);

        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-a", [1, 2, 3, 4]));
        Assert.Equal(SnapshotPutResult.Stored, store.TryPut("room-b", [5, 6]));

        Assert.Equal(2, store.TotalBytes);
        Assert.Null(store.TryGet("room-a"));
        Assert.NotNull(store.TryGet("room-b"));
    }

    // ── Per-source new-room quota ────────────────────────────────────────────

    [Fact]
    public void TransferLimiter_BoundsConcurrencyAndBytesPerSource()
    {
        using var limiter = new SnapshotTransferLimiter(Options.Create(new RoomSnapshotStoreOptions
        {
            MaxConcurrentUploads = 1,
            MaxUploadBytesPerIpPerMinute = 4,
            MaxDownloadBytesPerIpPerMinute = 6
        }));

        using var firstLease = limiter.TryAcquireUpload();
        Assert.NotNull(firstLease);
        Assert.Null(limiter.TryAcquireUpload());
        Assert.True(limiter.TryConsumeUpload("192.0.2.1", 3));
        Assert.False(limiter.TryConsumeUpload("192.0.2.1", 2));
        Assert.True(limiter.TryConsumeUpload("192.0.2.2", 4));
        Assert.True(limiter.TryConsumeDownload("192.0.2.1", 6));
        Assert.False(limiter.TryConsumeDownload("192.0.2.1", 1));

        firstLease.Dispose();
        using var nextLease = limiter.TryAcquireUpload();
        Assert.NotNull(nextLease);
    }

    [Fact]
    public void TransferLimiter_PerSourceRoomQuota_BlocksNewRoomsBeyondDailyLimit()
    {
        using var limiter = new SnapshotTransferLimiter(Options.Create(new RoomSnapshotStoreOptions
        {
            MaxNewRoomsPerSourcePerDay = 3
        }));

        // First 3 distinct rooms are accepted.
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.1", "room-1"));
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.1", "room-2"));
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.1", "room-3"));

        // Fourth distinct room from the same IP is rejected.
        Assert.False(limiter.TryConsumeNewRoom("10.0.0.1", "room-4"));

        // Different IP has its own independent quota.
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.2", "room-4"));
    }

    [Fact]
    public void TransferLimiter_RevisitingKnownRoom_DoesNotConsumeQuota()
    {
        using var limiter = new SnapshotTransferLimiter(Options.Create(new RoomSnapshotStoreOptions
        {
            MaxNewRoomsPerSourcePerDay = 1
        }));

        Assert.True(limiter.TryConsumeNewRoom("10.0.0.1", "room-a"));

        // Quota is exhausted for new rooms.
        Assert.False(limiter.TryConsumeNewRoom("10.0.0.1", "room-b"));

        // But re-uploading to the already-seen room is always allowed.
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.1", "room-a"));
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.1", "room-a"));
    }

    [Fact]
    public void TransferLimiter_RoomQuota_IsIndependentPerSource()
    {
        using var limiter = new SnapshotTransferLimiter(Options.Create(new RoomSnapshotStoreOptions
        {
            MaxNewRoomsPerSourcePerDay = 2
        }));

        // Source A fills its quota.
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.1", "r1"));
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.1", "r2"));
        Assert.False(limiter.TryConsumeNewRoom("10.0.0.1", "r3"));

        // Source B is unaffected.
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.2", "r3"));
        Assert.True(limiter.TryConsumeNewRoom("10.0.0.2", "r4"));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static InMemoryRoomSnapshotStore CreateStore(
        long maxBytes,
        int maxRooms,
        TimeSpan? pressureEvictionMinAge = null,
        IActiveRoomQuery? activeRooms = null) =>
        new(Options.Create(new RoomSnapshotStoreOptions
        {
            MaxTotalBytes = maxBytes,
            MaxRoomCount = maxRooms,
            PressureEvictionMinAge = pressureEvictionMinAge ?? TimeSpan.FromMinutes(5)
        }), activeRooms);

    /// <summary>
    /// Test double: returns <c>true</c> for one specific room id so pressure-
    /// eviction tests can verify the active-signaling protection path.
    /// </summary>
    private sealed class FakeActiveRoomQuery(string? activeRoomId = null) : IActiveRoomQuery
    {
        public bool HasActiveSubscribers(string roomId) => roomId == activeRoomId;
    }
}