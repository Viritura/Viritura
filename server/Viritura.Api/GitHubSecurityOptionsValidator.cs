using Viritura.GitHub;

namespace Viritura.Api;

public static class GitHubSecurityOptionsValidator
{
    public static void ValidateProductionOrigins(GitHubAuthOptions options, IEnumerable<string> configuredOrigins)
    {
        ValidateProductionOrigin(options.FrontendBaseUrl, "Viritura:GitHub:FrontendBaseUrl");
        foreach (var origin in configuredOrigins.Where(origin => !string.IsNullOrWhiteSpace(origin)))
        {
            ValidateProductionOrigin(origin, "Viritura:GitHub:AllowedFrontendOrigins");
        }
    }

    private static void ValidateProductionOrigin(string origin, string settingName)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException($"{settingName} must be an absolute URI in production.");
        }

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"{settingName} must use HTTPS in production.");
        }

        if (uri.IsLoopback || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"{settingName} cannot target localhost or loopback in production.");
        }
    }
}