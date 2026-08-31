namespace Viritura.GitHub;

public sealed class GitHubAuthOptions
{
    public const string SectionName = "Viritura:GitHub";

    public string ClientId { get; set; } = string.Empty;

    public string ClientSecret { get; set; } = string.Empty;

    public string AppSlug { get; set; } = string.Empty;

    public string RedirectUri { get; set; } = string.Empty;

    public string FrontendBaseUrl { get; set; } = "https://app.viritura.com";

    public string Scope { get; set; } = "repo read:user";

    public string AuthorizeUrl { get; set; } = "https://github.com/login/oauth/authorize";

    public string StateCookieName { get; set; } = "__Host-viritura-github-state";

    public string SessionCookieName { get; set; } = "__Host-viritura-github-session";

    [System.Diagnostics.CodeAnalysis.SuppressMessage("Performance", "CA1819:Properties should not return arrays", Justification = "Bound directly from configuration, which populates a string[].")]
    public string[] AllowedFrontendOrigins { get; set; } = [];

    /// <summary>
    /// Optional HMAC-SHA256 secret used to verify incoming GitHub webhooks. When empty, the webhook endpoint
    /// rejects all requests (webhooks must be explicitly configured per environment).
    /// </summary>
    public string WebhookSecret { get; set; } = string.Empty;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ClientId) &&
        !string.IsNullOrWhiteSpace(ClientSecret) &&
        !string.IsNullOrWhiteSpace(RedirectUri);

    public string InstallUrl =>
        string.IsNullOrWhiteSpace(AppSlug)
            ? string.Empty
            : $"https://github.com/apps/{AppSlug.Trim()}/installations/new";
}