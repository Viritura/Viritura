using System.Net;
using System.Net.Http.Json;
using System.Reflection;

using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

using Viritura.Api.Contracts.Auth;
using Viritura.Api.Controllers;
using Viritura.GitHub;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class GitHubGistsControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public GitHubGistsControllerTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:Provider"] = "Sqlite",
                ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.test.{Guid.NewGuid():N}.db",
                ["Auth:RequireEmailVerification"] = "false",
                ["Viritura:GitHub:ClientId"] = "client-id",
                ["Viritura:GitHub:ClientSecret"] = "client-secret",
                ["Viritura:GitHub:RedirectUri"] = "https://localhost/github/auth/callback",
                ["Viritura:GitHub:FrontendBaseUrl"] = "http://localhost:5173",
                ["Email:Provider"] = "Console"
            }));
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IGitHubOAuthClient>();
                services.AddSingleton<GistOAuthClient>();
                services.AddSingleton<IGitHubOAuthClient>(provider => provider.GetRequiredService<GistOAuthClient>());
            });
        });
    }

    [Fact]
    public void Create_AllowsJsonEscapingForTheFullSetlistLimit()
    {
        var method = typeof(GitHubGistsController).GetMethod(nameof(GitHubGistsController.Create))!;
        var limit = method.GetCustomAttributes().OfType<IRequestSizeLimitMetadata>().Single();
        Assert.True(limit.MaxRequestBodySize >= 6L * 16 * 1024 * 1024);
    }

    [Fact]
    public async Task Create_UsesServerHeldTokenAndCreatesSecretGist()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId);
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/github/gists")
        {
            Content = JsonContent.Create(new
            {
                files = new Dictionary<string, string> { ["01 - rehearsal.mnx"] = "{\"score\":1}" }
            })
        };
        request.Headers.Add(csrf!.HeaderName, csrf.Token);

        var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.DoesNotContain("access-token", body, StringComparison.Ordinal);
        Assert.Contains("gist-id", body, StringComparison.Ordinal);
        using var scope = _factory.Services.CreateScope();
        var fake = scope.ServiceProvider.GetRequiredService<GistOAuthClient>();
        Assert.Equal("access-token", fake.LastAccessToken);
        Assert.Equal("Viritura click setlist", fake.LastDescription);
        Assert.Equal("{\"score\":1}", fake.LastFiles["01 - rehearsal.mnx"]);
    }

    [Fact]
    public async Task Create_AcceptsScoreLargerThanTheDefaultRequestLimit()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId);
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        var content = new string('x', 300 * 1024);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/github/gists")
        {
            Content = JsonContent.Create(new { files = new Dictionary<string, string> { ["score.mnx"] = content } })
        };
        request.Headers.Add(csrf!.HeaderName, csrf.Token);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var scope = _factory.Services.CreateScope();
        Assert.Equal(content, scope.ServiceProvider.GetRequiredService<GistOAuthClient>().LastFiles["score.mnx"]);
    }

    [Fact]
    public async Task Create_WithGitHubAppTokenWithoutOAuthScopesStillCreatesGist()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId, "");
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/github/gists")
        {
            Content = JsonContent.Create(new { files = new Dictionary<string, string> { ["score.mnx"] = "{}" } })
        };
        request.Headers.Add(csrf!.HeaderName, csrf.Token);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var scope = _factory.Services.CreateScope();
        Assert.Equal("access-token", scope.ServiceProvider.GetRequiredService<GistOAuthClient>().LastAccessToken);
    }

    [Fact]
    public async Task Create_WhenGitHubAppLacksGistsPermissionReturnsReauthorizationGuidance()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId, "");
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        using var scope = _factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<GistOAuthClient>().FailureStatusCode = HttpStatusCode.Forbidden;
        using var request = new HttpRequestMessage(HttpMethod.Post, "/github/gists")
        {
            Content = JsonContent.Create(new { files = new Dictionary<string, string> { ["score.mnx"] = "{}" } })
        };
        request.Headers.Add(csrf!.HeaderName, csrf.Token);

        var response = await client.SendAsync(request);
        var error = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("Gists read and write permission", error, StringComparison.Ordinal);
        Assert.Contains("Reconnect GitHub", error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Create_RejectsUnsafeFilenames()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId);
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/github/gists")
        {
            Content = JsonContent.Create(new { files = new Dictionary<string, string> { ["../score.mnx"] = "{}" } })
        };
        request.Headers.Add(csrf!.HeaderName, csrf.Token);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_RejectsNullFileContents()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId);
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/github/gists")
        {
            Content = JsonContent.Create(new { files = new Dictionary<string, string?> { ["score.mnx"] = null } })
        };
        request.Headers.Add(csrf!.HeaderName, csrf.Token);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("contents cannot be null", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Create_WithoutAntiforgeryIsForbidden()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId);

        var response = await client.PostAsJsonAsync(
            "/github/gists",
            new { files = new Dictionary<string, string> { ["score.mnx"] = "{}" } });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private HttpClient CreateClient() => _factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost"),
        HandleCookies = true
    });

    private static async Task<string> RegisterAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = $"gist.{Guid.NewGuid():N}@viritura.test",
            Password = "GoodPassw0rd!12"
        });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AuthUserResponse>())!.Id;
    }

    private async Task SeedInstallationAsync(string userId, string scope = "")
    {
        using var scopeServices = _factory.Services.CreateScope();
        var store = scopeServices.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
        await store.UpsertAsync(userId, new GitHubSessionEnvelope(
            new GitHubTokenBundle(
                "access-token",
                "refresh-token",
                DateTimeOffset.UtcNow.AddHours(1),
                DateTimeOffset.UtcNow.AddDays(30),
                "bearer",
                scope),
            new GitHubViewer(101, "viritura-user", "Viritura User", null),
            DateTimeOffset.UtcNow));
    }

    private sealed class GistOAuthClient : IGitHubOAuthClient
    {
        public string? LastAccessToken { get; private set; }
        public string? LastDescription { get; private set; }
        public Dictionary<string, string> LastFiles { get; private set; } = new();
        public HttpStatusCode? FailureStatusCode { get; set; }

        public Task<GitHubCreatedGist> CreateGistAsync(
            string accessToken,
            string description,
            IReadOnlyDictionary<string, string> files,
            CancellationToken cancellationToken = default)
        {
            LastAccessToken = accessToken;
            LastDescription = description;
            LastFiles = new Dictionary<string, string>(files);
            if (FailureStatusCode is { } statusCode)
            {
                throw new HttpRequestException("GitHub rejected Gist creation.", null, statusCode);
            }

            return Task.FromResult(new GitHubCreatedGist("gist-id", "https://gist.github.com/example/gist-id"));
        }

        public Task<GitHubTokenBundle> ExchangeCodeAsync(
            string code,
            string redirectUri,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubTokenBundle> RefreshAccessTokenAsync(
            string refreshToken,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubViewer> GetViewerAsync(string accessToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubInstallationStatus> GetViewerInstallationAsync(
            string accessToken,
            GitHubViewer viewer,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubCreatedRepository?> FindRepositoryAsync(
            string accessToken,
            string owner,
            string name,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<GitHubCreatedRepository>> ListRepositoriesAsync(
            string accessToken,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubCreatedRepository> CreateRepositoryAsync(
            string accessToken,
            GitHubCreateRepository repository,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<bool> RevokeOAuthGrantAsync(
            string accessToken,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(true);
    }
}