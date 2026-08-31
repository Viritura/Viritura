using Microsoft.Extensions.Options;

using Viritura.GitHub;

namespace Viritura.GitHub;

public sealed class GitHubTokenService(
    IGitHubOAuthClient oauthClient,
    IOptions<GitHubAuthOptions> options,
    TimeProvider timeProvider) : IGitHubTokenService
{
    public string BuildAuthorizationUrl(string state)
    {
        var authOptions = options.Value;
        var query = string.Join("&", new[]
        {
            $"client_id={Uri.EscapeDataString(authOptions.ClientId)}",
            $"redirect_uri={Uri.EscapeDataString(authOptions.RedirectUri)}",
            $"state={Uri.EscapeDataString(state)}",
            $"scope={Uri.EscapeDataString(authOptions.Scope)}"
        });

        return $"{authOptions.AuthorizeUrl}?{query}";
    }

    public async Task<GitHubSessionEnvelope> CreateSessionFromAuthorizationCodeAsync(string code, CancellationToken cancellationToken = default)
    {
        var tokenBundle = await oauthClient.ExchangeCodeAsync(code, options.Value.RedirectUri, cancellationToken);
        var viewer = await oauthClient.GetViewerAsync(tokenBundle.AccessToken, cancellationToken);

        return new GitHubSessionEnvelope(tokenBundle, viewer, timeProvider.GetUtcNow());
    }

    public async Task<GitHubSessionEnvelope> RefreshIfNeededAsync(GitHubSessionEnvelope session, CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        if (!GitHubTokenRefreshPolicy.ShouldRefresh(session.TokenBundle, nowUtc))
        {
            return session;
        }

        if (string.IsNullOrWhiteSpace(session.TokenBundle.RefreshToken))
        {
            throw new GitHubSessionExpiredException("The GitHub access token expired and no refresh token is available.");
        }

        if (session.TokenBundle.RefreshTokenExpiresAtUtc is { } refreshExpiresAt && refreshExpiresAt <= nowUtc)
        {
            throw new GitHubSessionExpiredException("The GitHub refresh token has expired.");
        }

        GitHubTokenBundle refreshed;
        try
        {
            refreshed = await oauthClient.RefreshAccessTokenAsync(session.TokenBundle.RefreshToken, cancellationToken);
        }
        catch (HttpRequestException ex) when (ex.StatusCode is null or
            System.Net.HttpStatusCode.RequestTimeout or
            System.Net.HttpStatusCode.TooManyRequests or
            System.Net.HttpStatusCode.InternalServerError or
            System.Net.HttpStatusCode.BadGateway or
            System.Net.HttpStatusCode.ServiceUnavailable or
            System.Net.HttpStatusCode.GatewayTimeout)
        {
            // A transport failure or provider outage does not prove the grant
            // is invalid. Preserve the installation so a later request can retry.
            throw;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new GitHubSessionExpiredException("The GitHub session could not be refreshed.", ex);
        }

        var merged = refreshed with
        {
            RefreshToken = string.IsNullOrWhiteSpace(refreshed.RefreshToken)
                ? session.TokenBundle.RefreshToken
                : refreshed.RefreshToken,
            RefreshTokenExpiresAtUtc = refreshed.RefreshTokenExpiresAtUtc ?? session.TokenBundle.RefreshTokenExpiresAtUtc,
            Scope = string.IsNullOrWhiteSpace(refreshed.Scope) ? session.TokenBundle.Scope : refreshed.Scope,
            TokenType = string.IsNullOrWhiteSpace(refreshed.TokenType) ? session.TokenBundle.TokenType : refreshed.TokenType
        };

        return session with
        {
            TokenBundle = merged,
            UpdatedAtUtc = timeProvider.GetUtcNow()
        };
    }
}