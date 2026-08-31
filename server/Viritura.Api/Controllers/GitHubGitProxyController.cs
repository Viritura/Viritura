using System.Net.Http.Headers;
using System.Text;

using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

using Viritura.GitHub;
using Viritura.Infrastructure;

namespace Viritura.Api.Controllers;

[ApiController]
[Microsoft.AspNetCore.Cors.EnableCors("VirituraEditor")]
[Route("github/git")]
[Authorize]
[EnableRateLimiting("GitHubGitProxy")]
public sealed class GitHubGitProxyController(
    IHttpClientFactory httpClientFactory,
    IOptions<GitHubAuthOptions> options,
    IGitHubInstallationStore installationStore,
    GitHubInstallationRefresher refresher,
    UserManager<AppUser> userManager,
    IAntiforgery antiforgery,
    IHostEnvironment environment) : ControllerBase
{
    private const long MaxGitRequestBytes = 25L * 1024L * 1024L;
    private static readonly string[] ProductionAllowedFrontendOrigins =
    [
        "https://app.viritura.com"
    ];

    private static readonly string[] DevelopmentAllowedFrontendOrigins =
    [
        "http://localhost:5173",
        "https://localhost:5173",
        "http://localhost:4173",
        "https://localhost:4173"
    ];

    [AcceptVerbs("GET", "POST")]
    [Route("{**target}")]
    [RequestSizeLimit(MaxGitRequestBytes)]
    public async Task<IActionResult> Proxy(string? target, CancellationToken cancellationToken)
    {
        var authOptions = options.Value;
        if (!IsAllowedUiRequest(authOptions))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "Git proxy requests must come from an allowed Viritura UI origin." });
        }

        // Antiforgery on state-changing verbs (defence-in-depth alongside Origin/Referer):
        // the proxy carries the user's GitHub installation token, so a forged POST from a
        // malicious page would be doubly damaging. The SPA already manages the antiforgery
        // cookie/header pair via its standard fetch wrapper. GET (advertise refs) is read-only
        // and skips the check.
        if (HttpMethods.IsPost(Request.Method))
        {
            try
            {
                await antiforgery.ValidateRequestAsync(HttpContext);
            }
            catch (AntiforgeryValidationException)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { error = "Antiforgery token is missing or invalid." });
            }
        }

        if (Request.ContentLength is > MaxGitRequestBytes)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = "Git push payload is too large." });
        }

        if (!TryBuildGitHubUri(target, Request.Method, Request.QueryString.Value, out var githubUri))
        {
            return BadRequest(new { error = "Git proxy requests must target GitHub smart HTTP endpoints." });
        }

        var userId = userManager.GetUserId(User);
        if (string.IsNullOrEmpty(userId))
        {
            return Unauthorized();
        }

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
        catch (HttpRequestException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "GitHub is temporarily unavailable." });
        }

        using var request = new HttpRequestMessage(new HttpMethod(Request.Method), githubUri);
        CopyRequestHeaders(request, refreshed.TokenBundle.AccessToken);

        if (HttpMethods.IsPost(Request.Method))
        {
            request.Content = new StreamContent(Request.Body);
            if (!string.IsNullOrWhiteSpace(Request.ContentType))
            {
                request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(Request.ContentType);
            }
        }

        using var httpClient = httpClientFactory.CreateClient();
        using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        CopyResponseHeaders(response);
        await response.Content.CopyToAsync(Response.Body, cancellationToken);
        return new EmptyResult();
    }

    private static bool TryBuildGitHubUri(string? target, string method, string? queryString, out Uri uri)
    {
        uri = null!;
        if (string.IsNullOrWhiteSpace(target)) return false;

        var candidate = "https://" + target.TrimStart('/');
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var parsed)) return false;
        if (!string.Equals(parsed.Host, "github.com", StringComparison.OrdinalIgnoreCase)) return false;
        if (!IsAllowedGitSmartHttpPath(parsed.AbsolutePath, method, queryString)) return false;

        var builder = new UriBuilder(parsed)
        {
            Query = string.IsNullOrWhiteSpace(queryString) ? string.Empty : queryString.TrimStart('?')
        };
        uri = builder.Uri;
        return true;
    }

    private static bool IsAllowedGitSmartHttpPath(string path, string method, string? queryString)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 3 || !segments[1].EndsWith(".git", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (HttpMethods.IsGet(method))
        {
            return segments.Length == 4 &&
                string.Equals(segments[2], "info", StringComparison.Ordinal) &&
                string.Equals(segments[3], "refs", StringComparison.Ordinal) &&
                IsAllowedGitService(queryString?.TrimStart('?'));
        }

        return HttpMethods.IsPost(method) &&
            segments.Length == 3 &&
            IsAllowedGitEndpoint(segments[2]) &&
            string.IsNullOrWhiteSpace(queryString);
    }

    private static bool IsAllowedGitService(string? query) =>
        string.Equals(query, "service=git-receive-pack", StringComparison.Ordinal) ||
        string.Equals(query, "service=git-upload-pack", StringComparison.Ordinal);

    private static bool IsAllowedGitEndpoint(string segment) =>
        string.Equals(segment, "git-receive-pack", StringComparison.Ordinal) ||
        string.Equals(segment, "git-upload-pack", StringComparison.Ordinal);

    private void CopyRequestHeaders(HttpRequestMessage request, string accessToken)
    {
        var gitCredential = Convert.ToBase64String(Encoding.UTF8.GetBytes($"x-access-token:{accessToken}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", gitCredential);

        CopyHeaderIfPresent(request, "Accept");
        CopyHeaderIfPresent(request, "Git-Protocol");
        CopyHeaderIfPresent(request, "User-Agent");
    }

    private void CopyHeaderIfPresent(HttpRequestMessage request, string headerName)
    {
        if (Request.Headers.TryGetValue(headerName, out var value))
        {
            request.Headers.TryAddWithoutValidation(headerName, value.ToArray());
        }
    }

    private void CopyResponseHeaders(HttpResponseMessage response)
    {
        Response.StatusCode = (int)response.StatusCode;
        foreach (var header in response.Headers)
        {
            Response.Headers[header.Key] = header.Value.ToArray();
        }
        foreach (var header in response.Content.Headers)
        {
            Response.Headers[header.Key] = header.Value.ToArray();
        }
        Response.Headers.Remove("transfer-encoding");
        Response.Headers.Remove("set-cookie");
        Response.Headers["Cache-Control"] = "no-store";
    }

    private bool IsAllowedUiRequest(GitHubAuthOptions authOptions)
    {
        if (TryReadOrigin(Request.Headers.Origin.ToString(), out var origin))
        {
            return IsAllowedOrigin(origin, authOptions);
        }

        if (Uri.TryCreate(Request.Headers.Referer.ToString(), UriKind.Absolute, out var referer))
        {
            return IsAllowedOrigin(referer, authOptions);
        }

        return false;
    }

    private static bool TryReadOrigin(string? value, out Uri origin)
    {
        origin = null!;
        if (string.IsNullOrWhiteSpace(value)) return false;
        return Uri.TryCreate(value, UriKind.Absolute, out origin!);
    }

    private bool IsAllowedOrigin(Uri uri, GitHubAuthOptions authOptions)
    {
        if (!environment.IsDevelopment() && IsLocalhostOrigin(uri))
        {
            return false;
        }

        return EnumerateAllowedOrigins(authOptions).Any(origin =>
            Uri.TryCreate(origin, UriKind.Absolute, out var allowed) &&
            string.Equals(uri.GetLeftPart(UriPartial.Authority), allowed.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase));
    }

    private IEnumerable<string> EnumerateAllowedOrigins(GitHubAuthOptions authOptions)
    {
        var builtInOrigins = environment.IsDevelopment()
            ? ProductionAllowedFrontendOrigins.Concat(DevelopmentAllowedFrontendOrigins)
            : ProductionAllowedFrontendOrigins;

        return builtInOrigins
            .Concat(authOptions.AllowedFrontendOrigins)
            .Append(authOptions.FrontendBaseUrl)
            .Where(origin => !string.IsNullOrWhiteSpace(origin))
            .Where(origin => environment.IsDevelopment() || !IsLocalhostOrigin(origin));
    }

    private static bool IsLocalhostOrigin(Uri uri) =>
        uri.IsLoopback || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase);

    private static bool IsLocalhostOrigin(string origin) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri) && IsLocalhostOrigin(uri);
}