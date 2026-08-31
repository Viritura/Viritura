namespace Viritura.GitHub;

public interface IGitHubOAuthClient
{
    Task<GitHubTokenBundle> ExchangeCodeAsync(string code, string redirectUri, CancellationToken cancellationToken = default);

    Task<GitHubTokenBundle> RefreshAccessTokenAsync(string refreshToken, CancellationToken cancellationToken = default);

    Task<GitHubViewer> GetViewerAsync(string accessToken, CancellationToken cancellationToken = default);

    Task<GitHubInstallationStatus> GetViewerInstallationAsync(string accessToken, GitHubViewer viewer, CancellationToken cancellationToken = default);

    Task<GitHubCreatedRepository> CreateRepositoryAsync(
        string accessToken,
        GitHubCreateRepository repository,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Revokes the user's OAuth grant on GitHub (DELETE /applications/{client_id}/grant).
    /// Best-effort: returns true if GitHub accepted the revocation (204) or the grant was already gone (404).
    /// </summary>
    Task<bool> RevokeOAuthGrantAsync(string accessToken, CancellationToken cancellationToken = default);
}