using System.ComponentModel.DataAnnotations;

namespace Viritura.Api.Contracts.Auth;

public sealed record RegisterRequest
{
    [Required, EmailAddress, StringLength(254)]
    public string Email { get; init; } = string.Empty;

    [Required, MinLength(12), StringLength(512)]
    public string Password { get; init; } = string.Empty;

    [StringLength(64)]
    public string? DisplayName { get; init; }
}

/// <summary>
/// Returned by <c>POST /auth/register</c> when the registration is pending an email round-trip
/// before the user is signed in:
/// <list type="bullet">
///   <item>
///     <c>RequiresVerification</c> — a brand-new account was created with
///     <c>EmailConfirmed=false</c>; the user must click the verification link to activate it.
///   </item>
///   <item>
///     <c>LinkExistingAccount</c> — the email is already attached to an OAuth-only account
///     (no password set). To avoid an account-takeover vector we don't accept the submitted
///     password; instead we send a password-reset-style link to the verified mailbox. Clicking
///     the link proves mailbox control and lets the user set the password they want, linking
///     it to the existing OAuth account.
///   </item>
/// </list>
/// Exactly one of the two flags is true. The client routes both cases to a "check your email"
/// screen and varies copy on the flag.
/// </summary>
public sealed record RegisterPendingVerificationResponse(
    string Email,
    bool RequiresVerification,
    bool LinkExistingAccount = false);

/// <summary>
/// Posted to <c>POST /auth/verify</c> by the verification landing page on the marketing site.
/// </summary>
public sealed record VerifyEmailRequest
{
    [Required, StringLength(450)]
    public string Uid { get; init; } = string.Empty;

    [Required, StringLength(4096)]
    public string Token { get; init; } = string.Empty;
}

/// <summary>
/// Posted to <c>POST /auth/resend-verification</c> from the "didn't get the email?" link. Always returns
/// 204 regardless of whether the email matches a real account (prevents enumeration).
/// </summary>
public sealed record ResendVerificationRequest
{
    [Required, EmailAddress, StringLength(254)]
    public string Email { get; init; } = string.Empty;
}

/// <summary>
/// Posted to <c>POST /auth/forgot-password</c> from the "forgot password?" link. Always returns 204 to
/// avoid leaking which addresses are registered.
/// </summary>
public sealed record ForgotPasswordRequest
{
    [Required, EmailAddress, StringLength(254)]
    public string Email { get; init; } = string.Empty;
}

/// <summary>
/// Posted to <c>POST /auth/reset-password</c> from the reset landing page on the marketing site. On
/// success the user is signed in and the cookie is set, so the page can redirect into the editor.
/// </summary>
public sealed record ResetPasswordRequest
{
    [Required, StringLength(450)]
    public string Uid { get; init; } = string.Empty;

    [Required, StringLength(4096)]
    public string Token { get; init; } = string.Empty;

    [Required, MinLength(12), StringLength(512)]
    public string NewPassword { get; init; } = string.Empty;
}

public sealed record LoginRequest
{
    [Required, EmailAddress, StringLength(254)]
    public string Email { get; init; } = string.Empty;

    [Required, StringLength(512)]
    public string Password { get; init; } = string.Empty;

    public bool RememberMe { get; init; }
}

public sealed record AuthUserResponse(
    string Id,
    string Email,
    string? DisplayName,
    string? AvatarUrl,
    bool HasPassword,
    IReadOnlyList<AuthExternalLogin> ExternalLogins);

public sealed record AuthExternalLogin(string Provider, string ProviderKey, string? DisplayName);

public sealed record MeResponse(bool Authenticated, AuthUserResponse? User);

public sealed record CsrfResponse(string Token, string HeaderName);

public sealed record RecentAuthStatusResponse(bool Satisfied);

public sealed record RecentAuthPasswordRequest
{
    [Required, StringLength(32)]
    public string Action { get; init; } = string.Empty;

    [Required, StringLength(512)]
    public string Password { get; init; } = string.Empty;

    [StringLength(16)]
    public string? Code { get; init; }
}

/// <summary>
/// Public, non-sensitive authentication availability. The email allow-list is
/// deliberately not included.
/// </summary>
public sealed record AuthCapabilitiesResponse(
    bool GitHubLoginEnabled,
    bool GoogleLoginEnabled,
    string EmailRegistrationMode);

