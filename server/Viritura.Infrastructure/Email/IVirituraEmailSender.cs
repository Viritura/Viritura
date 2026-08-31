using Microsoft.AspNetCore.Identity;

namespace Viritura.Infrastructure.Email;

/// <summary>
/// Viritura-specific email notifications that don't fit ASP.NET Core Identity's built-in
/// <see cref="IEmailSender{TUser}"/> surface (which is limited to email confirmation and
/// password-reset code/link templates).
///
/// Today this covers the two-factor recovery flow — when a user no longer has access to their
/// authenticator app or recovery codes, they request a recovery link that disables 2FA on the
/// account. The link is sent here so a real email provider can ship a distinct template later
/// (separate subject, distinct security copy) without overloading the password-reset template.
/// </summary>
public interface IVirituraEmailSender
{
    /// <summary>
    /// Sends a "click to disable 2FA on your account" link. The link should land on the website's
    /// confirmation page, which requires an explicit user click before calling the disable
    /// endpoint — never auto-disable on link visit (that would let link prefetchers and security
    /// scanners disable accounts).
    /// </summary>
    Task SendTwoFactorRecoveryLinkAsync(AppUser user, string email, string recoveryLink);

    /// <summary>
    /// Sends an email-change confirmation link to the proposed <paramref name="newEmail"/>. The
    /// link lands on the website's confirmation page, which POSTs the consumed token back to the
    /// API to perform the actual switch. Sending to the NEW address is the entire mailbox-control
    /// proof; the change must not happen until the link is clicked.
    /// </summary>
    Task SendEmailChangeLinkAsync(AppUser user, string newEmail, string confirmationLink);

    /// <summary>
    /// Notifies the CURRENT (old) email address that an email change has been requested. This is
    /// not part of the consent path — it is a notification only — but it gives a legitimate
    /// account owner an immediate signal if an attacker who has hijacked their session tries to
    /// pivot the account to an attacker-controlled mailbox. The body should advise the user to
    /// change their password and sign out everywhere if they did not request the change.
    /// </summary>
    Task SendEmailChangeNotificationAsync(AppUser user, string oldEmail, string newEmail);

    // ───────────────────────────── Security-event notifications ─────────────────────────────
    //
    // Every credential-surface change on a signed-in account also fires an out-of-band
    // notification to the registered mailbox. The pattern is "do the thing, then tell the user"
    // — these notifications never block or gate the action; they are the recovery signal for a
    // session-hijack scenario where the attacker controls the cookie but not the mailbox.
    //
    // Each method takes the user (for templating display name / locale later) and the email to
    // send to, which is always <c>user.Email</c> at call time. We pass it explicitly so the
    // caller can decide what to do if the mailbox is null/unconfirmed (typically: skip).

    /// <summary>
    /// Notifies the user that a new external login (Google / GitHub) was attached to their
    /// account. Critical signal: an attacker with a hijacked session may attempt to attach their
    /// own provider identity as a persistent backdoor that survives password rotation.
    /// </summary>
    Task SendExternalLoginAddedNotificationAsync(AppUser user, string email, string provider);

    /// <summary>
    /// Notifies the user that an external login was removed from their account. Lower-severity
    /// signal than addition, but still useful — an attacker may try to remove the victim's only
    /// external login after attaching their own as the new entry point.
    /// </summary>
    Task SendExternalLoginRemovedNotificationAsync(AppUser user, string email, string provider);

    /// <summary>
    /// Notifies the user that a password was just set on an account that previously had none
    /// (OAuth-only → password+OAuth). Persistence vector: an attacker with a hijacked session
    /// can add their own password and use it to re-enter even after the OAuth link is revoked.
    /// </summary>
    Task SendPasswordSetNotificationAsync(AppUser user, string email);

    /// <summary>
    /// Notifies the user that an existing password was changed. ChangePassword is already
    /// re-auth gated by the current password, so this notification primarily catches a
    /// scenario where the attacker also has the current password (e.g. credential stuffing).
    /// </summary>
    Task SendPasswordChangedNotificationAsync(AppUser user, string email);

    /// <summary>
    /// Notifies the user that their password was removed (leaving only external logins). An
    /// attacker who already attached their own external login could call this to lock out the
    /// legitimate user once the victim notices the link and revokes it.
    /// </summary>
    Task SendPasswordRemovedNotificationAsync(AppUser user, string email);

    /// <summary>Notifies the user that two-factor authentication was enabled on their account.</summary>
    Task SendTwoFactorEnabledNotificationAsync(AppUser user, string email);

    /// <summary>
    /// Notifies the user that two-factor authentication was disabled. The Disable endpoint is
    /// gated by a current TOTP, so an attacker without authenticator-app access cannot trigger
    /// this — but if they have stolen both the cookie AND a recovery code (via the recovery-by-
    /// email flow) this notification is the last out-of-band signal before the account is fully
    /// theirs.
    /// </summary>
    Task SendTwoFactorDisabledNotificationAsync(AppUser user, string email);

    /// <summary>
    /// Notifies the user that their 2FA recovery codes were regenerated (invalidating the
    /// previous batch). An attacker with a hijacked session could rotate codes to lock the
    /// victim out of the recovery flow if the victim hadn't memorised the old ones.
    /// </summary>
    Task SendRecoveryCodesRegeneratedNotificationAsync(AppUser user, string email);
}