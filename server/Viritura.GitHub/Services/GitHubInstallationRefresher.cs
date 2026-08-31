using Viritura.Infrastructure;

namespace Viritura.GitHub;

/// <summary>
/// Wraps <see cref="IGitHubTokenService.RefreshIfNeededAsync"/> with DB persistence so
/// callers don't have to repeat the envelope↔installation conversion.
/// </summary>
public sealed class GitHubInstallationRefresher(
    IGitHubTokenService tokenService,
    IGitHubInstallationStore store)
{
    public async Task<GitHubSessionEnvelope> RefreshAsync(
        UserGitHubInstallation installation,
        CancellationToken cancellationToken = default)
    {
        var envelope = installation.ToEnvelope();
        var refreshed = await tokenService.RefreshIfNeededAsync(envelope, cancellationToken);
        if (!ReferenceEquals(refreshed, envelope))
        {
            await store.UpdateTokensAsync(installation.Id, refreshed.TokenBundle, cancellationToken);
        }
        return refreshed;
    }
}