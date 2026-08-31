using Viritura.Infrastructure;

namespace Viritura.GitHub;

public static class GitHubInstallationExtensions
{
    public static GitHubSessionEnvelope ToEnvelope(this UserGitHubInstallation installation) =>
        new(
            new GitHubTokenBundle(
                installation.AccessToken,
                installation.RefreshToken,
                installation.AccessTokenExpiresAtUtc,
                installation.RefreshTokenExpiresAtUtc,
                installation.TokenType,
                installation.Scope ?? string.Empty),
            new GitHubViewer(
                installation.GitHubUserId ?? 0,
                installation.Login ?? string.Empty,
                Name: null,
                installation.AvatarUrl),
            installation.UpdatedAtUtc);
}