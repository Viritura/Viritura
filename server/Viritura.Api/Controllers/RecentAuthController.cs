using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

using Viritura.Api.Contracts.Auth;
using Viritura.Infrastructure;

namespace Viritura.Api.Controllers;

[ApiController]
[Microsoft.AspNetCore.Cors.EnableCors("VirituraEditor")]
[Route("auth/recent")]
[Authorize]
[EnableRateLimiting("Auth")]
public sealed class RecentAuthController(
    UserManager<AppUser> userManager,
    IAntiforgery antiforgery,
    RecentAuthService recentAuth,
    FrontendOriginPolicy frontendOrigins) : ControllerBase
{
    [HttpGet("status")]
    public async Task<IActionResult> Status([FromQuery] string action)
    {
        Response.Headers.CacheControl = "no-store";
        if (!TryParseAction(action, out var parsedAction)) return BadRequest(new { error = "Unknown recent-auth action." });
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();
        return Ok(new RecentAuthStatusResponse(recentAuth.IsValid(Request, user, parsedAction)));
    }

    [HttpPost("password")]
    public async Task<IActionResult> Password([FromBody] RecentAuthPasswordRequest request)
    {
        Response.Headers.CacheControl = "no-store";
        if (!await ValidateAntiforgeryAsync()) return BadRequest(new { error = "Antiforgery token missing or invalid." });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (!TryParseAction(request.Action, out var action)) return BadRequest(new { error = "Unknown recent-auth action." });

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (!await userManager.HasPasswordAsync(user))
        {
            return Conflict(new { error = "Reauthenticate with an already-linked provider." });
        }
        if (!await userManager.CheckPasswordAsync(user, request.Password))
        {
            return Unauthorized(new { error = "The current password is incorrect." });
        }
        if (await userManager.GetTwoFactorEnabledAsync(user))
        {
            var code = request.Code?.Replace(" ", string.Empty, StringComparison.Ordinal) ?? string.Empty;
            var validCode = await userManager.VerifyTwoFactorTokenAsync(
                user,
                userManager.Options.Tokens.AuthenticatorTokenProvider,
                code);
            if (!validCode)
            {
                return Unauthorized(new { error = "A current authenticator code is required." });
            }
        }

        recentAuth.Issue(Response, user, action, "password");
        return NoContent();
    }

    [HttpGet("provider/{provider}/start")]
    public async Task<IActionResult> StartProvider(
        string provider,
        [FromQuery] string action,
        [FromQuery] string? returnTo)
    {
        Response.Headers.CacheControl = "no-store";
        if (!TryParseProvider(provider, out var normalizedProvider) || !TryParseAction(action, out var parsedAction))
        {
            return BadRequest(new { error = "Unknown provider or recent-auth action." });
        }

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();
        var logins = await userManager.GetLoginsAsync(user);
        if (!logins.Any(login => string.Equals(login.LoginProvider, normalizedProvider, StringComparison.Ordinal)))
        {
            return Conflict(new { error = "The provider must already be linked to this account." });
        }

        var safeReturnTo = ResolveReturnTo(returnTo);
        var marker = recentAuth.BeginProviderFlow(user.Id, normalizedProvider, parsedAction, safeReturnTo);
        var path = normalizedProvider == "Google"
            ? "/auth/external/google/start"
            : "/github/auth/start";
        return Redirect($"{path}?returnTo={Uri.EscapeDataString(marker)}");
    }

    private string ResolveReturnTo(string? returnTo)
    {
        if (frontendOrigins.TryResolveReturnUrl(returnTo, out var resolved)) return resolved;
        return string.IsNullOrWhiteSpace(frontendOrigins.PrimaryBaseUrl)
            ? "/"
            : frontendOrigins.PrimaryBaseUrl;
    }

    internal static bool TryParseAction(string value, out RecentAuthAction action) =>
        Enum.TryParse(value, ignoreCase: true, out action) && Enum.IsDefined(action);

    private static bool TryParseProvider(string value, out string provider)
    {
        if (string.Equals(value, "Google", StringComparison.OrdinalIgnoreCase))
        {
            provider = "Google";
            return true;
        }
        if (string.Equals(value, "GitHub", StringComparison.OrdinalIgnoreCase))
        {
            provider = "GitHub";
            return true;
        }
        provider = string.Empty;
        return false;
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
}