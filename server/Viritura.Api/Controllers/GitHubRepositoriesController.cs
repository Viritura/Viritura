using System.ComponentModel.DataAnnotations;
using System.Net;

using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

using Viritura.GitHub;
using Viritura.Infrastructure;

namespace Viritura.Api.Controllers;

[ApiController]
[Microsoft.AspNetCore.Cors.EnableCors("VirituraEditor")]
[Route("github/repositories")]
[Authorize]
[EnableRateLimiting("GitHubRepository")]
public sealed class GitHubRepositoriesController(
    IGitHubInstallationStore installationStore,
    GitHubInstallationRefresher refresher,
    IGitHubOAuthClient oauthClient,
    UserManager<AppUser> userManager,
    IAntiforgery antiforgery) : ControllerBase
{
    public sealed record CreateRepositoryRequest
    {
        [Required, StringLength(100, MinimumLength = 1)]
        [RegularExpression("^[A-Za-z0-9._-]+$")]
        public string Name { get; init; } = string.Empty;

        [StringLength(350)]
        public string? Description { get; init; }

        public bool Private { get; init; }

        public bool AutoInit { get; init; }
    }

    [HttpPost]
    [ProducesResponseType(typeof(GitHubCreatedRepository), StatusCodes.Status200OK)]
    public async Task<IActionResult> Create(
        [FromBody] CreateRepositoryRequest request,
        CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            await antiforgery.ValidateRequestAsync(HttpContext);
        }
        catch (AntiforgeryValidationException)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "Antiforgery token is missing or invalid." });
        }
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var userId = userManager.GetUserId(User);
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        var installation = await installationStore.FindAsync(userId, cancellationToken);
        if (installation is null)
        {
            return Unauthorized(new { error = "No Viritura GitHub installation is linked to this account." });
        }

        GitHubSessionEnvelope refreshed;
        try
        {
            refreshed = await refresher.RefreshAsync(installation, cancellationToken);
        }
        catch (GitHubSessionExpiredException)
        {
            await installationStore.DeleteAsync(userId, cancellationToken);
            return Unauthorized(new { error = "The Viritura GitHub session has expired. Sign in again." });
        }
        catch (HttpRequestException exception) when (IsTransient(exception.StatusCode))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "GitHub is temporarily unavailable." });
        }

        try
        {
            var repository = await oauthClient.CreateRepositoryAsync(
                refreshed.TokenBundle.AccessToken,
                new GitHubCreateRepository(
                    request.Name.Trim(),
                    string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                    request.Private,
                    request.AutoInit),
                cancellationToken);
            return Ok(repository);
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.Unauthorized)
        {
            await installationStore.DeleteAsync(userId, cancellationToken);
            return Unauthorized(new { error = "The Viritura GitHub session has expired. Sign in again." });
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.Forbidden)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "The GitHub installation cannot create repositories." });
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.TooManyRequests)
        {
            return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "GitHub rate-limited the request. Try again later." });
        }
        catch (HttpRequestException exception) when (IsTransient(exception.StatusCode))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "GitHub is temporarily unavailable." });
        }
    }

    private static bool IsTransient(HttpStatusCode? statusCode) =>
        statusCode is null or HttpStatusCode.RequestTimeout or HttpStatusCode.BadGateway or
            HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout or
            HttpStatusCode.InternalServerError;
}