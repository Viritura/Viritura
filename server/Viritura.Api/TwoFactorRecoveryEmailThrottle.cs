using System.Threading.RateLimiting;

using Microsoft.Extensions.Caching.Memory;

namespace Viritura.Api;

/// <summary>
/// Per-recipient cap on outbound 2FA-recovery emails. Without this, an attacker who has captured
/// the victim's 2FA-partial cookie (or can replay the password step) can flood the victim's inbox
/// with recovery-link emails — the endpoint response is intentionally identical whether the send
/// is allowed or suppressed, so there is no signal in front of the attacker to stop them; we must
/// gate the send itself.
///
/// 3 sends per hour per lowercased email is generous enough to absorb genuine retries caused by
/// network issues or spam filtering, while making a sustained flood useless. The quota is
/// configurable via <c>RateLimits:TwoFactorRecoveryEmailsPerEmailPerHour</c>. The partition table
/// is held in a <see cref="MemoryCache"/> with sliding eviction so its memory footprint stays
/// bounded.
/// </summary>
public sealed class TwoFactorRecoveryEmailThrottle : IDisposable
{
    public const int DefaultPermitsPerHour = 3;

    private readonly int _permitsPerHour;
    private readonly MemoryCache _partitions;
    private static readonly TimeSpan PartitionIdleEviction = TimeSpan.FromHours(2);

    public TwoFactorRecoveryEmailThrottle(int permitsPerHour = DefaultPermitsPerHour)
    {
        _permitsPerHour = permitsPerHour;
        _partitions = new MemoryCache(new MemoryCacheOptions { SizeLimit = 50_000 });
    }

    public bool TryAcquire(string email)
    {
        var key = (email ?? string.Empty).Trim().ToUpperInvariant();
        if (key.Length == 0) return false;
        var limiter = _partitions.GetOrCreate(key, entry =>
        {
            entry.SlidingExpiration = PartitionIdleEviction;
            entry.Size = 1;
            entry.RegisterPostEvictionCallback(static (_, value, _, _) =>
            {
                if (value is IDisposable disposable) disposable.Dispose();
            });
            return new FixedWindowRateLimiter(new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = _permitsPerHour,
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                Window = TimeSpan.FromHours(1)
            });
        })!;
        using var lease = limiter.AttemptAcquire();
        return lease.IsAcquired;
    }

    public void Dispose() => _partitions.Dispose();
}