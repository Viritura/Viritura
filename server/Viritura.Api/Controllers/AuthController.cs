using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

using Viritura.Api.Contracts.Auth;
using Viritura.Infrastructure;

namespace Viritura.Api.Controllers;

[ApiController]
[Route("auth")]
[EnableCors("VirituraFrontends")]
[EnableRateLimiting("Auth")]
public sealed class AuthController(
    UserManager<AppUser> userManager,
    SignInManager<AppUser> signInManager,
    IAuthEmailDispatcher authEmails,
    IConfiguration configuration,
    IOptions<AuthFeatureOptions> authFeatures,
    IAntiforgery antiforgery,
    EmailLoginRateLimiter loginByEmail,
    PasswordResetEmailThrottle passwordResetEmails,
    VerificationEmailThrottle verificationEmails,
    TwoFactorRecoveryEmailThrottle twoFactorRecoveryEmails,
    PasswordTimingProtector passwordTiming) : ControllerBase
{
    /// <summary>
    /// True when registration creates accounts with <c>EmailConfirmed=false</c> and routes the user
    /// through the email verification flow. False in tests + early dev to keep sign-up one-shot.
    /// Mirrors <c>options.SignIn.RequireConfirmedEmail</c> so the two stay in sync.
    /// </summary>
    private bool RequireEmailVerification =>
        configuration.GetValue("Auth:RequireEmailVerification", defaultValue: true);
    [HttpGet("csrf")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(CsrfResponse), StatusCodes.Status200OK)]
    public IActionResult Csrf()
    {
        Response.Headers["Cache-Control"] = "no-store";
        var tokens = antiforgery.GetAndStoreTokens(HttpContext);
        return Ok(new CsrfResponse(tokens.RequestToken ?? string.Empty, tokens.HeaderName ?? "X-XSRF-TOKEN"));
    }

    [HttpGet("me")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(MeResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> Me()
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (User.Identity?.IsAuthenticated != true)
        {
            return Ok(new MeResponse(false, null));
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            await signInManager.SignOutAsync();
            return Ok(new MeResponse(false, null));
        }

        return Ok(new MeResponse(true, await BuildUserResponseAsync(user)));
    }

    [HttpGet("capabilities")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthCapabilitiesResponse), StatusCodes.Status200OK)]
    public IActionResult Capabilities()
    {
        Response.Headers["Cache-Control"] = "public, max-age=60";
        var googleConfigured =
            !string.IsNullOrWhiteSpace(configuration["Authentication:Google:ClientId"])
            && !string.IsNullOrWhiteSpace(configuration["Authentication:Google:ClientSecret"]);
        var gitHubConfigured =
            !string.IsNullOrWhiteSpace(configuration["Viritura:GitHub:ClientId"])
            && !string.IsNullOrWhiteSpace(configuration["Viritura:GitHub:ClientSecret"]);
        return Ok(new AuthCapabilitiesResponse(
            gitHubConfigured,
            authFeatures.Value.GoogleLoginEnabled && googleConfigured,
            authFeatures.Value.EmailRegistrationMode.ToString()));
    }

    [HttpPost("register")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(RegisterPendingVerificationResponse), StatusCodes.Status202Accepted)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Apply registration policy before looking up an account. Otherwise an
        // uninvited existing address would take the duplicate-account path while
        // an uninvited unknown address returned 403, creating an enumeration oracle.
        if (!authFeatures.Value.CanCreateEmailAccount(request.Email))
        {
            var message = authFeatures.Value.EmailRegistrationMode == EmailRegistrationMode.AllowList
                ? "Email registration is currently available by invitation only."
                : "Email registration is currently closed.";
            return StatusCode(StatusCodes.Status403Forbidden, new { error = message });
        }

        var existing = await userManager.FindByEmailAsync(request.Email);
        if (existing is not null)
        {
            // Uniform "we processed your registration" response for every duplicate-email
            // shape — accounts with a password, OAuth-only accounts, confirmed or unconfirmed —
            // so this endpoint can't be used to enumerate which addresses are registered or
            // determine whether a given address is OAuth-linked.
            //
            // For mailbox-verified accounts we also send a password-reset link to the existing
            // address. That serves two legitimate users:
            //   * The owner forgot they already had an account (very common with mixed
            //     password / OAuth signup paths) — they can reset and sign in.
            //   * An OAuth-only owner wanted to add a password — Identity's reset-password
            //     token gates the password set on mailbox-control proof. The password the
            //     attacker submitted is intentionally discarded; the user picks a new one on
            //     the reset-password landing page.
            if (existing.EmailConfirmed)
            {
                await SendPasswordResetEmailAsync(existing);
            }
            else if (RequireEmailVerification)
            {
                // Registration is idempotent for an account stranded by a transient email
                // failure: never replace its password, but retry mailbox verification.
                await SendVerificationEmailAsync(existing);
            }

            return Accepted(new RegisterPendingVerificationResponse(
                existing.Email!,
                RequiresVerification: true,
                LinkExistingAccount: false));
        }

        var requireVerification = RequireEmailVerification;
        var user = new AppUser
        {
            UserName = request.Email,
            Email = request.Email,
            // When verification is required, EmailConfirmed=false; PasswordSignInAsync will return
            // IsNotAllowed until the user clicks the link. When disabled (tests / early dev),
            // auto-confirm so registration doubles as sign-in.
            EmailConfirmed = !requireVerification,
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? null : request.DisplayName.Trim()
        };

        var create = await userManager.CreateAsync(user, request.Password);
        if (!create.Succeeded)
        {
            foreach (var error in create.Errors)
            {
                ModelState.AddModelError(error.Code, error.Description);
            }
            return ValidationProblem(ModelState);
        }

        if (requireVerification)
        {
            // The account is already committed. A transient provider failure must not turn
            // successful persistence into an opaque 500; register and resend-verification
            // can both safely retry delivery for this same unconfirmed account.
            await SendVerificationEmailAsync(user);
            return Accepted(new RegisterPendingVerificationResponse(user.Email!, RequiresVerification: true));
        }

        await signInManager.SignInAsync(user, isPersistent: true);
        return Ok(await BuildUserResponseAsync(user));
    }

    /// <summary>
    /// Verification landing page (marketing site) POSTs here with the <c>uid</c> + <c>token</c> from the
    /// emailed link. On success we mark the email confirmed and sign the user in (cookie is scoped to
    /// the auth-cookie domain, which is host-only on localhost and <c>.viritura.com</c> in prod), so
    /// when the page redirects to the editor the user is already authenticated.
    /// </summary>
    [HttpPost("verify")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Verify([FromBody] VerifyEmailRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.FindByIdAsync(request.Uid);
        if (user is null)
        {
            return BadRequest(new { error = "Verification link is invalid or expired." });
        }

        var result = await userManager.ConfirmEmailAsync(user, request.Token);
        if (!result.Succeeded)
        {
            return BadRequest(new { error = "Verification link is invalid or expired." });
        }

        await signInManager.SignInAsync(user, isPersistent: true);
        return Ok(await BuildUserResponseAsync(user));
    }

    /// <summary>
    /// Sends a fresh verification email. Always returns 204 to avoid leaking which addresses are
    /// registered. Rate-limited via the <c>Auth</c> policy.
    /// </summary>
    [HttpPost("resend-verification")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> ResendVerification([FromBody] ResendVerificationRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (ModelState.IsValid)
        {
            var user = await userManager.FindByEmailAsync(request.Email);
            if (user is not null && !user.EmailConfirmed)
            {
                await SendVerificationEmailAsync(user);
            }
        }

        return NoContent();
    }

    /// <summary>
    /// Kicks off the password-reset flow. Always returns 204 to avoid leaking which addresses are
    /// registered. When the email matches an existing user we generate a reset token (single-use,
    /// time-limited by Identity's <c>DataProtectorTokenProvider</c>) and email the reset link.
    /// </summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (ModelState.IsValid)
        {
            var user = await userManager.FindByEmailAsync(request.Email);
            // Only send to confirmed accounts: an unconfirmed account hasn't proven control of the
            // mailbox, so we don't reveal "this address is taken" by sending a reset there either.
            if (user is not null && user.EmailConfirmed)
            {
                await SendPasswordResetEmailAsync(user);
            }
        }

        return NoContent();
    }

    /// <summary>
    /// Completes the password-reset flow. Validates the <c>uid</c> + <c>token</c> pair, replaces the
    /// password, and signs the user in so the landing page can redirect into the editor.
    /// </summary>
    [HttpPost("reset-password")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.FindByIdAsync(request.Uid);
        if (user is null)
        {
            return BadRequest(new { error = "Reset link is invalid or expired." });
        }

        var result = await userManager.ResetPasswordAsync(user, request.Token, request.NewPassword);
        if (!result.Succeeded)
        {
            // Password-policy errors (too short, etc.) surface as ValidationProblem so the form can
            // highlight the password field; token errors collapse to a generic 400.
            var passwordErrors = result.Errors
                .Where(e => !string.Equals(e.Code, "InvalidToken", StringComparison.Ordinal))
                .ToList();
            if (passwordErrors.Count > 0)
            {
                foreach (var error in passwordErrors)
                {
                    ModelState.AddModelError(nameof(ResetPasswordRequest.NewPassword), error.Description);
                }
                return ValidationProblem(ModelState);
            }
            return BadRequest(new { error = "Reset link is invalid or expired." });
        }

        // A reset is implicit proof of mailbox control — confirm the email if it wasn't already.
        if (!user.EmailConfirmed)
        {
            user.EmailConfirmed = true;
            await userManager.UpdateAsync(user);
        }

        await signInManager.SignInAsync(user, isPersistent: true);
        return Ok(await BuildUserResponseAsync(user));
    }

    private async Task SendPasswordResetEmailAsync(AppUser user)
    {
        // Per-email cap defends our SMTP path from being weaponised as an email bomber
        // (the responses are identical for known/unknown emails, so there's no signal
        // in front of us to stop the sender — we have to gate the send itself).
        if (!passwordResetEmails.TryAcquire(user.Email ?? string.Empty))
        {
            return;
        }
        await authEmails.QueuePasswordResetAsync(user);
    }

    private async Task SendVerificationEmailAsync(AppUser user)
    {
        if (!verificationEmails.TryAcquire(user.Email ?? string.Empty))
        {
            return;
        }
        await authEmails.QueueVerificationAsync(user);
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Per-email rate limit. Sits in front of the password check so a credential-stuffing
        // attacker rotating IPs cannot enumerate passwords for one victim email, and so they
        // cannot trip Identity's account lockout (DoS) either. The IP-scoped "Auth" policy on
        // this controller handles the noisy-single-IP case.
        if (!loginByEmail.TryAcquire(request.Email ?? string.Empty))
        {
            return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "Too many login attempts. Try again in a minute." });
        }

        // Every failure mode below collapses to a single 401 response shape so this endpoint
        // cannot be used to enumerate registered emails, identify OAuth-only accounts, observe
        // which addresses have unconfirmed mailboxes, or notice account lockouts. The legitimate
        // user has two well-signposted escape hatches when they hit this branch by accident:
        //   * "Forgot password" / "Resend verification" buttons on the sign-in dialog.
        //   * The OAuth provider buttons (Sign in with Google / GitHub).
        // The 200 RequiresTwoFactor=true path below is reached only after the password has been
        // validated, so the 2FA branch is not an enumeration oracle.
        var user = await userManager.FindByEmailAsync(request.Email ?? string.Empty);
        if (user is null || !await userManager.HasPasswordAsync(user))
        {
            passwordTiming.VerifyDummy(request.Password);
            return Unauthorized(new { error = "Invalid email or password." });
        }

        var result = await signInManager.PasswordSignInAsync(
            user,
            request.Password,
            isPersistent: request.RememberMe,
            lockoutOnFailure: true);

        if (result.RequiresTwoFactor)
        {
            // PasswordSignInAsync drops the 2FA-partial cookie (IdentityConstants.TwoFactorUserIdScheme).
            // The client must follow up with /auth/login/2fa or /auth/login/recovery to complete sign-in;
            // until then no full auth cookie is set.
            return Ok(new LoginResponse(RequiresTwoFactor: true, User: null));
        }

        if (!result.Succeeded)
        {
            // Covers wrong-password, IsNotAllowed (unconfirmed email), IsLockedOut, and the
            // never-reached RequiresTwoFactor=false-but-not-Succeeded paths. All return the same
            // bytes so an outside observer can't tell them apart.
            return Unauthorized(new { error = "Invalid email or password." });
        }

        return Ok(new LoginResponse(RequiresTwoFactor: false, User: await BuildUserResponseAsync(user)));
    }

    /// <summary>
    /// Second step of an interactive sign-in when the account has 2FA enabled. Requires the
    /// 2FA-partial cookie dropped by <see cref="Login"/>; that cookie is what proves the password
    /// step succeeded. The submitted code is the current 6-digit TOTP from the user's authenticator
    /// app. On success the full auth cookie is set (replacing the partial cookie) and the user
    /// payload is returned.
    /// </summary>
    [HttpPost("login/2fa")]
    [AllowAnonymous]
    [EnableRateLimiting("TwoFactorAttempt")]
    [ProducesResponseType(typeof(AuthUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status423Locked)]
    public async Task<IActionResult> LoginTwoFactor([FromBody] TwoFactorLoginRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Trim spaces — authenticator apps often render the code as "123 456".
        var code = request.Code.Replace(" ", string.Empty, StringComparison.Ordinal);

        // Capture the user from the partial 2FA cookie *before* sign-in, because a successful
        // sign-in consumes that cookie and we'd no longer be able to identify the user otherwise.
        var user = await signInManager.GetTwoFactorAuthenticationUserAsync();
        if (user is null)
        {
            return Unauthorized(new { error = "No 2FA challenge in progress." });
        }

        var result = await signInManager.TwoFactorAuthenticatorSignInAsync(
            code,
            isPersistent: true,
            rememberClient: request.RememberClient);

        if (result.IsLockedOut)
        {
            return StatusCode(StatusCodes.Status423Locked, new { error = "Account is temporarily locked." });
        }
        if (!result.Succeeded)
        {
            return Unauthorized(new { error = "Invalid authenticator code." });
        }

        return Ok(await BuildUserResponseAsync(user));
    }

    /// <summary>
    /// Recovery-code fallback for the 2FA step. Each recovery code is single-use; on success the
    /// code is consumed and the full auth cookie is set.
    /// </summary>
    [HttpPost("login/recovery")]
    [AllowAnonymous]
    [EnableRateLimiting("TwoFactorAttempt")]
    [ProducesResponseType(typeof(AuthUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> LoginRecovery([FromBody] TwoFactorRecoveryLoginRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Recovery codes are stored with their canonical formatting (lowercase, hyphenated).
        // We strip only whitespace — preserving the hyphen so the value matches what Identity has
        // persisted via GenerateNewTwoFactorRecoveryCodesAsync.
        var code = request.Code.Replace(" ", string.Empty, StringComparison.Ordinal);

        var user = await signInManager.GetTwoFactorAuthenticationUserAsync();
        if (user is null)
        {
            return Unauthorized(new { error = "No 2FA challenge in progress." });
        }

        var result = await signInManager.TwoFactorRecoveryCodeSignInAsync(code);
        if (!result.Succeeded)
        {
            return Unauthorized(new { error = "Invalid recovery code." });
        }

        return Ok(await BuildUserResponseAsync(user));
    }

    /// <summary>
    /// "Lost your authenticator and your recovery codes" recovery flow. Requires the 2FA-partial
    /// cookie (so the user has already proven they know the password) AND a confirmed mailbox on
    /// the account — the recovery link is only as trustworthy as the email it goes to.
    ///
    /// Always returns 204 to avoid leaking whether the partial cookie was valid, whether the
    /// account has a confirmed mailbox, or whether the email could be delivered. Rate-limited by
    /// the controller's <c>Auth</c> policy.
    /// </summary>
    [HttpPost("login/2fa-recover")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> RequestTwoFactorRecovery()
    {
        Response.Headers["Cache-Control"] = "no-store";

        var user = await signInManager.GetTwoFactorAuthenticationUserAsync();
        if (user is not null && user.EmailConfirmed && !string.IsNullOrEmpty(user.Email))
        {
            // Per-recipient throttle prevents the endpoint being used as an email-bombing relay.
            // The 204 response is identical whether the send is allowed or suppressed so the
            // caller cannot observe whether they hit the quota.
            if (twoFactorRecoveryEmails.TryAcquire(user.Email))
            {
                await authEmails.QueueTwoFactorRecoveryAsync(user);
            }
        }

        return NoContent();
    }

    /// <summary>
    /// Consumes a token from <see cref="RequestTwoFactorRecovery"/> and turns 2FA off on the
    /// account, then signs the user in. After this:
    ///   - <c>TwoFactorEnabled</c> = false
    ///   - The authenticator shared secret is cleared (so the lost device's existing code can't
    ///     accidentally re-enable 2FA later — the user must rekey from <c>/2fa/setup</c>).
    ///   - The security stamp rolls, which invalidates the recovery token and every other
    ///     outstanding token (password-reset, email-confirmation, additional 2FA-recovery links).
    /// We deliberately ALWAYS roll the stamp — even on an invalid token we return a generic 400
    /// without rolling, but the success path is the only place we mutate state.
    /// </summary>
    [HttpPost("2fa/disable-by-recovery-token")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> DisableTwoFactorByRecoveryToken(
        [FromBody] TwoFactorRecoveryDisableRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.FindByIdAsync(request.Uid);
        if (user is null)
        {
            return BadRequest(new { error = "This recovery link is invalid or has expired." });
        }

        var verified = await userManager.VerifyUserTokenAsync(
            user,
            TokenOptions.DefaultProvider,
            AuthEmailDelivery.TwoFactorRecoveryTokenPurpose,
            request.Token);
        if (!verified)
        {
            return BadRequest(new { error = "This recovery link is invalid or has expired." });
        }

        // Order matters: clear the key BEFORE flipping the enabled flag so we never have a state
        // where 2FA is "enabled" but the authenticator is empty. Both calls roll the security
        // stamp, which is what invalidates the token we just consumed.
        await userManager.ResetAuthenticatorKeyAsync(user);
        var disable = await userManager.SetTwoFactorEnabledAsync(user, enabled: false);
        if (!disable.Succeeded)
        {
            // Vanishingly unlikely (the user exists and we just mutated them above); surface a
            // generic 400 rather than 500 so we don't expose internal errors to anonymous clients.
            return BadRequest(new { error = "Could not disable two-factor authentication." });
        }

        await signInManager.SignInAsync(user, isPersistent: true);
        return Ok(await BuildUserResponseAsync(user));
    }


    /// <summary>
    /// Consumes the change-email token generated by <c>POST /account/email</c> and performs the
    /// actual swap. The token is bound to the new email address (Identity's
    /// <c>ChangeEmailTokenProvider</c> includes it in the protected payload), so an attacker can't
    /// rebind to a different address by editing the URL.
    /// <para/>
    /// On success: <c>Email</c> is set to <paramref name="ConfirmEmailChangeRequest.NewEmail"/>,
    /// <c>UserName</c> is kept in sync (the username doubles as the login key, so callers can
    /// keep using the new email to sign in), the security stamp rolls (invalidating other
    /// sessions / password-reset / verification tokens), and the full auth cookie is dropped so
    /// the website can redirect into the editor signed in.
    /// </summary>
    [HttpPost("confirm-email-change")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ConfirmEmailChange([FromBody] ConfirmEmailChangeRequest request)
    {
        Response.Headers["Cache-Control"] = "no-store";

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = await userManager.FindByIdAsync(request.Uid);
        if (user is null)
        {
            return BadRequest(new { error = "This confirmation link is invalid or has expired." });
        }

        // ChangeEmailAsync validates the token (which is bound to NewEmail), updates Email,
        // sets EmailConfirmed=true, and rolls the security stamp.
        var change = await userManager.ChangeEmailAsync(user, request.NewEmail, request.Token);
        if (!change.Succeeded)
        {
            return BadRequest(new { error = "This confirmation link is invalid or has expired." });
        }

        // Keep UserName in sync — for an email-as-username Identity store, callers expect to sign
        // in with the new email after the change. SetUserNameAsync also rolls the security stamp.
        var setName = await userManager.SetUserNameAsync(user, request.NewEmail);
        if (!setName.Succeeded)
        {
            // Vanishingly unlikely (the email was just accepted by ChangeEmailAsync), but if a
            // unique-index race happens we surface a generic 400 — leaving Email and UserName out
            // of sync would break sign-in.
            return BadRequest(new { error = "Could not finalize the email change." });
        }

        await signInManager.SignInAsync(user, isPersistent: true);
        return Ok(await BuildUserResponseAsync(user));
    }


    [HttpPost("logout")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Logout()
    {
        try
        {
            await antiforgery.ValidateRequestAsync(HttpContext);
        }
        catch (AntiforgeryValidationException)
        {
            return BadRequest(new { error = "Antiforgery token is missing or invalid." });
        }

        await signInManager.SignOutAsync();
        return NoContent();
    }

    /// <summary>
    /// Sign out the current cookie AND invalidate every other active session for this user. We
    /// roll the security stamp (<see cref="UserManager{TUser}.UpdateSecurityStampAsync"/>), which
    /// the cookie auth pipeline checks at <see cref="SecurityStampValidatorOptions.ValidationInterval"/>
    /// boundaries — so other devices/tabs get bounced to signed-out on their next stamp check
    /// (default: every 30 minutes). Pair with a password change for the "compromised credentials"
    /// flow; useful on its own when the user thinks a device may have been left signed in
    /// somewhere they don't control.
    /// </summary>
    [HttpPost("logout-everywhere")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> LogoutEverywhere()
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

        // Rolling the stamp invalidates every cookie issued against the prior stamp — including
        // the one we're about to sign out from. Do it before SignOutAsync so the response cookie
        // clear and the stamp roll are atomic from the client's POV.
        await userManager.UpdateSecurityStampAsync(user);
        await signInManager.SignOutAsync();
        return NoContent();
    }

    private async Task<AuthUserResponse> BuildUserResponseAsync(AppUser user)
    {
        var logins = await userManager.GetLoginsAsync(user);
        var external = logins
            .Select(l => new AuthExternalLogin(l.LoginProvider, l.ProviderKey, l.ProviderDisplayName))
            .ToList();
        var hasPassword = await userManager.HasPasswordAsync(user);

        return new AuthUserResponse(
            user.Id,
            user.Email ?? string.Empty,
            user.DisplayName,
            user.AvatarUrl,
            hasPassword,
            external);
    }
}