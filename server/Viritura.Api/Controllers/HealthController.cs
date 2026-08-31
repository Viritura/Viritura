using Microsoft.AspNetCore.Mvc;

namespace Viritura.Api.Controllers;

[ApiController]
[Route("health")]
public sealed class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { status = "ok", service = "Viritura API" });
}