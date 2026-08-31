using System.Threading.RateLimiting;

using Microsoft.Extensions.Caching.Memory;

namespace Viritura.Api;

/// <summary>
/// Per-email cap on outbound password-reset emails. Without this, an attacker who knows a
/// victim's address can spray <c>/auth/forgot-password</c> (or the duplicate-email branch of
/// <c>/auth/register</c>) at our SMTP path and turn Viritura into an email-bombing relay —
/// the responses are intentionally identical for known/unknown emails, so there's no error
/// signal in front of the sender to stop them.
///
/// 3 sends per hour per lowercased email is generous enough to absorb a user clicking
/// "resend" a few times in normal recovery flow, tight enough to make a sustained flood
/// useless. Like <see cref="EmailLoginRateLimiter"/> the partition table is held in a
/// <see cref="MemoryCache"/> with sliding eviction so its memory footprint stays bounded.
/// </summary>
public sealed class PasswordResetEmailThrottle : IDisposable
{
    public const int DefaultPermitsPerHour = 3;

    private readonly int _permitsPerHour;
    private readonly MemoryCache _partitions;
    private static readonly TimeSpan PartitionIdleEviction = TimeSpan.FromHours(2);

    public PasswordResetEmailThrottle(int permitsPerHour = DefaultPermitsPerHour)
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