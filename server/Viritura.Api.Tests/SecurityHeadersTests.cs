using System.Net.Http.Json;

using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Smoke tests that confirm <see cref="Viritura.Api.SecurityHeadersMiddleware"/> is wired and
/// emitting the headers we depend on. Assertions intentionally check only presence + minimum
/// content so the suite isn't brittle if the exact header values evolve.
/// </summary>
public sealed class SecurityHeadersTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public SecurityHeadersTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:Provider"] = "Sqlite",
                    ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.test.{Guid.NewGuid():N}.db",
                    ["Auth:RequireEmailVerification"] = "false"
                });
            });
        });
    }

    [Fact]
    public async Task SecurityHeaders_AreEmittedOnApiResponses()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/auth/me");

        Assert.True(response.Headers.Contains("X-Frame-Options"),
            "X-Frame-Options must be set so OAuth/error pages cannot be framed for clickjacking.");
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").First());

        Assert.True(response.Headers.Contains("X-Content-Type-Options"));
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").First());

        Assert.True(response.Headers.Contains("Referrer-Policy"),
            "Referrer-Policy must be set so token-bearing URLs (?token=…) don't leak via the Referer header.");

        Assert.True(response.Headers.Contains("Content-Security-Policy"),
            "API CSP must lock down framing + base-uri + form-action.");
        var csp = response.Headers.GetValues("Content-Security-Policy").First();
        Assert.Contains("frame-ancestors 'none'", csp, StringComparison.Ordinal);
        Assert.Contains("default-src 'none'", csp, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("/server-ui/server-ui.css", "text/css")]
    [InlineData("/server-ui/server-ui.js", "text/javascript")]
    public async Task ServerUiAssets_AreServedWithStrictHeaders(string path, string mediaType)
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync(path);

        response.EnsureSuccessStatusCode();
        Assert.Equal(mediaType, response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("default-src 'none'", csp, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("http://127.0.0.1:3418/callback", "http://127.0.0.1:3418")]
    [InlineData("https://client.example/callback", "https://client.example")]
    public async Task OAuthConsent_CspAllowsOnlyTheRequestedSafeRedirectOrigin(
        string redirectUri,
        string expectedOrigin)
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync($"/oauth/authorize?redirect_uri={Uri.EscapeDataString(redirectUri)}");

        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains($"form-action 'self' {expectedOrigin}", csp, StringComparison.Ordinal);
    }

    [Fact]
    public async Task OAuthConsent_CspRejectsNonLoopbackHttpRedirectOrigin()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync(
            $"/oauth/authorize?redirect_uri={Uri.EscapeDataString("http://attacker.example/callback")}");

        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.EndsWith("form-action 'self'", csp, StringComparison.Ordinal);
        Assert.DoesNotContain("attacker.example", csp, StringComparison.Ordinal);
    }
}