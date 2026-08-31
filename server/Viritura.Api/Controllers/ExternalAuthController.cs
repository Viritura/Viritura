using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

using Viritura.Api.Contracts.Auth;
using Viritura.Infrastructure;
using Viritura.Infrastructure.Email;

namespace Viritura.Api.Controllers;

/// <summary>
/// External (Google) sign-in challenge + callback. GitHub has its own controller
/// (custom OAuth flow); Google rides Identity's built-in external-login pipeline.
/// </summary>
[ApiController]
[Route("auth/external")]
[EnableCors("VirituraFrontends")]
[EnableRateLimiting("Auth")]
public sealed class ExternalAuthController(
    UserManager<AppUser> userManager,
    SignInManager<AppUser> signInManager,
    IVirituraEmailSender virituraEmailSender,
    FrontendOriginPolicy frontendOriginPolicy,
    RecentAuthService recentAuth,
    IConfiguration configuration,
    IOptions<AuthFeatureOptions> authFeatures) : ControllerBase
{
    private bool GoogleLoginAvailable =>
        authFeatures.Value.GoogleLoginEnabled
        && !string.IsNullOrWhiteSpace(configuration["Authentication:Google:ClientId"])
        && !string.IsNullOrWhiteSpace(configuration["Authentication:Google:ClientSecret"]);

    [HttpGet("google/start")]
    [AllowAnonymous]
    public IActionResult StartGoogle([FromQuery] string? returnTo)
    {
        if (!GoogleLoginAvailable) return NotFound();
        var redirectUrl = Url.Action(nameof(GoogleCallback), "ExternalAuth", new { returnTo });
        var properties = signInManager.ConfigureExternalAuthenticationProperties(GoogleDefaults.AuthenticationScheme, redirectUrl);
        return Challenge(properties, GoogleDefaults.AuthenticationScheme);
    }

    [HttpGet("google/callback")]
    [AllowAnonymous]
    public async Task<IActionResult> GoogleCallback([FromQuery] string? returnTo, [FromQuery(Name = "remoteError")] string? remoteError)
    {
        if (!GoogleLoginAvailable) return NotFound();
        if (!string.IsNullOrEmpty(remoteError))
        {
            return BadRequest(new { error = $"External provider error: {remoteError}" });
        }

        var info = await signInManager.GetExternalLoginInfoAsync();
        if (info is null)
        {
            return BadRequest(new { error = "External login info was not available." });
        }

        if (returnTo?.StartsWith(RecentAuthService.FlowPrefix, StringComparison.Ordinal) == true)
        {
            var current = await userManager.GetUserAsync(User);
            if (current is null ||
                !recentAuth.TryConsumeProviderFlow(returnTo, current.Id, "Google", out var action, out var flowReturnTo))
            {
                return Unauthorized(new { error = "The provider reauthentication flow is invalid or expired." });
            }
            var currentLogins = await userManager.GetLoginsAsync(current);
            if (!currentLogins.Any(login =>
                    login.LoginProvider == info.LoginProvider && login.ProviderKey == info.ProviderKey))
            {
                return Unauthorized(new { error = "Reauthentication must use an already-linked provider identity." });
            }
            recentAuth.Issue(Response, current, action, "google");
            return Redirect(flowReturnTo);
        }

        // 1) Existing external login → sign in.
        var linkedUser = await userManager.FindByLoginAsync(info.LoginProvider, info.ProviderKey);
        if (linkedUser is not null && !linkedUser.EmailConfirmed && string.IsNullOrEmpty(linkedUser.Email))
        {
            // Provider identity is the confirmed sign-in key for an OAuth-only
            // account even when the provider supplies no usable mailbox.
            linkedUser.EmailConfirmed = true;
            await userManager.UpdateAsync(linkedUser);
        }
        var signIn = await signInManager.ExternalLoginSignInAsync(
            info.LoginProvider,
            info.ProviderKey,
            isPersistent: true,
            bypassTwoFactor: false);
        if (signIn.Succeeded)
        {
            // Refresh the cached avatar so display updates when the user changes their
            // Google profile picture. Cheap: one UPDATE if the URL actually changed.
            await RefreshAvatarFromGoogleAsync(info);
            return LocalRedirectOrHome(returnTo);
        }
        if (signIn.RequiresTwoFactor)
        {
            return Redirect(BuildTwoFactorRequiredUrl(returnTo));
        }

        // 2) Already authenticated → link to current account.
        if (User.Identity?.IsAuthenticated == true)
        {
            var current = await userManager.GetUserAsync(User);
            if (current is not null)
            {
                var currentLogins = await userManager.GetLoginsAsync(current);
                var alreadyLinked = currentLogins.Any(login =>
                    login.LoginProvider == info.LoginProvider && login.ProviderKey == info.ProviderKey);
                if (!alreadyLinked && !recentAuth.TryConsume(Request, Response, current, RecentAuthAction.LinkLogin))
                {
                    return StatusCode(StatusCodes.Status403Forbidden, new
                    {
                        error = "Recent authentication is required before linking a provider."
                    });
                }
                var addLink = await userManager.AddLoginAsync(current, info);
                ApplyGoogleAvatar(current, info, overwrite: false);
                await userManager.UpdateAsync(current);
                await signInManager.SignInAsync(current, isPersistent: true);
                if (addLink.Succeeded)
                {
                    await NotifyAsync(current, (sender, mailbox) =>
                        sender.SendExternalLoginAddedNotificationAsync(current, mailbox, "Google"));
                }
                return LocalRedirectOrHome(returnTo);
            }
        }

        // 3) New user → bootstrap.
        // OAuth-provisioned accounts don't require an email — the Google identity is the natural
        // key. Use the verified email when Google gives us one, otherwise leave Email null.
        var emailClaim = info.Principal.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
        var email = string.IsNullOrWhiteSpace(emailClaim) ? null : emailClaim;
        var displayName = info.Principal.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value;
        // Google's ID token carries email_verified; we surface it as the urn:google:email_verified
        // claim via AddGoogle's ClaimActions (see Program.cs). Treat missing as false.
        var emailVerified = string.Equals(
            info.Principal.FindFirst("urn:google:email_verified")?.Value,
            "true",
            StringComparison.OrdinalIgnoreCase);

        // Auto-link removed (red-team CRITICAL-2): an attacker who pre-registered the email
        // could otherwise capture the legitimate user on their first Google sign-in. Instead,
        // when an existing Viritura account already owns this verified email, redirect the
        // user to the SPA's "link required" landing so they sign in via their existing method
        // and then explicitly link Google from settings. Synthetic *@privaterelay.appleid.com
        // style addresses skip this check (they aren't a real mailbox, so a collision would
        // mean we'd have already caught it via ExternalLoginSignInAsync).
        if (email is not null && emailVerified && ProviderEmailPolicy.IsAutoLinkable(email))
        {
            var byEmail = await userManager.FindByEmailAsync(email);
            if (byEmail is not null)
            {
                return Redirect(BuildLinkRequiredUrl("Google", email));
            }
        }

        // UserName must be non-null and unique. Key it on the stable Google provider key so it
        // can't collide with a future password-account UserName (which is normally the email).
        // The `google-` prefix is illegal as the local-part of any real email, so it can't
        // collide there either.
        // Don't persist non-verified or synthetic addresses on the row — Google's private-relay
        // address (privaterelay.appleid.com style) and unverified addresses aren't real proof
        // of mailbox ownership; persisting them would block a future legitimate auto-link.
        var persistedEmail = email is not null && emailVerified && ProviderEmailPolicy.IsAutoLinkable(email) ? email : null;
        var user = new AppUser
        {
            UserName = $"google-{info.ProviderKey}",
            Email = persistedEmail,
            EmailConfirmed = true,
            DisplayName = displayName
        };
        ApplyGoogleAvatar(user, info, overwrite: true);

        var create = await userManager.CreateAsync(user);
        if (!create.Succeeded)
        {
            return BadRequest(new { error = "Failed to provision Viritura user from Google identity.", details = create.Errors.Select(e => e.Description) });
        }

        var addLogin = await userManager.AddLoginAsync(user, info);
        if (!addLogin.Succeeded)
        {
            return BadRequest(new { error = "Failed to link Google identity to new user." });
        }

        await signInManager.SignInAsync(user, isPersistent: true);
        return LocalRedirectOrHome(returnTo);
    }

    private async Task NotifyAsync(
        AppUser user,
        Func<IVirituraEmailSender, string, Task> send)
    {
        if (string.IsNullOrEmpty(user.Email) || !user.EmailConfirmed) return;
        await send(virituraEmailSender, user.Email);
    }

    private string BuildLinkRequiredUrl(string provider, string email)
    {
        var basePart = frontendOriginPolicy.PrimaryBaseUrl.TrimEnd('/');
        return $"{basePart}/?oauth_link_required=1&provider={Uri.EscapeDataString(provider)}&email={Uri.EscapeDataString(email)}";
    }

    private string BuildTwoFactorRequiredUrl(string? returnTo)
    {
        var destination = frontendOriginPolicy.TryResolveReturnUrl(returnTo, out var resolved)
            ? resolved
            : frontendOriginPolicy.PrimaryBaseUrl;
        if (string.IsNullOrWhiteSpace(destination)) destination = "/";
        var separator = destination.Contains('?', StringComparison.Ordinal) ? '&' : '?';
        return $"{destination}{separator}two_factor_required=1";
    }

    private IActionResult LocalRedirectOrHome(string? returnTo)
    {
        // Same-host (relative) returns are always safe.
        if (!string.IsNullOrWhiteSpace(returnTo) && Url.IsLocalUrl(returnTo))
        {
            return LocalRedirect(returnTo);
        }
        // Cross-origin returns are allowed only for the SPA origins on the frontend allowlist.
        if (frontendOriginPolicy.TryResolveReturnUrl(returnTo, out var resolved))
        {
            return Redirect(resolved);
        }
        return Ok(new { success = true });
    }

    /// <summary>
    /// Copies the Google profile picture (mapped via <c>options.ClaimActions</c> in Program.cs)
    /// onto the user row. Set <paramref name="overwrite"/> to false for the link/auto-link paths
    /// so a user who already uploaded their own avatar isn't silently overridden by Google.
    /// </summary>
    private static void ApplyGoogleAvatar(AppUser user, Microsoft.AspNetCore.Identity.ExternalLoginInfo info, bool overwrite)
    {
        var picture = info.Principal.FindFirst("urn:google:picture")?.Value;
        if (string.IsNullOrWhiteSpace(picture)) return;
        if (!overwrite && !string.IsNullOrWhiteSpace(user.AvatarUrl)) return;
        user.AvatarUrl = picture;
    }

    /// <summary>
    /// Used on the existing-external-login sign-in path: refresh the cached Google avatar so
    /// changes the user made on the Google side propagate without requiring re-link. Writes only
    /// when the URL actually differs, to avoid a row update on every login.
    /// </summary>
    private async Task RefreshAvatarFromGoogleAsync(Microsoft.AspNetCore.Identity.ExternalLoginInfo info)
    {
        var picture = info.Principal.FindFirst("urn:google:picture")?.Value;
        if (string.IsNullOrWhiteSpace(picture)) return;
        var user = await userManager.FindByLoginAsync(info.LoginProvider, info.ProviderKey);
        if (user is null || string.Equals(user.AvatarUrl, picture, StringComparison.Ordinal)) return;
        user.AvatarUrl = picture;
        await userManager.UpdateAsync(user);
    }
}