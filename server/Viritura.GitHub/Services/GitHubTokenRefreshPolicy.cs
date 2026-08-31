namespace Viritura.GitHub;

public static class GitHubTokenRefreshPolicy
{
    public static readonly TimeSpan DefaultRefreshSkew = TimeSpan.FromMinutes(2);

    public static bool ShouldRefresh(GitHubTokenBundle tokenBundle, DateTimeOffset nowUtc, TimeSpan? refreshSkew = null)
    {
        if (string.IsNullOrWhiteSpace(tokenBundle.AccessToken))
        {
            return true;
        }

        if (!tokenBundle.ExpiresAtUtc.HasValue)
        {
            return false;
        }

        var skew = refreshSkew ?? DefaultRefreshSkew;
        return tokenBundle.ExpiresAtUtc.Value <= nowUtc.Add(skew);
    }
}