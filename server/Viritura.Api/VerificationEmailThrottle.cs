using System.Threading.RateLimiting;

using Microsoft.Extensions.Caching.Memory;

namespace Viritura.Api;

/// <summary>
/// Per-recipient cap on verification emails across registration and resend flows.
/// </summary>
public sealed class VerificationEmailThrottle : IDisposable
{
    public const int DefaultPermitsPerHour = 3;

    private static readonly TimeSpan PartitionIdleEviction = TimeSpan.FromHours(2);
    private readonly int _permitsPerHour;
    private readonly MemoryCache _partitions = new(new MemoryCacheOptions { SizeLimit = 50_000 });

    public VerificationEmailThrottle(int permitsPerHour = DefaultPermitsPerHour)
    {
        _permitsPerHour = permitsPerHour;
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