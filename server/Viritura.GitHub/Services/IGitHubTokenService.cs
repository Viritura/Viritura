namespace Viritura.GitHub;

public interface IGitHubTokenService
{
    string BuildAuthorizationUrl(string state);

    Task<GitHubSessionEnvelope> CreateSessionFromAuthorizationCodeAsync(string code, CancellationToken cancellationToken = default);

    Task<GitHubSessionEnvelope> RefreshIfNeededAsync(GitHubSessionEnvelope session, CancellationToken cancellationToken = default);
}