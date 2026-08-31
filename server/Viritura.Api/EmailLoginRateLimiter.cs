using System.Threading.RateLimiting;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;

namespace Viritura.Api;

/// <summary>
/// Per-email fixed-window rate limiter for the password login endpoint. This is the second
/// layer of credential-stuffing defence: the global per-IP <c>"Auth"</c> bucket protects against
/// noisy single-IP attackers, but a distributed botnet can rotate through IPs while still
/// targeting one victim email. Limiting by lowercased email closes that gap.
///
/// Implementation notes:
/// <list type="bullet">
///   <item>Per-email partitions live in a <see cref="MemoryCache"/> with sliding eviction so
///     the partition table can't grow without bound (a distributed enumeration attack that
///     burns a fresh email per attempt would otherwise pin one <see cref="FixedWindowRateLimiter"/>
///     per email forever).</item>
///   <item>In-memory only. For a multi-instance deployment this should move to a shared store
///     (Redis); the abstraction below is what the controllers depend on, so swapping the
///     implementation later is a one-place change.</item>
///   <item>Identity already enforces <c>LockoutOnFailure</c> on the user record after N failed
///     password attempts. This limiter sits in front of <see cref="Microsoft.AspNetCore.Identity.SignInManager{TUser}.PasswordSignInAsync"/>
///     so an attacker can't trigger a lockout by enumerating passwords either.</item>
/// </list>
/// </summary>
public sealed class EmailLoginRateLimiter : IDisposable
{
    public const int DefaultPermitsPerMinute = 10;

    private readonly int _permitsPerMinute;
    private readonly MemoryCache _partitions;
    // Sliding expiry comfortably exceeds the 1-minute window so a real user
    // retrying within the cooldown still hits the same partition, but
    // stale per-email entries get reclaimed instead of accumulating.
    private static readonly TimeSpan PartitionIdleEviction = TimeSpan.FromMinutes(10);

    public EmailLoginRateLimiter(int permitsPerMinute = DefaultPermitsPerMinute)
    {
        _permitsPerMinute = permitsPerMinute;
        _partitions = new MemoryCache(new MemoryCacheOptions
        {
            // Hard ceiling on cardinality: when this is hit the cache evicts
            // by recency. Each entry costs one FixedWindowRateLimiter (small),
            // so 50k is generous.
            SizeLimit = 50_000
        });
    }

    /// <summary>
    /// Attempts to take a permit for <paramref name="email"/>. Returns <c>true</c> when the
    /// caller may proceed with the password check; <c>false</c> when the per-email window is
    /// exhausted (the caller should respond with 429).
    /// </summary>
    public bool TryAcquire(string email)
    {
        var key = NormaliseEmail(email);
        var limiter = _partitions.GetOrCreate(key, entry =>
        {
            entry.SlidingExpiration = PartitionIdleEviction;
            entry.Size = 1;
            entry.RegisterPostEvictionCallback(OnPartitionEvicted);
            return new FixedWindowRateLimiter(new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = _permitsPerMinute,
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                Window = TimeSpan.FromMinutes(1)
            });
        })!;
        using var lease = limiter.AttemptAcquire();
        return lease.IsAcquired;
    }

    private static void OnPartitionEvicted(object key, object? value, EvictionReason reason, object? state)
    {
        if (value is IDisposable disposable) disposable.Dispose();
    }

    private static string NormaliseEmail(string email) =>
        (email ?? string.Empty).Trim().ToUpperInvariant();

    public void Dispose() => _partitions.Dispose();
}