namespace Viritura.Api;

/// <summary>
/// Cross-provider rules for "is this email safe to use as an auto-link key?"
///
/// Auto-linking attaches a new OAuth identity to an existing Viritura account that already
/// owns the email address. That's only safe when the address is a real mailbox the human
/// human-readably controls — synthetic provider-internal addresses (like GitHub's noreply
/// proxy) are routable but anyone with a matching GitHub login owns them, so allowing
/// auto-link on them would let one provider hijack accounts created via another.
/// </summary>
public static class ProviderEmailPolicy
{
    private static readonly string[] SyntheticDomains =
    [
        // GitHub privacy-proxy address. Format: "<id>+<login>@users.noreply.github.com" or
        // "<login>@users.noreply.github.com". Routable through GitHub, but ownership is the
        // GitHub login — not a verified mailbox the user proved control of out-of-band.
        "users.noreply.github.com",
        // GitLab analogue, future-proofing.
        "users.noreply.gitlab.com",
        // Apple's Sign in with Apple private relay. Trustworthy but rotates per-app, so
        // collisions across providers are meaningless.
        "privaterelay.appleid.com"
    ];

    /// <summary>
    /// True when <paramref name="email"/> may be used as a key to auto-link a new OAuth
    /// identity to an existing account. False for null/empty/synthetic addresses.
    /// </summary>
    public static bool IsAutoLinkable(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return false;
        }

        var at = email.LastIndexOf('@');
        if (at < 0 || at == email.Length - 1)
        {
            return false;
        }

        var domain = email.AsSpan(at + 1);
        foreach (var synthetic in SyntheticDomains)
        {
            if (domain.Equals(synthetic, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }
        return true;
    }
}