using Viritura.Api;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class EmailLoginRateLimiterTests
{
    [Fact]
    public void TryAcquire_AllowsUpToTheConfiguredLimit()
    {
        using var limiter = new EmailLoginRateLimiter(permitsPerMinute: 3);

        Assert.True(limiter.TryAcquire("a@b.test"));
        Assert.True(limiter.TryAcquire("a@b.test"));
        Assert.True(limiter.TryAcquire("a@b.test"));
    }

    [Fact]
    public void TryAcquire_RejectsAfterTheConfiguredLimitForTheSameEmail()
    {
        using var limiter = new EmailLoginRateLimiter(permitsPerMinute: 2);

        Assert.True(limiter.TryAcquire("victim@b.test"));
        Assert.True(limiter.TryAcquire("victim@b.test"));
        Assert.False(limiter.TryAcquire("victim@b.test"));
    }

    [Fact]
    public void TryAcquire_PartitionsByEmailSoUnrelatedAccountsAreNotAffected()
    {
        using var limiter = new EmailLoginRateLimiter(permitsPerMinute: 2);

        Assert.True(limiter.TryAcquire("victim@b.test"));
        Assert.True(limiter.TryAcquire("victim@b.test"));
        Assert.False(limiter.TryAcquire("victim@b.test"));

        // A different email gets a fresh permit window — credential-stuffing one account
        // must not block legitimate logins to others.
        Assert.True(limiter.TryAcquire("other@b.test"));
        Assert.True(limiter.TryAcquire("other@b.test"));
    }

    [Fact]
    public void TryAcquire_NormalisesEmailCasingAndWhitespace()
    {
        using var limiter = new EmailLoginRateLimiter(permitsPerMinute: 2);

        // Same identity under different surface forms must share the same bucket; otherwise
        // an attacker just bypasses by toggling case or padding spaces.
        Assert.True(limiter.TryAcquire("Victim@B.test"));
        Assert.True(limiter.TryAcquire("  victim@b.test  "));
        Assert.False(limiter.TryAcquire("VICTIM@B.TEST"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void TryAcquire_TreatsEmptyEmailsAsTheSameBucketSoBlankSpamCannotMonopoliseAttempts(string blank)
    {
        using var limiter = new EmailLoginRateLimiter(permitsPerMinute: 2);

        Assert.True(limiter.TryAcquire(blank));
        Assert.True(limiter.TryAcquire(blank));
        Assert.False(limiter.TryAcquire(blank));
    }
}