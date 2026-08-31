using Microsoft.AspNetCore.DataProtection;

namespace Viritura.GitHub;

/// <summary>
/// At-rest protection for GitHub user-to-server OAuth tokens stored in
/// <c>UserGitHubInstallation.AccessToken</c> / <c>RefreshToken</c>. Wraps an
/// <see cref="IDataProtector"/> with a small versioning scheme so existing plaintext rows
/// continue to load and get re-encrypted on next write.
/// <para/>
/// On-disk format:
/// <list type="bullet">
///   <item><c>v1:</c> prefix \u2192 the remainder is base64-encoded ciphertext from
///         <see cref="IDataProtector.Protect(byte[])"/>.</item>
///   <item>No prefix \u2192 legacy plaintext from before encryption was introduced; returned as-is on
///         read, re-protected on next write.</item>
/// </list>
/// The purpose string is part of the DataProtector contract \u2014 changing it would invalidate every
/// existing ciphertext, so leave it alone unless you also migrate the data.
/// </summary>
public sealed class GitHubTokenProtector
{
    private const string ProtectorPurpose = "Viritura.GitHub.OAuthTokens.v1";
    private const string V1Prefix = "v1:";

    private readonly IDataProtector _protector;

    public GitHubTokenProtector(IDataProtectionProvider protectionProvider)
    {
        _protector = protectionProvider.CreateProtector(ProtectorPurpose);
    }

    public string Protect(string plaintext)
    {
        if (string.IsNullOrEmpty(plaintext))
        {
            return plaintext;
        }
        return V1Prefix + _protector.Protect(plaintext);
    }

    public string? ProtectOrNull(string? plaintext) =>
        string.IsNullOrEmpty(plaintext) ? plaintext : Protect(plaintext);

    public string Unprotect(string stored)
    {
        if (string.IsNullOrEmpty(stored))
        {
            return stored;
        }
        if (stored.StartsWith(V1Prefix, StringComparison.Ordinal))
        {
            return _protector.Unprotect(stored[V1Prefix.Length..]);
        }
        // Legacy plaintext (pre-encryption). Returned as-is so existing installations keep
        // working; the next call to UpsertAsync / UpdateTokensAsync re-encrypts.
        return stored;
    }

    public string? UnprotectOrNull(string? stored) =>
        string.IsNullOrEmpty(stored) ? stored : Unprotect(stored);
}