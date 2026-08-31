using Viritura.Infrastructure;

namespace Viritura.GitHub;

/// <summary>
/// Persists per-user GitHub user-to-server tokens + installation metadata.
/// Replaces the cookie-based session model.
/// </summary>
public interface IGitHubInstallationStore
{
    Task<UserGitHubInstallation?> FindAsync(string userId, CancellationToken cancellationToken = default);

    Task<UserGitHubInstallation?> FindByProviderKeyAsync(string providerKey, CancellationToken cancellationToken = default);

    Task UpsertAsync(string userId, GitHubSessionEnvelope session, CancellationToken cancellationToken = default);

    Task UpdateTokensAsync(int installationId, GitHubTokenBundle tokens, CancellationToken cancellationToken = default);

    Task DeleteAsync(string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes any installation rows that match a GitHub user/org account id. Used by the
    /// <c>installation.deleted</c> webhook to keep our cache in sync with GitHub.
    /// Returns the number of rows removed.
    /// </summary>
    Task<int> DeleteByGitHubAccountIdAsync(long gitHubAccountId, CancellationToken cancellationToken = default);
}