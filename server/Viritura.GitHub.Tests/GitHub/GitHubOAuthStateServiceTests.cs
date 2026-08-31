using System.Globalization;

using Microsoft.AspNetCore.DataProtection;

using Viritura.GitHub;

using Xunit;

namespace Viritura.GitHub.Tests.GitHub;

public sealed class GitHubOAuthStateServiceTests
{
    [Fact]
    public void CreateChallenge_ThenValidate_ReturnsExpectedReturnTo()
    {
        var clock = new FakeTimeProvider(DateTimeOffset.Parse("2026-05-19T00:00:00Z", CultureInfo.InvariantCulture));
        var service = new GitHubOAuthStateService(DataProtectionProvider.Create("state-test"), clock);

        var challenge = service.CreateChallenge("/projects/42");

        var valid = service.TryValidate(challenge.State, challenge.CookieValue, out var returnTo);

        Assert.True(valid);
        Assert.Equal("/projects/42", returnTo);
    }

    [Fact]
    public void TryValidate_FailsAfterExpiry()
    {
        var clock = new FakeTimeProvider(DateTimeOffset.Parse("2026-05-19T00:00:00Z", CultureInfo.InvariantCulture));
        var service = new GitHubOAuthStateService(DataProtectionProvider.Create("state-test-expiry"), clock);
        var challenge = service.CreateChallenge("/");

        clock.Advance(TimeSpan.FromMinutes(11));

        var valid = service.TryValidate(challenge.State, challenge.CookieValue, out _);

        Assert.False(valid);
    }
}