/// <summary>
/// Server-authoritative switches for public authentication surfaces. Client
/// capability responses mirror these values for presentation, but every
/// protected action is enforced again by the API.
/// </summary>
public sealed class AuthFeatureOptions
{
    public const string SectionName = "Features:Authentication";

    /// <summary>
    /// Enables Google OAuth only when credentials are also configured. Defaults
    /// off so adding credentials cannot accidentally expose an unfinished
    /// provider in production.
    /// </summary>
    public bool GoogleLoginEnabled { get; set; }

    /// <summary>
    /// Controls creation of new email/password accounts. Existing accounts can
    /// still use registration's mailbox-controlled password-linking flow.
    /// </summary>
    public EmailRegistrationMode EmailRegistrationMode { get; set; } = EmailRegistrationMode.Open;

    /// <summary>
    /// Email addresses permitted to create an account in <see
    /// cref="EmailRegistrationMode.AllowList"/> mode. Values are trimmed
    /// and compared case-insensitively; they are never returned by public APIs.
    /// </summary>
    public ICollection<string> EmailRegistrationAllowList { get; } = [];

    public bool CanCreateEmailAccount(string email)
    {
        return EmailRegistrationMode switch
        {
            EmailRegistrationMode.Open => true,
            EmailRegistrationMode.Disabled => false,
            EmailRegistrationMode.AllowList => EmailRegistrationAllowList.Any(
                allowed => string.Equals(allowed.Trim(), email.Trim(), StringComparison.OrdinalIgnoreCase)),
            _ => false
        };
    }
}

public enum EmailRegistrationMode
{
    Open,
    AllowList,
    Disabled
}

// ---- Two-factor authentication --------------------------------------------------

/// <summary>
/// Response shape for <c>POST /auth/login</c>. When the account has 2FA enabled the password step
/// succeeds but no auth cookie is set yet; Identity instead drops the 2FA-partial cookie and the
/// client must submit a TOTP / recovery code to <c>/auth/login/2fa</c> or <c>/auth/login/recovery</c>.
/// </summary>
public sealed record LoginResponse(bool RequiresTwoFactor, AuthUserResponse? User);

public sealed record TwoFactorLoginRequest
{
    [Required, StringLength(64)]
    public string Code { get; init; } = string.Empty;

    public bool RememberClient { get; init; }
}

public sealed record TwoFactorRecoveryLoginRequest
{
    [Required, StringLength(32)]
    public string Code { get; init; } = string.Empty;
}

public sealed record TwoFactorStatusResponse(bool Enabled, int RemainingRecoveryCodes);

/// <summary>
/// Returned by <c>POST /2fa/setup</c>. The authenticator key is the base32-encoded shared secret;
/// the otpauth URI is what authenticator apps consume directly (typically rendered as a QR code).
/// </summary>
public sealed record TwoFactorSetupResponse(string Secret, string OtpAuthUri);

public sealed record TwoFactorCodeRequest
{
    [Required, StringLength(450)]
    public string Code { get; init; } = string.Empty;
}

public sealed record TwoFactorRecoveryCodesResponse(IReadOnlyList<string> RecoveryCodes);

/// <summary>
/// Posted to <c>POST /auth/2fa/disable-by-recovery-token</c> from the website's 2FA-recovery
/// landing page. The user got here by clicking the link emailed by
/// <c>POST /auth/login/2fa-recover</c>. On success 2FA is disabled, the authenticator key is
/// cleared, the partial recovery codes are invalidated, and the full auth cookie is set.
/// </summary>
public sealed record TwoFactorRecoveryDisableRequest
{
    [Required, StringLength(4096)]
    public string Uid { get; init; } = string.Empty;

    [Required, StringLength(450)]
    public string Token { get; init; } = string.Empty;
}

/// <summary>
/// Posted to <c>POST /auth/confirm-email-change</c> from the website's confirm-email-change
/// landing page. The user got here by clicking the link emailed by
/// <c>POST /account/email</c>. On success the account email + username swap to
/// <paramref name="NewEmail"/>, the security stamp rolls (invalidating other sessions / tokens),
/// and the full auth cookie is set so the page can redirect into the editor.
/// </summary>
public sealed record ConfirmEmailChangeRequest
{
    [Required]
    public string Uid { get; init; } = string.Empty;

    [Required, EmailAddress, StringLength(254)]
    public string NewEmail { get; init; } = string.Empty;

    [Required, StringLength(4096)]
    public string Token { get; init; } = string.Empty;
}