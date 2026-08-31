using Microsoft.Extensions.Caching.Memory;

namespace Viritura.Api;

/// <summary>Outcome of a <see cref="WebhookDeliveryDeduplicator.TryAcquireLease"/> call.</summary>
public enum LeaseAcquireResult
{
    /// <summary>Lease taken. Caller must call <see cref="WebhookDeliveryDeduplicator.Complete"/> or <see cref="WebhookDeliveryDeduplicator.Release"/> after processing.</summary>
    Acquired,
    /// <summary>Previously processed successfully. Return 200 idempotently.</summary>
    AlreadyCompleted,
    /// <summary>Another request holds an active lease. Return 503 so GitHub retries later.</summary>
    ConcurrentDuplicate,
    /// <summary>Empty or oversized delivery id. Return 400.</summary>
    InvalidId,
}

/// <summary>
/// In-process delivery deduplicator with explicit InProgress / Completed / Failed semantics.
/// <para>
/// State machine:
/// <list type="bullet">
///   <item><b>None</b> (not in cache) — fresh or previously failed, retryable.</item>
///   <item><b>InProgress</b> — lease acquired; concurrent duplicates are rejected (503) until the lease expires.</item>
///   <item><b>Completed</b> — successfully processed; all future attempts get 200 idempotently.</item>
/// </list>
/// Stale InProgress leases (past <see cref="LeaseDuration"/>) are transparently re-acquired by the next request.
/// </para>
/// </summary>
public sealed class WebhookDeliveryDeduplicator : IDisposable
{
    private enum DeliveryState { InProgress, Completed }
    private sealed record Entry(DeliveryState State, DateTimeOffset LeaseExpiry);

    /// <summary>How long an InProgress lease is considered valid against concurrent duplicates.</summary>
    internal static readonly TimeSpan LeaseDuration = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan RetentionPeriod = TimeSpan.FromHours(24);

    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 10_000 });
    private readonly object _lock = new();

    /// <summary>
    /// Attempts to acquire a processing lease for the given delivery.
    /// </summary>
    public LeaseAcquireResult TryAcquireLease(string deliveryId)
    {
        if (string.IsNullOrWhiteSpace(deliveryId) || deliveryId.Length > 128)
            return LeaseAcquireResult.InvalidId;

        lock (_lock)
        {
            if (_cache.TryGetValue(deliveryId, out Entry? entry))
            {
                if (entry!.State == DeliveryState.Completed)
                    return LeaseAcquireResult.AlreadyCompleted;

                // InProgress: reject concurrent duplicates; re-acquire stale leases.
                if (DateTimeOffset.UtcNow < entry.LeaseExpiry)
                    return LeaseAcquireResult.ConcurrentDuplicate;
            }

            _cache.Set(deliveryId,
                new Entry(DeliveryState.InProgress, DateTimeOffset.UtcNow + LeaseDuration),
                new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = RetentionPeriod, Size = 1 });

            return LeaseAcquireResult.Acquired;
        }
    }

    /// <summary>
    /// Marks a delivery as successfully completed. All future <see cref="TryAcquireLease"/> calls
    /// for the same id return <see cref="LeaseAcquireResult.AlreadyCompleted"/>.
    /// </summary>
    public void Complete(string deliveryId)
    {
        lock (_lock)
        {
            _cache.Set(deliveryId,
                new Entry(DeliveryState.Completed, DateTimeOffset.MaxValue),
                new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = RetentionPeriod, Size = 1 });
        }
    }

    /// <summary>
    /// Releases a previously acquired lease without completing the delivery.
    /// The delivery is retryable on the next request.
    /// </summary>
    public void Release(string deliveryId)
    {
        lock (_lock) { _cache.Remove(deliveryId); }
    }

    public void Dispose() => _cache.Dispose();
}