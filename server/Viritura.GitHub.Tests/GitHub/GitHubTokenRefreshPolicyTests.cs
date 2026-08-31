using System.Globalization;

using Viritura.GitHub;

using Xunit;

namespace Viritura.GitHub.Tests.GitHub;

public sealed class GitHubTokenRefreshPolicyTests
{
    [Fact]
    public void ShouldRefresh_WhenAccessTokenExpiresSoon_ReturnsTrue()
    {
        var now = DateTimeOffset.Parse("2026-05-19T00:00:00Z", CultureInfo.InvariantCulture);
        var tokenBundle = new GitHubTokenBundle(
            "token",
            "refresh",
            now.AddMinutes(1),
            now.AddDays(30),
            "bearer",
            "repo");

        Assert.True(GitHubTokenRefreshPolicy.ShouldRefresh(tokenBundle, now));
    }

    [Fact]
    public void ShouldRefresh_WhenAccessTokenStillValid_ReturnsFalse()
    {
        var now = DateTimeOffset.Parse("2026-05-19T00:00:00Z", CultureInfo.InvariantCulture);
        var tokenBundle = new GitHubTokenBundle(
            "token",
            "refresh",
            now.AddHours(1),
            now.AddDays(30),
            "bearer",
            "repo");

        Assert.False(GitHubTokenRefreshPolicy.ShouldRefresh(tokenBundle, now));
    }
}