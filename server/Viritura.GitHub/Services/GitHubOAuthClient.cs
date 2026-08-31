using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

using Microsoft.Extensions.Options;

using Viritura.GitHub;

namespace Viritura.GitHub;

public sealed class GitHubOAuthClient(
    HttpClient httpClient,
    IOptions<GitHubAuthOptions> options,
    TimeProvider timeProvider) : IGitHubOAuthClient
{
    private static readonly Uri TokenUrl = new("https://github.com/login/oauth/access_token", UriKind.Absolute);
    private static readonly Uri ViewerUrl = new("https://api.github.com/user", UriKind.Absolute);
    private static readonly Uri ViewerInstallationsUrl = new("https://api.github.com/user/installations?per_page=100", UriKind.Absolute);
    private static readonly Uri UserRepositoriesUrl = new("https://api.github.com/user/repos", UriKind.Absolute);

    public async Task<GitHubTokenBundle> ExchangeCodeAsync(string code, string redirectUri, CancellationToken cancellationToken = default)
    {
        var request = new Dictionary<string, string>
        {
            ["client_id"] = options.Value.ClientId,
            ["client_secret"] = options.Value.ClientSecret,
            ["code"] = code,
            ["redirect_uri"] = redirectUri
        };

        return await ExchangeTokenAsync(request, cancellationToken);
    }

    public async Task<GitHubTokenBundle> RefreshAccessTokenAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        var request = new Dictionary<string, string>
        {
            ["client_id"] = options.Value.ClientId,
            ["client_secret"] = options.Value.ClientSecret,
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken
        };

        return await ExchangeTokenAsync(request, cancellationToken);
    }

    public async Task<GitHubViewer> GetViewerAsync(string accessToken, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ViewerUrl);
        AddGitHubHeaders(request, accessToken);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

        var root = document.RootElement;
        // /user returns the viewer's public profile email if they've set one (no permission or
        // scope required). It's null when they haven't. We don't try /user/emails because that
        // requires the GitHub App's "Email addresses" account permission, which we don't request.
        var email = root.TryGetProperty("email", out var emailEl) ? emailEl.GetString() : null;
        if (string.IsNullOrWhiteSpace(email))
        {
            email = null;
        }

        return new GitHubViewer(
            root.GetProperty("id").GetInt64(),
            root.GetProperty("login").GetString() ?? string.Empty,
            root.TryGetProperty("name", out var name) ? name.GetString() : null,
            root.TryGetProperty("avatar_url", out var avatarUrl) ? avatarUrl.GetString() : null,
            email);
    }

    public async Task<GitHubInstallationStatus> GetViewerInstallationAsync(string accessToken, GitHubViewer viewer, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ViewerInstallationsUrl);
        AddGitHubHeaders(request, accessToken);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

        if (!document.RootElement.TryGetProperty("installations", out var installations) || installations.ValueKind != JsonValueKind.Array)
        {
            return GitHubInstallationStatus.NotInstalled;
        }

        foreach (var installation in installations.EnumerateArray())
        {
            if (!IsViewerInstallation(installation, viewer))
            {
                continue;
            }

            var permissions = installation.TryGetProperty("permissions", out var permissionsElement)
                ? permissionsElement
                : default;
            var administrationWrite = HasWritePermission(permissions, "administration") || HasWritePermission(permissions, "admin");
            var suspended = installation.TryGetProperty("suspended_at", out var suspendedAt)
                && suspendedAt.ValueKind != JsonValueKind.Null;

            return new GitHubInstallationStatus(
                true,
                administrationWrite && !suspended,
                installation.TryGetProperty("id", out var id) && id.TryGetInt64(out var installationId) ? installationId : null,
                installation.GetProperty("account").TryGetProperty("login", out var login) ? login.GetString() : null,
                installation.TryGetProperty("target_type", out var targetType) ? targetType.GetString() : null,
                installation.TryGetProperty("repository_selection", out var repositorySelection) ? repositorySelection.GetString() : null,
                installation.TryGetProperty("html_url", out var htmlUrl) ? htmlUrl.GetString() : null,
                administrationWrite,
                suspended);
        }

        return GitHubInstallationStatus.NotInstalled;
    }

    public async Task<bool> RevokeOAuthGrantAsync(string accessToken, CancellationToken cancellationToken = default)
    {
        var authOptions = options.Value;
        if (string.IsNullOrWhiteSpace(authOptions.ClientId) || string.IsNullOrWhiteSpace(authOptions.ClientSecret))
        {
            return false;
        }

        var grantUrl = new Uri(string.Format(System.Globalization.CultureInfo.InvariantCulture, "https://api.github.com/applications/{0}/grant", authOptions.ClientId), UriKind.Absolute);

        using var request = new HttpRequestMessage(HttpMethod.Delete, grantUrl)
        {
            Content = JsonContent.Create(new { access_token = accessToken })
        };

        var credentials = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{authOptions.ClientId}:{authOptions.ClientSecret}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("Viritura", "1.0"));
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");

        using var response = await httpClient.SendAsync(request, cancellationToken);
        // 204 = revoked. 404 = already gone. Both are success for our purposes.
        return response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.NotFound;
    }

    public async Task<GitHubCreatedRepository> CreateRepositoryAsync(
        string accessToken,
        GitHubCreateRepository repository,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, UserRepositoriesUrl)
        {
            Content = JsonContent.Create(new
            {
                name = repository.Name,
                description = repository.Description,
                @private = repository.Private,
                auto_init = repository.AutoInit
            })
        };
        AddGitHubHeaders(request, accessToken);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;
        return new GitHubCreatedRepository(
            root.GetProperty("id").GetInt64(),
            root.GetProperty("name").GetString() ?? string.Empty,
            root.GetProperty("full_name").GetString() ?? string.Empty,
            root.GetProperty("html_url").GetString() ?? string.Empty,
            root.GetProperty("clone_url").GetString() ?? string.Empty,
            root.GetProperty("private").GetBoolean(),
            root.GetProperty("default_branch").GetString() ?? string.Empty);
    }

    private async Task<GitHubTokenBundle> ExchangeTokenAsync(Dictionary<string, string> payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, TokenUrl)
        {
            Content = JsonContent.Create(payload)
        };

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("Viritura", "1.0"));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var tokenPayload = await response.Content.ReadFromJsonAsync<GitHubTokenPayload>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("GitHub OAuth response was empty.");

        if (string.IsNullOrWhiteSpace(tokenPayload.AccessToken))
        {
            throw new InvalidOperationException("GitHub OAuth response did not include an access token.");
        }

        var nowUtc = timeProvider.GetUtcNow();
        DateTimeOffset? expiresAt = tokenPayload.ExpiresIn is > 0 ? nowUtc.AddSeconds(tokenPayload.ExpiresIn.Value) : null;
        var refreshExpiresAt = tokenPayload.RefreshTokenExpiresIn is > 0
            ? nowUtc.AddSeconds(tokenPayload.RefreshTokenExpiresIn.Value)
            : (DateTimeOffset?)null;

        return new GitHubTokenBundle(
            tokenPayload.AccessToken,
            tokenPayload.RefreshToken,
            expiresAt,
            refreshExpiresAt,
            tokenPayload.TokenType ?? "bearer",
            tokenPayload.Scope ?? string.Empty);
    }

    private static void AddGitHubHeaders(HttpRequestMessage request, string accessToken)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("Viritura", "1.0"));
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
    }

    private bool IsViewerInstallation(JsonElement installation, GitHubViewer viewer)
    {
        if (installation.TryGetProperty("app_slug", out var appSlug))
        {
            var expectedSlug = options.Value.AppSlug;
            if (!string.IsNullOrWhiteSpace(expectedSlug)
                && !string.Equals(appSlug.GetString(), expectedSlug, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }

        if (!installation.TryGetProperty("account", out var account)
            || !account.TryGetProperty("id", out var accountId)
            || !accountId.TryGetInt64(out var id))
        {
            return false;
        }

        return id == viewer.Id;
    }

    private static bool HasWritePermission(JsonElement permissions, string key)
    {
        return permissions.ValueKind == JsonValueKind.Object
            && permissions.TryGetProperty(key, out var permission)
            && string.Equals(permission.GetString(), "write", StringComparison.OrdinalIgnoreCase);
    }

    private sealed record GitHubTokenPayload
    {
        [JsonPropertyName("access_token")]
        public string? AccessToken { get; init; }

        [JsonPropertyName("refresh_token")]
        public string? RefreshToken { get; init; }

        [JsonPropertyName("expires_in")]
        public int? ExpiresIn { get; init; }

        [JsonPropertyName("refresh_token_expires_in")]
        public int? RefreshTokenExpiresIn { get; init; }

        [JsonPropertyName("scope")]
        public string? Scope { get; init; }

        [JsonPropertyName("token_type")]
        public string? TokenType { get; init; }
    }
}