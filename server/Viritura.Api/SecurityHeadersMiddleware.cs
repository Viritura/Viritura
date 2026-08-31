using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

namespace Viritura.Api;

/// <summary>
/// Appends a fixed set of security response headers to every API response.
///
/// The API primarily serves JSON plus the script-backed OAuth consent page.
/// Consent assets are same-origin and forms may post only back to this API;
/// every other response keeps the stricter API policy.
///
/// Previously delegated to the <c>NetEscapades.AspNetCore.SecurityHeaders</c>
/// package; replaced by this inline middleware since the policy is fully static
/// (no per-request nonces, no dynamic config) and the package's surface area was
/// disproportionate to the value it added.
/// </summary>
internal static class SecurityHeadersMiddleware
{
    // Pre-built CSP string. `default-src 'none'` denies every fetch directive that
    // doesn't have an explicit allow-list; the additional directives below are
    // belt-and-braces for clickjacking, base-URI hijacking, and form-action
    // exfiltration (none of which inherit from default-src per spec).
    private const string ContentSecurityPolicy =
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
    private const string OAuthConsentContentSecurityPolicy =
        "default-src 'none'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    // 1 year, matching the value the deleted SecurityHeadersPolicy.Build used.
    private const string StrictTransportSecurity = "max-age=31536000; includeSubDomains";

    public static IApplicationBuilder UseVirituraSecurityHeaders(this IApplicationBuilder app, IWebHostEnvironment environment)
    {
        var emitHsts = !environment.IsDevelopment();

        return app.Use(async (context, next) =>
        {
            var oauthConsent = context.Request.Path.Equals("/oauth/authorize", StringComparison.Ordinal);
            var oauthConsentPolicy = oauthConsent
                ? BuildOAuthConsentPolicy(context.Request.Query["redirect_uri"])
                : null;
            context.Response.OnStarting(static state =>
            {
                var (response, hsts, consentPolicy) = ((HttpResponse, bool, string?))state;
                var headers = response.Headers;

                // Set, don't append — duplicates would cause UA confusion.
                headers["X-Frame-Options"] = "DENY";
                headers["X-Content-Type-Options"] = "nosniff";
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
                headers["Cross-Origin-Opener-Policy"] = "same-origin";
                headers["Cross-Origin-Resource-Policy"] = "same-site";
                headers["X-Permitted-Cross-Domain-Policies"] = "none";
                headers["Content-Security-Policy"] = consentPolicy is not null
                    ? consentPolicy
                    : ContentSecurityPolicy;

                if (hsts)
                {
                    headers["Strict-Transport-Security"] = StrictTransportSecurity;
                }

                // Strip the Kestrel-set Server banner. (Belt-and-braces with
                // KestrelServerOptions.AddServerHeader = false in Program.cs.)
                headers.Remove("Server");

                return Task.CompletedTask;
            }, (context.Response, emitHsts, oauthConsentPolicy));

            await next();
        });
    }

    private static string BuildOAuthConsentPolicy(string? redirectUri)
    {
        if (!Uri.TryCreate(redirectUri, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps
                && !(uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)))
        {
            return OAuthConsentContentSecurityPolicy;
        }

        return $"{OAuthConsentContentSecurityPolicy} {uri.GetLeftPart(UriPartial.Authority)}";
    }
}