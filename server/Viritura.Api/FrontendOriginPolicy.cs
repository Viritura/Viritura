namespace Viritura.Api;

/// <summary>
/// Allowlist of frontend origins the API is willing to redirect back to after an
/// OAuth round-trip. Backed by the same list used for the <c>VirituraFrontend</c>
/// CORS policy so the two never drift out of sync.
/// </summary>
public sealed class FrontendOriginPolicy
{
    private readonly string[] _allowedAuthorities;

    public FrontendOriginPolicy(IEnumerable<string> allowedOrigins)
    {
        _allowedAuthorities = allowedOrigins
            .Select(origin => Uri.TryCreate(origin, UriKind.Absolute, out var uri) ? uri.GetLeftPart(UriPartial.Authority) : null)
            .Where(authority => authority is not null)
            .Select(authority => authority!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        // First configured authority is the canonical SPA origin. Used by callbacks that need
        // to land the user on the SPA without a caller-supplied returnTo (e.g. the OAuth
        // "link required" redirect).
        PrimaryBaseUrl = _allowedAuthorities.Length > 0 ? _allowedAuthorities[0] : string.Empty;
    }

    /// <summary>
    /// Canonical SPA origin (authority-only, no trailing slash). Empty when no frontend origin
    /// is configured \u2014 callers should fall back to a relative URL or refuse to redirect.
    /// </summary>
    public string PrimaryBaseUrl { get; }

    public bool IsAllowed(Uri uri) =>
        _allowedAuthorities.Contains(uri.GetLeftPart(UriPartial.Authority), StringComparer.OrdinalIgnoreCase);

    public bool TryResolveReturnUrl(string? returnTo, out string resolved)
    {
        resolved = string.Empty;
        if (string.IsNullOrWhiteSpace(returnTo))
        {
            return false;
        }

        if (Uri.TryCreate(returnTo, UriKind.Absolute, out var absolute) && IsAllowed(absolute))
        {
            resolved = absolute.ToString();
            return true;
        }

        return false;
    }
}