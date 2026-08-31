using Microsoft.AspNetCore.Identity;

namespace Viritura.Infrastructure.Email;

/// <summary>
/// Shared account-email copy for console and production transports.
/// </summary>
public abstract class VirituraEmailSenderBase : IEmailSender<AppUser>, IVirituraEmailSender
{
    public Task SendConfirmationLinkAsync(AppUser user, string email, string confirmationLink) =>
        SendAsync(email, "Confirm your Viritura email", $"Click to confirm: {confirmationLink}");

    public Task SendPasswordResetLinkAsync(AppUser user, string email, string resetLink) =>
        SendAsync(email, "Reset your Viritura password", $"Click to reset: {resetLink}");

    public Task SendPasswordResetCodeAsync(AppUser user, string email, string resetCode) =>
        SendAsync(email, "Your Viritura password reset code", $"Reset code: {resetCode}");

    public Task SendTwoFactorRecoveryLinkAsync(AppUser user, string email, string recoveryLink) =>
        SendAsync(
            email,
            "Disable two-factor authentication on your Viritura account",
            $"Someone (hopefully you) requested to disable 2FA on your account.\n" +
            $"If this was you, click the link below to confirm — 2FA will be turned off and\n" +
            $"you'll be signed in. If this wasn't you, ignore this email and change your password.\n\n" +
            $"Click to confirm: {recoveryLink}");

    public Task SendEmailChangeLinkAsync(AppUser user, string newEmail, string confirmationLink) =>
        SendAsync(
            newEmail,
            "Confirm your new Viritura email address",
            $"Click the link below to confirm switching your Viritura account email to {newEmail}.\n" +
            $"If you didn't request this, ignore this message — the change won't happen until the\n" +
            $"link is clicked, and the link expires after a day.\n\n" +
            $"Click to confirm: {confirmationLink}");

    public Task SendEmailChangeNotificationAsync(AppUser user, string oldEmail, string newEmail) =>
        SendAsync(
            oldEmail,
            "Your Viritura account email is being changed",
            $"A request was just made to change the email on your Viritura account from\n" +
            $"{oldEmail} to {newEmail}.\n\n" +
            $"The change will only take effect once the new address is confirmed via the\n" +
            $"separate confirmation link sent to {newEmail}.\n\n" +
            $"If you didn't request this, change your password immediately and sign out of all\n" +
            $"devices from Account → Security.");

    public Task SendExternalLoginAddedNotificationAsync(AppUser user, string email, string provider) =>
        SendAsync(
            email,
            $"A new {provider} sign-in was attached to your Viritura account",
            $"A {provider} identity was just linked to your Viritura account.\n" +
            $"From now on, that {provider} account can sign in as you.\n\n" +
            $"If you did this — usually from Account → Connected accounts — no action is needed.\n" +
            $"If you didn't, an attacker may have access to your session: change your password,\n" +
            $"remove the unfamiliar {provider} link, and sign out of all devices from\n" +
            $"Account → Security.");

    public Task SendExternalLoginRemovedNotificationAsync(AppUser user, string email, string provider) =>
        SendAsync(
            email,
            $"A {provider} sign-in was removed from your Viritura account",
            $"The {provider} identity linked to your Viritura account was just removed.\n" +
            $"You will no longer be able to sign in via {provider}.\n\n" +
            $"If you didn't do this, change your password and sign out of all devices from\n" +
            $"Account → Security.");

    public Task SendPasswordSetNotificationAsync(AppUser user, string email) =>
        SendAsync(
            email,
            "A password was set on your Viritura account",
            "A password was just added to your Viritura account, which previously signed in\n" +
            "via an external provider only. You can now sign in with email + password as well.\n\n" +
            "If you didn't do this, an attacker may have hijacked your session: remove the\n" +
            "password from Account → Security, change any reused passwords elsewhere, and sign\n" +
            "out of all devices.");

    public Task SendPasswordChangedNotificationAsync(AppUser user, string email) =>
        SendAsync(
            email,
            "Your Viritura password was changed",
            "Your Viritura account password was just changed.\n\n" +
            "If you did this, no action is needed.\n" +
            "If you didn't, reset your password immediately from /auth/forgot-password and\n" +
            "sign out of all devices from Account → Security.");

    public Task SendPasswordRemovedNotificationAsync(AppUser user, string email) =>
        SendAsync(
            email,
            "The password was removed from your Viritura account",
            "The password on your Viritura account was just removed. From now on you can only\n" +
            "sign in via your linked external providers (Google / GitHub).\n\n" +
            "If you didn't do this, set a new password from Account → Security and review your\n" +
            "linked external accounts for anything you don't recognise.");

    public Task SendTwoFactorEnabledNotificationAsync(AppUser user, string email) =>
        SendAsync(
            email,
            "Two-factor authentication is now enabled on your Viritura account",
            "Two-factor authentication was just enabled on your Viritura account. Future sign-ins\n" +
            "will require a code from your authenticator app in addition to your password.\n\n" +
            "If you didn't do this, change your password and sign out of all devices from\n" +
            "Account → Security.");

    public Task SendTwoFactorDisabledNotificationAsync(AppUser user, string email) =>
        SendAsync(
            email,
            "Two-factor authentication is now disabled on your Viritura account",
            "Two-factor authentication was just disabled on your Viritura account.\n\n" +
            "If you didn't do this, re-enable it immediately from Account → Security, change\n" +
            "your password, and sign out of all devices.");

    public Task SendRecoveryCodesRegeneratedNotificationAsync(AppUser user, string email) =>
        SendAsync(
            email,
            "Your Viritura two-factor recovery codes were regenerated",
            "Your 2FA recovery codes were just regenerated. Any unused codes from the previous\n" +
            "batch will no longer work.\n\n" +
            "If you didn't do this, change your password, sign out of all devices, and review\n" +
            "your account from Account → Security.");

    protected abstract Task SendAsync(string recipient, string subject, string body);
}