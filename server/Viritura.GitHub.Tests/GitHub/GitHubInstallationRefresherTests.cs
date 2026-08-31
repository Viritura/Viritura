using Viritura.Infrastructure;

using Xunit;

namespace Viritura.GitHub.Tests.GitHub;

/// <summary>
/// Verifies that <see cref="GitHubInstallationRefresher"/> persists rotated refresh tokens.
/// The contract is: when <see cref="IGitHubTokenService.RefreshIfNeededAsync"/> returns a NEW
/// envelope (a refresh happened), we must call <see cref="IGitHubInstallationStore.UpdateTokensAsync"/>
/// so the next request doesn't replay the now-revoked refresh token (GitHub rotates refresh
/// tokens on every refresh; the old one is single-use).
/// </summary>
public class GitHubInstallationRefresherTests
{
    private static UserGitHubInstallation BuildInstallation() => new()
    {
        Id = 42,
        UserId = "user-1",
        LoginProvider = "GitHub",
        ProviderKey = "101",
        Login = "viritura-user",
        GitHubUserId = 101,
        AvatarUrl = "https://avatars.example/u.png",
        AccessToken = "old-access",
        RefreshToken = "old-refresh",
        AccessTokenExpiresAtUtc = DateTimeOffset.UtcNow.AddMinutes(-1),
        RefreshTokenExpiresAtUtc = DateTimeOffset.UtcNow.AddDays(180),
        TokenType = "bearer",
        Scope = "repo read:user"
    };

    [Fact]
    public async Task RefreshAsync_WhenTokenServiceRotatesRefreshToken_PersistsNewBundle()
    {
        var installation = BuildInstallation();
        var rotated = new GitHubSessionEnvelope(
            new GitHubTokenBundle(
                "new-access",
                "new-refresh",
                DateTimeOffset.UtcNow.AddHours(8),
                DateTimeOffset.UtcNow.AddDays(180),
                "bearer",
                "repo read:user"),
            new GitHubViewer(101, "viritura-user", null, "https://avatars.example/u.png"),
            DateTimeOffset.UtcNow);

        var tokenService = new RotatingTokenService(rotated);
        var store = new RecordingStore();
        var refresher = new GitHubInstallationRefresher(tokenService, store);

        var result = await refresher.RefreshAsync(installation);

        Assert.Same(rotated, result);
        var (id, bundle) = Assert.Single(store.Updates);
        Assert.Equal(installation.Id, id);
        Assert.Equal("new-access", bundle.AccessToken);
        // Crucial: the rotated refresh token MUST land in the persisted bundle, otherwise the
        // next call retries with the revoked one and the user is silently signed out of GitHub.
        Assert.Equal("new-refresh", bundle.RefreshToken);
    }

    [Fact]
    public async Task RefreshAsync_WhenTokenServiceReturnsSameEnvelope_DoesNotWriteToStore()
    {
        // No refresh happened (token still valid). The refresher must not waste a write \u2014
        // the contract is "same reference back \u2192 nothing changed".
        var installation = BuildInstallation();
        var tokenService = new PassThroughTokenService();
        var store = new RecordingStore();
        var refresher = new GitHubInstallationRefresher(tokenService, store);

        var result = await refresher.RefreshAsync(installation);

        Assert.NotNull(result);
        Assert.Empty(store.Updates);
    }

    private sealed class RotatingTokenService(GitHubSessionEnvelope rotated) : IGitHubTokenService
    {
        public string BuildAuthorizationUrl(string state) => throw new NotSupportedException();
        public Task<GitHubSessionEnvelope> CreateSessionFromAuthorizationCodeAsync(string code, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
        public Task<GitHubSessionEnvelope> RefreshIfNeededAsync(GitHubSessionEnvelope session, CancellationToken cancellationToken = default)
            => Task.FromResult(rotated);
    }

    private sealed class PassThroughTokenService : IGitHubTokenService
    {
        public string BuildAuthorizationUrl(string state) => throw new NotSupportedException();
        public Task<GitHubSessionEnvelope> CreateSessionFromAuthorizationCodeAsync(string code, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
        public Task<GitHubSessionEnvelope> RefreshIfNeededAsync(GitHubSessionEnvelope session, CancellationToken cancellationToken = default)
            => Task.FromResult(session);
    }

    private sealed class RecordingStore : IGitHubInstallationStore
    {
        public List<(int InstallationId, GitHubTokenBundle Bundle)> Updates { get; } = new();

        public Task<UserGitHubInstallation?> FindAsync(string userId, CancellationToken cancellationToken = default)
            => Task.FromResult<UserGitHubInstallation?>(null);
        public Task<UserGitHubInstallation?> FindByProviderKeyAsync(string providerKey, CancellationToken cancellationToken = default)
            => Task.FromResult<UserGitHubInstallation?>(null);
        public Task UpsertAsync(string userId, GitHubSessionEnvelope session, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
        public Task UpdateTokensAsync(int installationId, GitHubTokenBundle tokens, CancellationToken cancellationToken = default)
        {
            Updates.Add((installationId, tokens));
            return Task.CompletedTask;
        }
        public Task DeleteAsync(string userId, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<int> DeleteByGitHubAccountIdAsync(long gitHubAccountId, CancellationToken cancellationToken = default) => Task.FromResult(0);
    }
}