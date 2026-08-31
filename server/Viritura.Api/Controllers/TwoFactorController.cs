using System.Text;
using System.Text.Encodings.Web;

using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

using Viritura.Api.Contracts.Auth;
using Viritura.Infrastructure;
using Viritura.Infrastructure.Email;

namespace Viritura.Api.Controllers;

/// <summary>
/// Manages two-factor authentication on the signed-in user's account.
/// The interactive login flow (where 2FA is challenged after a successful password step) lives on
/// <see cref="AuthController"/> instead — those endpoints are <see cref="AllowAnonymousAttribute"/>
/// because the user only holds the 2FA-partial cookie at that point.
/// </summary>
[ApiController]
[Microsoft.AspNetCore.Cors.EnableCors("VirituraEditor")]
[Route("2fa")]
[Authorize]
[EnableRateLimiting("Auth")]
public sealed class TwoFactorController(
    UserManager<AppUser> userManager,
    SignInManager<AppUser> signInManager,
    IAntiforgery antiforgery,
    RecentAuthService recentAuth,
    IVirituraEmailSender virituraEmailSender,
    UrlEncoder urlEncoder) : ControllerBase
{
    private const string AuthenticatorIssuer = "Viritura";

    [HttpGet("status")]
    [ProducesResponseType(typeof(TwoFactorStatusResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> Status()
    {
        Response.Headers.CacheControl = "no-store";
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var enabled = await userManager.GetTwoFactorEnabledAsync(user);
        var remaining = await userManager.CountRecoveryCodesAsync(user);
        return Ok(new TwoFactorStatusResponse(enabled, remaining));
    }

    /// <summary>
    /// Generates (or regenerates) the authenticator shared secret and returns it as both raw
    /// base32 text and a ready-to-render <c>otpauth://</c> URI. Calling this while 2FA is already
    /// enabled is intentionally allowed — it lets the user re-pair after losing their device, but
    /// the previous secret remains active until <see cref="Enable"/> commits the new one.
    /// </summary>
    [HttpPost("setup")]
    [ProducesResponseType(typeof(TwoFactorSetupResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> Setup()
    {
        Response.Headers.CacheControl = "no-store";
        if (!await ValidateAntiforgeryAsync()) return BadRequestCsrf();

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        if (!recentAuth.IsValid(Request, user, RecentAuthAction.ManageTwoFactor))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = "Recent authentication is required before setting up two-factor authentication.",
                requiresRecentAuth = true
            });
        }

        // Never disclose the active shared secret. Re-pairing is deliberately
        // disable (current TOTP) → setup → enable, so possession of a session
        // cookie alone cannot clone the user's authenticator.
        if (await userManager.GetTwoFactorEnabledAsync(user))
        {
            return Conflict(new { error = "Two-factor authentication is already enabled. Disable it before re-pairing." });
        }

        // Idempotency: if 2FA is already enabled, the existing key is in active use — never reset
        // it from the setup endpoint (that would silently break the user's authenticator). The
        // explicit "re-pair after losing device" flow is disable → setup → enable.
        //
        // If 2FA is not yet enabled but a key already exists, return that one. This avoids two
        // problems: (a) React StrictMode's double-mount fires /setup twice in dev — without this
        // guard the two concurrent ResetAuthenticatorKeyAsync calls race and the loser hits a
        // UNIQUE constraint on AspNetUserTokens; (b) a user who closes the QR mid-flow and
        // re-opens it would otherwise scan a new secret while their authenticator app still
        // shows the previous pairing.
        var existingKey = await userManager.GetAuthenticatorKeyAsync(user);
        if (existingKey is null)
        {
            await userManager.ResetAuthenticatorKeyAsync(user);
        }
        var key = await userManager.GetAuthenticatorKeyAsync(user)
            ?? throw new InvalidOperationException("Authenticator key was not generated.");

        var email = user.Email ?? user.UserName ?? user.Id;
        var otpauth = BuildOtpAuthUri(email, key);
        return Ok(new TwoFactorSetupResponse(key, otpauth));
    }

    /// <summary>
    /// Commits a pending authenticator pairing. Verifies the supplied TOTP code against the
    /// secret produced by <see cref="Setup"/>; on success flips <c>TwoFactorEnabled = true</c> and
    /// returns one batch of recovery codes (shown once — the client must persist them out-of-band).
    /// </summary>
    [HttpPost("enable")]
    [ProducesResponseType(typeof(TwoFactorRecoveryCodesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Enable([FromBody] TwoFactorCodeRequest request)
    {
        Response.Headers.CacheControl = "no-store";
        if (!await ValidateAntiforgeryAsync()) return BadRequestCsrf();
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var code = request.Code.Replace(" ", string.Empty, StringComparison.Ordinal);
        var verified = await userManager.VerifyTwoFactorTokenAsync(
            user,
            userManager.Options.Tokens.AuthenticatorTokenProvider,
            code);
        if (!verified)
        {
            ModelState.AddModelError(nameof(TwoFactorCodeRequest.Code), "Invalid authenticator code.");
            return ValidationProblem(ModelState);
        }

        await userManager.SetTwoFactorEnabledAsync(user, true);
        var codes = await userManager.GenerateNewTwoFactorRecoveryCodesAsync(user, 10);
        await signInManager.RefreshSignInAsync(user);
        await NotifyAsync(user, (sender, mailbox) =>
            sender.SendTwoFactorEnabledNotificationAsync(user, mailbox));
        return Ok(new TwoFactorRecoveryCodesResponse((codes ?? Array.Empty<string>()).ToList()));
    }

    /// <summary>
    /// Disables 2FA. Re-auth gated by requiring a current TOTP — a stolen session can't silently
    /// turn off 2FA without the second factor.
    /// </summary>
    [HttpPost("disable")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Disable([FromBody] TwoFactorCodeRequest request)
    {
        if (!await ValidateAntiforgeryAsync()) return BadRequestCsrf();
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        if (!await userManager.GetTwoFactorEnabledAsync(user))
        {
            return Conflict(new { error = "Two-factor authentication is not enabled." });
        }

        var code = request.Code.Replace(" ", string.Empty, StringComparison.Ordinal);
        var verified = await userManager.VerifyTwoFactorTokenAsync(
            user,
            userManager.Options.Tokens.AuthenticatorTokenProvider,
            code);
        if (!verified)
        {
            ModelState.AddModelError(nameof(TwoFactorCodeRequest.Code), "Invalid authenticator code.");
            return ValidationProblem(ModelState);
        }

        await userManager.SetTwoFactorEnabledAsync(user, false);
        await userManager.ResetAuthenticatorKeyAsync(user);
        await signInManager.RefreshSignInAsync(user);
        await NotifyAsync(user, (sender, mailbox) =>
            sender.SendTwoFactorDisabledNotificationAsync(user, mailbox));
        return NoContent();
    }

    /// <summary>
    /// Issues a fresh batch of recovery codes, invalidating any unused codes from the previous
    /// batch. Useful after one or more codes have been spent during a real recovery event.
    /// <para/>
    /// Re-auth gated by requiring a current TOTP: a stolen session alone cannot silently rotate
    /// recovery codes (which would lock the legitimate user out of the recovery flow they may
    /// already have prepared offline). Also fires a notification to the registered mailbox so an
    /// attacker who somehow has BOTH the cookie AND the current TOTP still trips an out-of-band
    /// signal.
    /// </summary>
    [HttpPost("recovery/regenerate")]
    [ProducesResponseType(typeof(TwoFactorRecoveryCodesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> RegenerateRecoveryCodes([FromBody] TwoFactorCodeRequest request)
    {
        Response.Headers.CacheControl = "no-store";
        if (!await ValidateAntiforgeryAsync()) return BadRequestCsrf();
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        if (!await userManager.GetTwoFactorEnabledAsync(user))
        {
            return Conflict(new { error = "Two-factor authentication is not enabled." });
        }

        var code = request.Code.Replace(" ", string.Empty, StringComparison.Ordinal);
        var verified = await userManager.VerifyTwoFactorTokenAsync(
            user,
            userManager.Options.Tokens.AuthenticatorTokenProvider,
            code);
        if (!verified)
        {
            ModelState.AddModelError(nameof(TwoFactorCodeRequest.Code), "Invalid authenticator code.");
            return ValidationProblem(ModelState);
        }

        var codes = await userManager.GenerateNewTwoFactorRecoveryCodesAsync(user, 10);
        await NotifyAsync(user, (sender, mailbox) =>
            sender.SendRecoveryCodesRegeneratedNotificationAsync(user, mailbox));
        return Ok(new TwoFactorRecoveryCodesResponse((codes ?? Array.Empty<string>()).ToList()));
    }

    /// <summary>
    /// Helper for the security-event notifications. Skipped when the user has no confirmed
    /// mailbox on file — we have no proof anyone reads that inbox, and sending could leak the
    /// account's existence to an attacker who picked an unconfirmed pre-registration. Fired
    /// after the action succeeds; never blocks the response.
    /// </summary>
    private async Task NotifyAsync(
        AppUser user,
        Func<IVirituraEmailSender, string, Task> send)
    {
        if (string.IsNullOrEmpty(user.Email) || !user.EmailConfirmed) return;
        await send(virituraEmailSender, user.Email);
    }

    private string BuildOtpAuthUri(string email, string secret)
    {
        // otpauth URI per https://github.com/google/google-authenticator/wiki/Key-Uri-Format
        // The account label is "{issuer}:{email}" per Google's recommendation so multiple
        // accounts disambiguate inside authenticator apps that don't render the issuer field.
        var label = urlEncoder.Encode($"{AuthenticatorIssuer}:{email}");
        var issuer = urlEncoder.Encode(AuthenticatorIssuer);
        var sb = new StringBuilder("otpauth://totp/")
            .Append(label)
            .Append("?secret=").Append(secret)
            .Append("&issuer=").Append(issuer)
            .Append("&digits=6&period=30&algorithm=SHA1");
        return sb.ToString();
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

    private BadRequestObjectResult BadRequestCsrf() =>
        BadRequest(new { error = "Antiforgery token missing or invalid." });
}