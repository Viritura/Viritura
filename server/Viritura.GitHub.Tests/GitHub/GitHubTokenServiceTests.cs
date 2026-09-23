using Microsoft.Extensions.Options;

using Viritura.GitHub;

using Xunit;

namespace Viritura.GitHub.Tests.GitHub;

public sealed class GitHubTokenServiceTests
{
    [Fact]
    public void BuildAuthorizationUrl_OmitsLegacyOAuthScopeByDefault()
    {
        var service = CreateService(new GitHubAuthOptions
        {
            ClientId = "client-id",
            RedirectUri = "http://api.viritura.localhost/github/auth/callback"
        });

        var authorizationUrl = service.BuildAuthorizationUrl("state-value");

        Assert.DoesNotContain("scope=", authorizationUrl, StringComparison.Ordinal);
        Assert.Contains("client_id=client-id", authorizationUrl, StringComparison.Ordinal);
        Assert.Contains(
            "redirect_uri=http%3A%2F%2Fapi.viritura.localhost%2Fgithub%2Fauth%2Fcallback",
            authorizationUrl,
            StringComparison.Ordinal);
    }

    [Fact]
    public void BuildAuthorizationUrl_IncludesExplicitCompatibilityScope()
    {
        var service = CreateService(new GitHubAuthOptions
        {
            ClientId = "client-id",
            RedirectUri = "http://api.viritura.localhost/github/auth/callback",
            Scope = "read:user"
        });

        var authorizationUrl = service.BuildAuthorizationUrl("state-value");

        Assert.Contains("scope=read%3Auser", authorizationUrl, StringComparison.Ordinal);
    }

    private static GitHubTokenService CreateService(GitHubAuthOptions options) =>
        new(new UnusedOAuthClient(), Options.Create(options), TimeProvider.System);

    private sealed class UnusedOAuthClient : IGitHubOAuthClient
    {
        public Task<GitHubTokenBundle> ExchangeCodeAsync(
            string code,
            string redirectUri,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubTokenBundle> RefreshAccessTokenAsync(
            string refreshToken,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubViewer> GetViewerAsync(
            string accessToken,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubInstallationStatus> GetViewerInstallationAsync(
            string accessToken,
            GitHubViewer viewer,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubCreatedRepository?> FindRepositoryAsync(
            string accessToken,
            string owner,
            string name,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<GitHubCreatedRepository>> ListRepositoriesAsync(
            string accessToken,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubCreatedRepository> CreateRepositoryAsync(
            string accessToken,
            GitHubCreateRepository repository,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<bool> RevokeOAuthGrantAsync(
            string accessToken,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}