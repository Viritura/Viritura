using System.Net;

using Microsoft.AspNetCore.Mvc.Testing;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class CorsPolicyTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public CorsPolicyTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task MarketingOrigin_CanCallPublicAuthController()
    {
        using var client = CreateClient();
        using var request = Preflight("/auth/register", "https://viritura.com");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("https://viritura.com", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task MarketingOrigin_CannotCallAccountController()
    {
        using var client = CreateClient();
        using var request = Preflight("/account/profile", "https://viritura.com");

        using var response = await client.SendAsync(request);

        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task EditorOrigin_CanCallAccountController()
    {
        using var client = CreateClient();
        using var request = Preflight("/account/profile", "https://app.viritura.com");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("https://app.viritura.com", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    private HttpClient CreateClient() => _factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost")
    });

    private static HttpRequestMessage Preflight(string path, string origin)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, path);
        request.Headers.TryAddWithoutValidation("Origin", origin);
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type,x-xsrf-token");
        return request;
    }
}