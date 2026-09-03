using System.ComponentModel.DataAnnotations;
using System.Globalization;

using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

using Viritura.GitHub;
using Viritura.Infrastructure;
using Viritura.Infrastructure.Email;

namespace Viritura.Api.Controllers;

[ApiController]
[Microsoft.AspNetCore.Cors.EnableCors("VirituraEditor")]
[Route("github/auth")]
[EnableRateLimiting("GitHubAuth")]
public sealed class GitHubAuthController(
    IOptions<GitHubAuthOptions> options,
    IGitHubOAuthStateService oauthStateService,
    IGitHubTokenService tokenService,
    IGitHubInstallationStore installationStore,
    IGitHubOAuthClient oauthClient,
    UserManager<AppUser> userManager,
    SignInManager<AppUser> signInManager,
    IAntiforgery antiforgery,
    RecentAuthService recentAuth,
    IVirituraEmailSender virituraEmailSender,
    ILogger<GitHubAuthController> logger,
    IHostEnvironment environment) : ControllerBase
{
    [HttpGet("start")]
    [AllowAnonymous]
    public IActionResult Start([FromQuery] string? returnTo)
    {
        var authOptions = options.Value;
        if (!authOptions.IsConfigured)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "Viritura GitHub auth is not configured." });
        }

        var challenge = oauthStateService.CreateChallenge(returnTo);
        Response.Cookies.Append(authOptions.StateCookieName, challenge.CookieValue, CreateStateCookieOptions(environment));

        var authorizationUrl = tokenService.BuildAuthorizationUrl(challenge.State);
        return Redirect(authorizationUrl);
    }

    [HttpGet("callback")]
    [AllowAnonymous]
    public async Task<IActionResult> Callback(
        [FromQuery] string? code,
        [FromQuery] string? state,
        [FromQuery(Name = "installation_id")] long? installationId,
        [FromQuery(Name = "setup_action")] string? setupAction,
        CancellationToken cancellationToken)
    {
        var authOptions = options.Value;
        if (!authOptions.IsConfigured)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "Viritura GitHub auth is not configured." });
        }

        if (IsGitHubAppSetupCallback(installationId, setupAction))
        {
            return Redirect(authOptions.FrontendBaseUrl);
        }

        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(state))
        {
            return BadRequest(new { error = "GitHub auth callback is missing required query parameters." });
        }

        var stateCookie = Request.Cookies[authOptions.StateCookieName];
        if (!oauthStateService.TryValidate(state, stateCookie, out var returnTo))
        {
            return BadRequest(new { error = "Invalid or expired OAuth state." });
        }

        Response.Cookies.Delete(authOptions.StateCookieName, CreateStateCookieOptions(environment));

        var session = await tokenService.CreateSessionFromAuthorizationCodeAsync(code, cancellationToken);

        if (returnTo.StartsWith(RecentAuthService.FlowPrefix, StringComparison.Ordinal))
        {
            var current = await userManager.GetUserAsync(User);
            if (current is null ||
                !recentAuth.TryConsumeProviderFlow(returnTo, current.Id, "GitHub", out var action, out var flowReturnTo))
            {
                return Unauthorized(new { error = "The provider reauthentication flow is invalid or expired." });
            }
            var providerKey = session.Viewer.Id.ToString(CultureInfo.InvariantCulture);
            var currentLogins = await userManager.GetLoginsAsync(current);
            if (!currentLogins.Any(login =>
                    login.LoginProvider == "GitHub" && login.ProviderKey == providerKey))
            {
                return Unauthorized(new { error = "Reauthentication must use an already-linked provider identity." });
            }
            recentAuth.Issue(Response, current, action, "github");
            return Redirect(flowReturnTo);
        }

        if (User.Identity?.IsAuthenticated == true)
        {
            var current = await userManager.GetUserAsync(User);
            if (current is not null)
            {
                var providerKey = session.Viewer.Id.ToString(CultureInfo.InvariantCulture);
                var currentLogins = await userManager.GetLoginsAsync(current);
                var alreadyLinked = currentLogins.Any(login =>
                    login.LoginProvider == "GitHub" && login.ProviderKey == providerKey);
                if (!alreadyLinked && !recentAuth.TryConsume(Request, Response, current, RecentAuthAction.LinkLogin))
                {
                    return StatusCode(StatusCodes.Status403Forbidden, new
                    {
                        error = "Recent authentication is required before linking a provider."
                    });
                }
            }
        }

        var lookup = await FindOrCreateUserAsync(session, cancellationToken);
        if (lookup.LinkRequiredEmail is not null)
        {
            // An existing Viritura account already owns this email but this GitHub identity is
            // not yet linked to it. We used to auto-link here, but that lets an attacker who
            // pre-registered the email plant a row with their own password and capture the
            // legitimate user when they later sign in via GitHub. Now we require the user to
            // sign in via their existing method first and then explicitly link from settings.
            return Redirect(BuildLinkRequiredUrl(authOptions.FrontendBaseUrl, "GitHub", lookup.LinkRequiredEmail));
        }
        if (lookup.User is null)
        {
            // Detailed reason already went to the logger inside FindOrCreateUserAsync.
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = "Failed to provision Viritura user from GitHub identity." });
        }

        var appUser = lookup.User;
        await installationStore.UpsertAsync(appUser.Id, session, cancellationToken);

        if (User.Identity?.IsAuthenticated == true)
        {
            await signInManager.RefreshSignInAsync(appUser);
        }
        else
        {
            if (!appUser.EmailConfirmed && string.IsNullOrEmpty(appUser.Email))
            {
                appUser.EmailConfirmed = true;
                await userManager.UpdateAsync(appUser);
            }
            var providerKey = session.Viewer.Id.ToString(CultureInfo.InvariantCulture);
            var signIn = await signInManager.ExternalLoginSignInAsync(
                "GitHub",
                providerKey,
                isPersistent: true,
                bypassTwoFactor: false);
            if (signIn.RequiresTwoFactor)
            {
                return Redirect(AppendTwoFactorRequired(ResolveReturnUrl(returnTo, authOptions)));
            }
            if (!signIn.Succeeded)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { error = "GitHub sign-in could not be completed." });
            }
        }

        return Redirect(ResolveReturnUrl(returnTo, authOptions));
    }

    /// <summary>
    /// Unlinks the GitHub identity from the current Viritura account.
    ///
    /// Semantics ("Disconnect" in the UI):
    ///  1. Best-effort revoke the OAuth grant on GitHub (so our cached access token can no longer be used).
    ///  2. Delete our local installation/token cache row.
    ///  3. Remove the AspNetUserLogins entry so this GitHub identity can no longer sign into this account.
    ///  4. If the user has no password and no other external logins, sign them out — otherwise their session
    ///     would be authoritative for an account they can no longer sign back into via this provider.
    ///
    /// Notes: the actual GitHub App *installation* (which repos the app can access) lives on GitHub and is
    /// managed at https://github.com/settings/installations/{id}. We mirror its state via the
    /// <c>installation.deleted</c> webhook; this endpoint does not attempt to uninstall the app.
    /// </summary>
    public sealed record UnlinkRequest
    {
        /// <summary>Required when the account has a password set; ignored otherwise.</summary>
        public string? CurrentPassword { get; init; }
    }

    [HttpPost("unlink")]
    [Authorize]
    public async Task<IActionResult> Unlink([FromBody] UnlinkRequest? request, CancellationToken cancellationToken)
    {
        try
        {
            await antiforgery.ValidateRequestAsync(HttpContext);
        }
        catch (AntiforgeryValidationException)
        {
            return BadRequest(new { error = "Antiforgery token is missing or invalid." });
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Unauthorized();
        }

        // Re-auth gate when a password is set: unlinking changes the user's sign-in surface,
        // so a stolen cookie alone should not be enough. OAuth-only accounts skip the gate
        // (cookie + antiforgery + the existing orphan check at step 4 are the gate).
        if (await userManager.HasPasswordAsync(user))
        {
            var currentPassword = request?.CurrentPassword;
            if (string.IsNullOrEmpty(currentPassword)
                || !await userManager.CheckPasswordAsync(user, currentPassword))
            {
                ModelState.AddModelError(nameof(UnlinkRequest.CurrentPassword), "Incorrect password.");
                return ValidationProblem(ModelState);
            }
        }
        else if (!recentAuth.TryConsume(Request, Response, user, RecentAuthAction.UnlinkLogin))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = "Recent authentication with an existing sign-in method is required.",
                requiresRecentAuth = true
            });
        }

        // 1. Revoke the OAuth grant on GitHub (best-effort: don't fail the unlink if GitHub is unreachable).
        var installation = await installationStore.FindAsync(user.Id, cancellationToken);
        if (installation is not null && !string.IsNullOrWhiteSpace(installation.AccessToken))
        {
            try
            {
                await oauthClient.RevokeOAuthGrantAsync(installation.AccessToken, cancellationToken);
            }
#pragma warning disable CA1031 // best-effort revoke: a transient network/GitHub failure must not block local unlink
            catch (Exception)
#pragma warning restore CA1031
            {
                // Best-effort: a transient network failure or GitHub outage must not block the local unlink.
            }
        }

        // 2. Delete our cached installation/token row.
        await installationStore.DeleteAsync(user.Id, cancellationToken);

        // 3. Remove the AspNetUserLogins entry for GitHub.
        var logins = await userManager.GetLoginsAsync(user);
        var removedAny = false;
        foreach (var login in logins.Where(l => l.LoginProvider == "GitHub"))
        {
            var removed = await userManager.RemoveLoginAsync(user, login.LoginProvider, login.ProviderKey);
            if (removed.Succeeded) removedAny = true;
        }

        if (removedAny)
        {
            await NotifyAsync(user, (sender, mailbox) =>
                sender.SendExternalLoginRemovedNotificationAsync(user, mailbox, "GitHub"));
        }

        // 4. If the user can no longer sign in (no password, no remaining external logins), sign them out.
        var hasPassword = await userManager.HasPasswordAsync(user);
        var remainingLogins = await userManager.GetLoginsAsync(user);
        if (!hasPassword && remainingLogins.Count == 0)
        {
            await signInManager.SignOutAsync();
        }

        return NoContent();
    }

    /// <summary>
    /// Result of resolving the OAuth callback into a Viritura account row. Either:
    /// (a) <c>User</c> is set — sign that user in; or
    /// (b) <c>LinkRequiredEmail</c> is set — an existing account already owns this email but
    ///     this provider identity is not yet linked to it; redirect to the SPA so the user can
    ///     sign in via their existing method and then explicitly link this provider from
    ///     settings; or
    /// (c) both null — unrecoverable failure (already logged).
    /// </summary>
    private readonly record struct OAuthLookup(AppUser? User, string? LinkRequiredEmail);

    private async Task<OAuthLookup> FindOrCreateUserAsync(
        GitHubSessionEnvelope session,
        CancellationToken cancellationToken)
    {
        if (User.Identity?.IsAuthenticated == true)
        {
            var current = await userManager.GetUserAsync(User);
            if (current is not null)
            {
                await EnsureLoginLinkedAsync(current, session);
                await BackfillEmailFromGitHubAsync(current, session);
                return new OAuthLookup(current, null);
            }
        }

        var providerKey = session.Viewer.Id.ToString(CultureInfo.InvariantCulture);
        var existing = await userManager.FindByLoginAsync("GitHub", providerKey);
        if (existing is not null)
        {
            await BackfillEmailFromGitHubAsync(existing, session);
            return new OAuthLookup(existing, null);
        }

        // OAuth-provisioned accounts don't require an email — the GitHub identity is the natural
        // key. Email is only meaningful for password / verification flows. Use the public profile
        // email from /user when GitHub gives us one, otherwise leave it null.
        var email = string.IsNullOrWhiteSpace(session.Viewer.Email) ? null : session.Viewer.Email;

        // If a real (non-synthetic) email already belongs to an existing Viritura account, do
        // NOT auto-attach this GitHub identity to it: an attacker who pre-registered the email
        // (or shares the inbox transiently) could otherwise capture the account on the
        // legitimate user's next GitHub sign-in. Signal the caller to bounce the user to the
        // SPA's "link required" landing instead. Synthetic *@users.noreply.github.com emails
        // skip this check (they aren't a real mailbox, so a collision implies the same GitHub
        // identity, which we'd have caught via FindByLoginAsync above).
        if (email is not null && ProviderEmailPolicy.IsAutoLinkable(email))
        {
            var byEmail = await userManager.FindByEmailAsync(email);
            if (byEmail is not null)
            {
                return new OAuthLookup(null, email);
            }
        }

        // UserName must be non-null and unique. Key it on the stable GitHub user id so it can't
        // collide with a future password-account UserName (which is normally the email). The
        // `github-` prefix is illegal as the local-part of any real email, so it can't collide
        // there either.
        // Don't persist synthetic addresses (e.g. *@users.noreply.github.com) on the row — they
        // aren't real mailboxes for verification/notification, and storing them blocks the
        // future-link path (an incoming real-email OAuth would collide on RequireUniqueEmail).
        var persistedEmail = email is not null && ProviderEmailPolicy.IsAutoLinkable(email) ? email : null;
        var user = new AppUser
        {
            UserName = $"github-{providerKey}",
            Email = persistedEmail,
            // Trust GitHub's verified email when present; no Viritura-side verification needed.
            EmailConfirmed = true,
            DisplayName = session.Viewer.Name ?? session.Viewer.Login,
            AvatarUrl = session.Viewer.AvatarUrl
        };

        var create = await userManager.CreateAsync(user);
        if (!create.Succeeded)
        {
            LogAccountCreationFailure(logger, providerKey, create);
            return default;
        }

        var addLogin = await userManager.AddLoginAsync(
            user,
            new UserLoginInfo("GitHub", providerKey, session.Viewer.Login));

        if (!addLogin.Succeeded)
        {
            logger.LogError(
                "GitHub OAuth: AddLoginAsync failed for new user github-{ProviderKey}: {Errors}",
                providerKey,
                string.Join("; ", addLogin.Errors.Select(e => $"{e.Code}: {e.Description}")));
            return default;
        }

        return new OAuthLookup(user, null);
    }

    private static string BuildLinkRequiredUrl(string frontendBaseUrl, string provider, string email)
    {
        var basePart = frontendBaseUrl.TrimEnd('/');
        return $"{basePart}/?oauth_link_required=1&provider={Uri.EscapeDataString(provider)}&email={Uri.EscapeDataString(email)}";
    }

    private async Task EnsureLoginLinkedAsync(AppUser user, GitHubSessionEnvelope session)
    {
        var providerKey = session.Viewer.Id.ToString(CultureInfo.InvariantCulture);
        var logins = await userManager.GetLoginsAsync(user);
        if (logins.Any(l => l.LoginProvider == "GitHub" && l.ProviderKey == providerKey))
        {
            return;
        }

        var result = await userManager.AddLoginAsync(
            user,
            new UserLoginInfo("GitHub", providerKey, session.Viewer.Login));
        if (result.Succeeded)
        {
            await NotifyAsync(user, (sender, mailbox) =>
                sender.SendExternalLoginAddedNotificationAsync(user, mailbox, "GitHub"));
        }
    }

    /// <summary>
    /// If our user row has no email yet (e.g. created when the user's GitHub profile had no public
    /// email) and GitHub now returns one, opportunistically backfill it. This is the only path
    /// that picks up a user later flipping their public email on GitHub.
    /// </summary>
    private async Task BackfillEmailFromGitHubAsync(AppUser user, GitHubSessionEnvelope session)
    {
        if (!string.IsNullOrWhiteSpace(user.Email))
        {
            return;
        }
        var email = session.Viewer.Email;
        if (string.IsNullOrWhiteSpace(email) || !ProviderEmailPolicy.IsAutoLinkable(email))
        {
            // No usable address, or only a synthetic noreply proxy — don't persist either.
            return;
        }

        // SetEmailAsync clears EmailConfirmed; restore it because GitHub's email is trusted.
        var set = await userManager.SetEmailAsync(user, email);
        if (!set.Succeeded)
        {
            LogEmailBackfillFailure(logger, user.Id, set);
            return;
        }
        user.EmailConfirmed = true;
        await userManager.UpdateAsync(user);
    }

    internal static void LogAccountCreationFailure(
        ILogger<GitHubAuthController> logger,
        string providerKey,
        IdentityResult result) =>
        logger.LogError(
            "GitHub OAuth: CreateAsync failed for github-{ProviderKey}: {ErrorCodes}",
            providerKey,
            string.Join("; ", result.Errors.Select(error => error.Code)));

    internal static void LogEmailBackfillFailure(
        ILogger<GitHubAuthController> logger,
        string userId,
        IdentityResult result) =>
        logger.LogError(
            "GitHub OAuth: email backfill SetEmailAsync failed for user {UserId}: {ErrorCodes}",
            userId,
            string.Join("; ", result.Errors.Select(error => error.Code)));

    /// <summary>
    /// Helper for the security-event notifications fired after credential-surface mutations
    /// (external login add/remove). Skipped when the user has no confirmed mailbox — we have
    /// no proof anyone reads that inbox, and sending could leak the account's existence.
    /// Fired after the action succeeds and never blocks the response.
    /// </summary>
    private async Task NotifyAsync(
        AppUser user,
        Func<IVirituraEmailSender, string, Task> send)
    {
        if (string.IsNullOrEmpty(user.Email) || !user.EmailConfirmed) return;
        await send(virituraEmailSender, user.Email);
    }

    private static CookieOptions CreateStateCookieOptions(IHostEnvironment environment) => new()
    {
        HttpOnly = true,
        Secure = true,
        Path = "/",
        SameSite = environment.IsDevelopment() ? SameSiteMode.None : SameSiteMode.Lax,
        IsEssential = true,
        MaxAge = TimeSpan.FromMinutes(10)
    };

    private static string ResolveReturnUrl(string returnTo, GitHubAuthOptions options)
    {
        if (IsSafeRelativeReturnUrl(returnTo) &&
            Uri.TryCreate(returnTo, UriKind.Relative, out var relativeUri))
        {
            return new Uri(new Uri(options.FrontendBaseUrl.TrimEnd('/') + "/", UriKind.Absolute), relativeUri).ToString();
        }

        if (Uri.TryCreate(returnTo, UriKind.Absolute, out var absoluteUri) &&
            IsAllowedOrigin(absoluteUri, options))
        {
            return absoluteUri.ToString();
        }

        return options.FrontendBaseUrl;
    }

    private static bool IsGitHubAppSetupCallback(long? installationId, string? setupAction) =>
        installationId is > 0 &&
        (string.Equals(setupAction, "install", StringComparison.OrdinalIgnoreCase) ||
         string.Equals(setupAction, "update", StringComparison.OrdinalIgnoreCase));

    private static bool IsSafeRelativeReturnUrl(string returnTo) =>
        returnTo.StartsWith('/') &&
        !returnTo.StartsWith("//", StringComparison.Ordinal) &&
        !returnTo.Contains('\\', StringComparison.Ordinal) &&
        Uri.TryCreate(returnTo, UriKind.Relative, out _);

    private static bool IsAllowedOrigin(Uri uri, GitHubAuthOptions options)
    {
        if (Uri.TryCreate(options.FrontendBaseUrl, UriKind.Absolute, out var frontendBase) &&
            string.Equals(uri.GetLeftPart(UriPartial.Authority), frontendBase.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return options.AllowedFrontendOrigins.Any(origin =>
            Uri.TryCreate(origin, UriKind.Absolute, out var allowedOrigin) &&
            string.Equals(uri.GetLeftPart(UriPartial.Authority), allowedOrigin.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase));
    }

    private static string AppendTwoFactorRequired(string destination)
    {
        var separator = destination.Contains('?', StringComparison.Ordinal) ? '&' : '?';
        return $"{destination}{separator}two_factor_required=1";
    }
}