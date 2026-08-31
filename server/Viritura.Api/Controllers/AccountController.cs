using System.ComponentModel.DataAnnotations;

using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;

using Viritura.Infrastructure;
using Viritura.Infrastructure.Email;

namespace Viritura.Api.Controllers;

[ApiController]
[Microsoft.AspNetCore.Cors.EnableCors("VirituraEditor")]
[Route("account")]
[Authorize]
[EnableRateLimiting("Auth")]
public sealed class AccountController(
    UserManager<AppUser> userManager,
    SignInManager<AppUser> signInManager,
    IVirituraEmailSender virituraEmailSender,
    IConfiguration configuration,
    IAntiforgery antiforgery,
    RecentAuthService recentAuth) : ControllerBase
{
    /// <summary>
    /// Base URL of the marketing website that hosts <c>/auth/confirm-email-change?uid=…&amp;email=…&amp;token=…</c>.
    /// Mirrors <see cref="AuthController"/>.
    /// </summary>
    private string WebsiteBaseUrl =>
        configuration["Auth:WebsiteBaseUrl"]?.TrimEnd('/') ?? "http://localhost:5180";

    public sealed record UnlinkRequest
    {
        [Required, StringLength(64)]
        public string Provider { get; init; } = string.Empty;

        [Required, StringLength(128)]
        public string ProviderKey { get; init; } = string.Empty;

        /// <summary>Required when the account has a password set; ignored otherwise.</summary>
        [StringLength(512)]
        public string? CurrentPassword { get; init; }
    }

    public sealed record UpdateProfileRequest
    {
        /// <summary>
        /// New display name. Whitespace-only is normalized to <c>null</c> (clears the field).
        /// Capped at 64 chars so the value can safely flow through UI chrome (menu bars, avatars,
        /// share dialogs) without truncation logic everywhere.
        /// </summary>
        [StringLength(64)]
        public string? DisplayName { get; init; }
    }

    public sealed record ChangePasswordRequest
    {
        [Required, StringLength(512)]
        public string CurrentPassword { get; init; } = string.Empty;

        [Required, MinLength(12), StringLength(512)]
        public string NewPassword { get; init; } = string.Empty;
    }

    public sealed record SetPasswordRequest
    {
        [Required, MinLength(12), StringLength(512)]
        public string NewPassword { get; init; } = string.Empty;
    }

    public sealed record RemovePasswordRequest
    {
        [Required, StringLength(512)]
        public string CurrentPassword { get; init; } = string.Empty;
    }

    /// <summary>
    /// Permanent account deletion. Requires the current password if one is set (re-auth gate);
    /// for OAuth-only accounts the live cookie session + antiforgery token are the gate (any
    /// in-app "Delete account" UI must require a confirmation tap before posting).
    /// <para/>
    /// Deletion cascades by EF/Identity conventions:
    /// <list type="bullet">
    ///   <item><c>AspNetUserLogins</c>, <c>AspNetUserClaims</c>, <c>AspNetUserRoles</c>,
    ///         <c>AspNetUserTokens</c> — Identity FKs are configured to cascade.</item>
    ///   <item><c>UserGitHubInstallations</c> — configured with
    ///         <c>OnDelete(DeleteBehavior.Cascade)</c> in <c>VirituraDbContext</c>.</item>
    /// </list>
    /// New per-user owned tables added in the future must opt into cascade or be cleaned up here.
    /// </summary>
    public sealed record DeleteAccountRequest
    {
        /// <summary>Required when the account has a password set; ignored otherwise.</summary>
        [StringLength(512)]
        public string? CurrentPassword { get; init; }
    }

    public sealed record ChangeEmailRequest
    {
        [Required, EmailAddress, StringLength(254)]
        public string NewEmail { get; init; } = string.Empty;

        /// <summary>Required when the account has a password set; ignored otherwise.</summary>
        [StringLength(512)]
        public string? CurrentPassword { get; init; }
    }

    [HttpPost("unlink")]
    public async Task<IActionResult> Unlink([FromBody] UnlinkRequest request)
    {
        if (!await ValidateAntiforgeryAsync())
        {
            return BadRequest(new { error = "Antiforgery token missing or invalid." });
        }

        if (string.IsNullOrWhiteSpace(request.Provider) || string.IsNullOrWhiteSpace(request.ProviderKey))
        {
            return BadRequest(new { error = "Provider and providerKey are required." });
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        // Orphan prevention: user must keep at least one way to sign in.
        var hasPassword = await userManager.HasPasswordAsync(user);
        var logins = await userManager.GetLoginsAsync(user);
        var remainingLogins = logins.Count(l =>
            !(l.LoginProvider == request.Provider && l.ProviderKey == request.ProviderKey));

        if (!hasPassword && remainingLogins == 0)
        {
            return Conflict(new { error = "Cannot unlink the only sign-in method. Set a password or link another provider first." });
        }

        // Re-auth gate when a password is set: unlinking changes the user's sign-in surface,
        // so a stolen cookie alone should not be enough. OAuth-only accounts skip the gate
        // (cookie + antiforgery + the orphan check above are the gate).
        if (hasPassword)
        {
            if (string.IsNullOrEmpty(request.CurrentPassword)
                || !await userManager.CheckPasswordAsync(user, request.CurrentPassword))
            {
                ModelState.AddModelError(nameof(UnlinkRequest.CurrentPassword), "Incorrect password.");
                return ValidationProblem(ModelState);
            }
        }
        else if (!recentAuth.TryConsume(Request, Response, user, RecentAuthAction.UnlinkLogin))
        {
            return RecentAuthRequired();
        }

        var result = await userManager.RemoveLoginAsync(user, request.Provider, request.ProviderKey);
        if (!result.Succeeded)
        {
            return BadRequest(new { error = "Failed to unlink provider.", details = result.Errors.Select(e => e.Description) });
        }

        await signInManager.RefreshSignInAsync(user);
        await NotifyAsync(user, (sender, mailbox) =>
            sender.SendExternalLoginRemovedNotificationAsync(user, mailbox, request.Provider));
        return NoContent();
    }

    /// <summary>
    /// Replaces the user's password while signed in. Requires the current password as a re-auth gate.
    /// For OAuth-only users (no password set), call <c>POST /account/password/set</c> instead.
    /// </summary>
    [HttpPost("password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        if (!await ValidateAntiforgeryAsync())
        {
            return BadRequest(new { error = "Antiforgery token missing or invalid." });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        if (!await userManager.HasPasswordAsync(user))
        {
            return Conflict(new { error = "No password is set on this account. Use 'set password' instead." });
        }

        var result = await userManager.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded)
        {
            foreach (var error in result.Errors)
            {
                // Identity reports a specific code for the current-password check; route that to the
                // currentPassword field so the client can highlight it.
                var key = error.Code == "PasswordMismatch"
                    ? nameof(ChangePasswordRequest.CurrentPassword)
                    : nameof(ChangePasswordRequest.NewPassword);
                ModelState.AddModelError(key, error.Description);
            }
            return ValidationProblem(ModelState);
        }

        await signInManager.RefreshSignInAsync(user);
        await NotifyAsync(user, (sender, mailbox) =>
            sender.SendPasswordChangedNotificationAsync(user, mailbox));
        return NoContent();
    }

    /// <summary>
    /// Sets an initial password for an account that doesn't have one (typically OAuth-only users
    /// who want a password fallback). Does NOT require a current-password gate because there is
    /// none — but does require an authenticated session (cookie) and a valid antiforgery token,
    /// so an attacker can't add a password unless the user is already signed in here.
    /// </summary>
    [HttpPost("password/set")]
    public async Task<IActionResult> SetPassword([FromBody] SetPasswordRequest request)
    {
        if (!await ValidateAntiforgeryAsync())
        {
            return BadRequest(new { error = "Antiforgery token missing or invalid." });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        if (await userManager.HasPasswordAsync(user))
        {
            return Conflict(new { error = "A password is already set. Use 'change password' instead." });
        }

        if (!recentAuth.TryConsume(Request, Response, user, RecentAuthAction.SetPassword))
        {
            return RecentAuthRequired();
        }

        var result = await userManager.AddPasswordAsync(user, request.NewPassword);
        if (!result.Succeeded)
        {
            foreach (var error in result.Errors)
            {
                ModelState.AddModelError(nameof(SetPasswordRequest.NewPassword), error.Description);
            }
            return ValidationProblem(ModelState);
        }

        await signInManager.RefreshSignInAsync(user);
        await NotifyAsync(user, (sender, mailbox) =>
            sender.SendPasswordSetNotificationAsync(user, mailbox));
        return NoContent();
    }

    /// <summary>
    /// Removes the password from an account that has at least one external login. Symmetric to
    /// unlink: refuses if the password is the user's only sign-in method.
    /// </summary>
    [HttpPost("password/remove")]
    public async Task<IActionResult> RemovePassword([FromBody] RemovePasswordRequest request)
    {
        if (!await ValidateAntiforgeryAsync())
        {
            return BadRequest(new { error = "Antiforgery token missing or invalid." });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        if (!await userManager.HasPasswordAsync(user))
        {
            return Conflict(new { error = "No password is set on this account." });
        }

        var logins = await userManager.GetLoginsAsync(user);
        if (logins.Count == 0)
        {
            return Conflict(new { error = "Cannot remove the only sign-in method. Link an external provider first." });
        }

        // Re-auth gate: require the current password so a stolen session can't silently lock the
        // legitimate user out by removing their password while we keep an external login.
        if (!await userManager.CheckPasswordAsync(user, request.CurrentPassword))
        {
            ModelState.AddModelError(nameof(RemovePasswordRequest.CurrentPassword), "Incorrect password.");
            return ValidationProblem(ModelState);
        }

        var result = await userManager.RemovePasswordAsync(user);
        if (!result.Succeeded)
        {
            return BadRequest(new { error = "Failed to remove password.", details = result.Errors.Select(e => e.Description) });
        }

        await signInManager.RefreshSignInAsync(user);
        await NotifyAsync(user, (sender, mailbox) =>
            sender.SendPasswordRemovedNotificationAsync(user, mailbox));
        return NoContent();
    }

    /// <summary>
    /// Permanently deletes the signed-in user's account. Requires the current password as a
    /// re-auth gate when one is set; for OAuth-only accounts the cookie + antiforgery token are
    /// the gate. On success the cookie is cleared (<c>SignOutAsync</c>) and the user row is
    /// removed; FK cascades clean up logins, claims, tokens, and Viritura-owned per-user tables.
    /// </summary>
    [HttpPost("delete")]
    public async Task<IActionResult> Delete([FromBody] DeleteAccountRequest request)
    {
        if (!await ValidateAntiforgeryAsync())
        {
            return BadRequest(new { error = "Antiforgery token missing or invalid." });
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        if (await userManager.HasPasswordAsync(user))
        {
            if (string.IsNullOrEmpty(request.CurrentPassword)
                || !await userManager.CheckPasswordAsync(user, request.CurrentPassword))
            {
                ModelState.AddModelError(nameof(DeleteAccountRequest.CurrentPassword), "Incorrect password.");
                return ValidationProblem(ModelState);
            }
        }
        else if (!recentAuth.TryConsume(Request, Response, user, RecentAuthAction.DeleteAccount))
        {
            return RecentAuthRequired();
        }

        // Sign out first so the cookie is cleared even if Delete fails (no orphan cookie pointing
        // at a half-deleted user). SignOutAsync only writes to the response; the Identity user
        // row is still intact at this point.
        await signInManager.SignOutAsync();

        var result = await userManager.DeleteAsync(user);
        if (!result.Succeeded)
        {
            return BadRequest(new { error = "Failed to delete account.", details = result.Errors.Select(e => e.Description) });
        }

        return NoContent();
    }

    /// <summary>
    /// Initiates an email-change. We don't update the user record here — instead we generate a
    /// change-email token and send the confirmation link to the NEW address. Mailbox control on
    /// the new address is the entire proof; the actual swap happens at
    /// <c>POST /auth/confirm-email-change</c>.
    /// <para/>
    /// Requires the current password as a re-auth gate when one is set (defense-in-depth: a
    /// stolen session can't silently move the account to an attacker-controlled mailbox).
    /// Returns 204 in all "request accepted" cases including when the new address is already
    /// claimed by another account — we don't want to leak which addresses are registered. The
    /// user simply never receives the confirmation email in that case.
    /// </summary>
    [HttpPost("email")]
    public async Task<IActionResult> ChangeEmail([FromBody] ChangeEmailRequest request)
    {
        if (!await ValidateAntiforgeryAsync())
        {
            return BadRequest(new { error = "Antiforgery token missing or invalid." });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        if (await userManager.HasPasswordAsync(user))
        {
            if (string.IsNullOrEmpty(request.CurrentPassword)
                || !await userManager.CheckPasswordAsync(user, request.CurrentPassword))
            {
                ModelState.AddModelError(nameof(ChangeEmailRequest.CurrentPassword), "Incorrect password.");
                return ValidationProblem(ModelState);
            }
        }
        else if (!recentAuth.TryConsume(Request, Response, user, RecentAuthAction.ChangeEmail))
        {
            return RecentAuthRequired();
        }

        // Same address (case-insensitive) — nothing to do. Treat as success so the UI doesn't
        // need a special branch.
        if (string.Equals(user.Email, request.NewEmail, StringComparison.OrdinalIgnoreCase))
        {
            return NoContent();
        }

        // Only send the confirmation link if the new address isn't already taken. If it is, we
        // still return 204 below so callers can't enumerate registered addresses through this
        // endpoint.
        var existing = await userManager.FindByEmailAsync(request.NewEmail);
        if (existing is null)
        {
            var token = await userManager.GenerateChangeEmailTokenAsync(user, request.NewEmail);
            var url = string.Concat(
                WebsiteBaseUrl,
                "/auth/confirm-email-change#uid=",
                Uri.EscapeDataString(user.Id),
                "&email=",
                Uri.EscapeDataString(request.NewEmail),
                "&token=",
                Uri.EscapeDataString(token));
            await virituraEmailSender.SendEmailChangeLinkAsync(user, request.NewEmail, url);
        }

        // Defence against session-hijack-to-account-takeover: notify the CURRENT address that a
        // change was requested, so the legitimate owner gets an immediate out-of-band signal even
        // if the attacker also controls the in-app session. Sent on BOTH the link-issued path
        // (existing is null) and the duplicate-target path so an attacker can't silently probe
        // for a free target address by picking ones that happen to be registered. Skipped when
        // the current mailbox is unconfirmed \u2014 there's no proof the address is owned by anyone,
        // and the notification could be sent to a typo'd / abandoned address.
        if (!string.IsNullOrEmpty(user.Email) && user.EmailConfirmed)
        {
            await virituraEmailSender.SendEmailChangeNotificationAsync(user, user.Email, request.NewEmail);
        }

        return NoContent();
    }

    /// <summary>
    /// Updates mutable profile fields on the signed-in account. Currently exposes only
    /// <see cref="AppUser.DisplayName"/>; future fields (avatar URL override, locale, etc.) can
    /// land on the same endpoint without a contract bump because <see cref="UpdateProfileRequest"/>
    /// uses nullable properties (omitted properties remain unchanged — though today the only
    /// field is always overwritten because there's nothing else to compose with).
    /// </summary>
    [HttpPost("profile")]
    public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request)
    {
        if (!await ValidateAntiforgeryAsync())
        {
            return BadRequest(new { error = "Antiforgery token missing or invalid." });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        // Trim + collapse-whitespace-to-null so the row carries either a meaningful value or null,
        // never "   " or "". DisplayName is the only field today; add more here as the contract grows.
        var trimmed = string.IsNullOrWhiteSpace(request.DisplayName) ? null : request.DisplayName.Trim();
        user.DisplayName = trimmed;

        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded)
        {
            return BadRequest(new { error = "Failed to update profile.", details = result.Errors.Select(e => e.Description) });
        }

        return NoContent();
    }

    private async Task<bool> ValidateAntiforgeryAsync()
    {
        try
        {
            await antiforgery.ValidateRequestAsync(HttpContext);
            return true;
        }
        catch (AntiforgeryValidationException)
        {
            return false;
        }
    }

    private ObjectResult RecentAuthRequired() =>
        StatusCode(StatusCodes.Status403Forbidden, new
        {
            error = "Recent authentication with an existing sign-in method is required.",
            requiresRecentAuth = true
        });

    /// <summary>
    /// Helper for the security-event notifications fired after credential-surface mutations
    /// (password set/change/remove, external login add/remove). Skipped when the user has no
    /// confirmed mailbox — we have no proof anyone reads that inbox, and sending to an
    /// unconfirmed pre-registration could leak the account's existence. Fired after the action
    /// succeeds and never blocks the response.
    /// </summary>
    private async Task NotifyAsync(
        AppUser user,
        Func<IVirituraEmailSender, string, Task> send)
    {
        if (string.IsNullOrEmpty(user.Email) || !user.EmailConfirmed) return;
        await send(virituraEmailSender, user.Email);
    }
}