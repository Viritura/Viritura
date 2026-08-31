using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

using Viritura.GitHub;

namespace Viritura.Api.Controllers;

[ApiController]
[Microsoft.AspNetCore.Cors.EnableCors("VirituraEditor")]
[Route("github/app")]
public sealed class GitHubAppController(IOptions<GitHubAuthOptions> options) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(GitHubAppResponse), StatusCodes.Status200OK)]
    public IActionResult GetAppMetadata()
    {
        var authOptions = options.Value;
        return Ok(new GitHubAppResponse(
            authOptions.IsConfigured,
            string.IsNullOrWhiteSpace(authOptions.AppSlug) ? null : authOptions.AppSlug,
            string.IsNullOrWhiteSpace(authOptions.ClientId) ? null : authOptions.ClientId,
            string.IsNullOrWhiteSpace(authOptions.InstallUrl) ? null : authOptions.InstallUrl));
    }
}