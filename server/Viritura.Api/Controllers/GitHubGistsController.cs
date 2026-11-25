using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Text;

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
[Route("github/gists")]
[Authorize]
[EnableRateLimiting("GitHubRepository")]
public sealed class GitHubGistsController(
    IGitHubInstallationStore installationStore,
    GitHubInstallationRefresher refresher,
    IGitHubOAuthClient oauthClient,
    UserManager<AppUser> userManager,
    IAntiforgery antiforgery) : ControllerBase
{
    private const int MaxFiles = 50;
    private const int MaxFileBytes = 16 * 1024 * 1024;
    private const int MaxTotalBytes = 16 * 1024 * 1024;
    private const long MaxRequestBytes = 100L * 1024 * 1024;

    public sealed record CreateGistRequest
    {
        [Required]
        public Dictionary<string, string> Files { get; init; } = [];
    }

    [HttpPost]
    [RequestSizeLimit(MaxRequestBytes)]
    [ProducesResponseType(typeof(GitHubCreatedGist), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] CreateGistRequest request, CancellationToken cancellationToken)
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
        var validationError = ValidateFiles(request.Files);
        if (validationError is not null) return BadRequest(new { error = validationError });

        var userId = userManager.GetUserId(User);
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        var installation = await installationStore.FindAsync(userId, cancellationToken);
        if (installation is null)
        {
            return Unauthorized(new { error = "Connect GitHub before creating a Gist." });
        }

        GitHubSessionEnvelope refreshed;
        try
        {
            refreshed = await refresher.RefreshAsync(installation, cancellationToken);
        }
        catch (GitHubSessionExpiredException)
        {
            await installationStore.DeleteAsync(userId, cancellationToken);
            return Unauthorized(new { error = "The GitHub session expired. Sign in with GitHub again." });
        }
        catch (HttpRequestException exception) when (IsTransient(exception.StatusCode))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "GitHub is temporarily unavailable." });
        }

        try
        {
            var gist = await oauthClient.CreateGistAsync(
                refreshed.TokenBundle.AccessToken,
                "Viritura click setlist",
                request.Files,
                cancellationToken);
            return StatusCode(StatusCodes.Status201Created, gist);
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.Unauthorized)
        {
            await installationStore.DeleteAsync(userId, cancellationToken);
            return Unauthorized(new { error = "The GitHub session expired. Sign in with GitHub again." });
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.Forbidden)
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                new
                {
                    error = "GitHub denied Gist creation. Ensure the Viritura GitHub App has Gists read and write permission, then Reconnect GitHub."
                });
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.UnprocessableEntity)
        {
            return BadRequest(new { error = "GitHub could not create this Gist. Check the file names and contents." });
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

    private static string? ValidateFiles(Dictionary<string, string> files)
    {
        if (files.Count is < 1 or > MaxFiles)
        {
            return $"A Gist setlist must contain between 1 and {MaxFiles} MNX files.";
        }

        var totalBytes = 0;
        foreach (var (name, content) in files)
        {
            if (string.IsNullOrWhiteSpace(name) ||
                name.Length > 255 ||
                name.Contains('/', StringComparison.Ordinal) ||
                name.Contains('\\', StringComparison.Ordinal) ||
                name.Any(char.IsControl) ||
                !name.EndsWith(".mnx", StringComparison.OrdinalIgnoreCase))
            {
                return "Gist file names must be simple .mnx file names.";
            }

            if (content is null) return "Gist file contents cannot be null.";

            var fileBytes = Encoding.UTF8.GetByteCount(content);
            if (fileBytes > MaxFileBytes)
            {
                return $"Each MNX file must be at most {MaxFileBytes / (1024 * 1024)} MiB.";
            }

            totalBytes += fileBytes;
            if (totalBytes > MaxTotalBytes)
            {
                return $"The setlist must be at most {MaxTotalBytes / (1024 * 1024)} MiB in total.";
            }
        }

        return null;
    }

    private static bool IsTransient(HttpStatusCode? statusCode) =>
        statusCode is null or HttpStatusCode.RequestTimeout or HttpStatusCode.BadGateway or
            HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout or
            HttpStatusCode.InternalServerError;
}