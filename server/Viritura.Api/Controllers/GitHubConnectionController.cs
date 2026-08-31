using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

using Viritura.GitHub;
using Viritura.Infrastructure;

namespace Viritura.Api.Controllers;

[ApiController]
[Microsoft.AspNetCore.Cors.EnableCors("VirituraEditor")]
[Route("github")]
[Authorize]
public sealed class GitHubConnectionController(
    IGitHubInstallationStore installationStore,
    GitHubInstallationRefresher refresher,
    IGitHubOAuthClient oauthClient,
    UserManager<AppUser> userManager) : ControllerBase
{
    [HttpGet("session")]
    [EnableRateLimiting("GitHubSession")]
    [ProducesResponseType(typeof(GitHubSessionResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetSession(CancellationToken cancellationToken)
    {
        Response.Headers["Cache-Control"] = "no-store";

        var userId = userManager.GetUserId(User);
        if (string.IsNullOrEmpty(userId))
        {
            return Unauthorized();
        }

        var installation = await installationStore.FindAsync(userId, cancellationToken);
        if (installation is null)
        {
            return Ok(new GitHubSessionResponse(false, null, null, null));
        }

        GitHubSessionEnvelope refreshed;
        try
        {
            refreshed = await refresher.RefreshAsync(installation, cancellationToken);
        }
        catch (GitHubSessionExpiredException)
        {
            await installationStore.DeleteAsync(userId, cancellationToken);
            return Ok(new GitHubSessionResponse(false, null, null, null));
        }
        catch (HttpRequestException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "GitHub is temporarily unavailable." });
        }

        GitHubInstallationStatus status;
        try
        {
            status = await oauthClient.GetViewerInstallationAsync(refreshed.TokenBundle.AccessToken, refreshed.Viewer, cancellationToken);
        }
        catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
        {
            await installationStore.DeleteAsync(userId, cancellationToken);
            return Ok(new GitHubSessionResponse(false, null, null, null));
        }

        return Ok(new GitHubSessionResponse(true, refreshed.Viewer, refreshed.TokenBundle.ExpiresAtUtc, status));
    }

}