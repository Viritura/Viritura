namespace Viritura.Api;

public static class DevelopmentFrontendOrigin
{
    public static bool IsWorktreeFrontend(Uri uri) =>
        IsWorktreeEditor(uri) || IsWorktreeWebsite(uri);

    public static bool IsWorktreeEditor(Uri uri) =>
        IsWorktreeHost(uri, "editor.");

    private static bool IsWorktreeWebsite(Uri uri) =>
        IsWorktreeHost(uri, "web.");

    private static bool IsWorktreeHost(Uri uri, string prefix)
    {
        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
            !uri.IsDefaultPort ||
            !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }

        return uri.Host.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) &&
            uri.Host.EndsWith(".viritura.localhost", StringComparison.OrdinalIgnoreCase) &&
            uri.Host.Length > prefix.Length + ".viritura.localhost".Length;
    }
}