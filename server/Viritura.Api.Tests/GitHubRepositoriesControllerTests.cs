using System.Net;
using System.Net.Http.Json;

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

public sealed class GitHubRepositoriesControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public GitHubRepositoriesControllerTests(WebApplicationFactory<Program> factory)
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
                services.AddSingleton<RepositoryOAuthClient>();
                services.AddSingleton<IGitHubOAuthClient>(provider => provider.GetRequiredService<RepositoryOAuthClient>());
            });
        });
    }

    [Fact]
    public async Task Create_UsesServerHeldTokenAndReturnsScrubbedRepository()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId);
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/github/repositories")
        {
            Content = JsonContent.Create(new GitHubRepositoriesController.CreateRepositoryRequest
            {
                Name = "score-project",
                Description = "A score",
                Private = true,
                AutoInit = true
            })
        };
        request.Headers.Add(csrf!.HeaderName, csrf.Token);

        var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain("access-token", body, StringComparison.Ordinal);
        Assert.DoesNotContain("refresh-token", body, StringComparison.Ordinal);
        Assert.Contains("score-project", body, StringComparison.Ordinal);
        using var scope = _factory.Services.CreateScope();
        var fake = scope.ServiceProvider.GetRequiredService<RepositoryOAuthClient>();
        Assert.Equal("access-token", fake.LastAccessToken);
    }

    [Fact]
    public async Task Create_WhenGitHubIsTransientlyUnavailable_PreservesInstallation()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId);
        using (var scope = _factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<RepositoryOAuthClient>().FailureStatus = HttpStatusCode.ServiceUnavailable;
        }
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/github/repositories")
        {
            Content = JsonContent.Create(new GitHubRepositoriesController.CreateRepositoryRequest { Name = "score-project" })
        };
        request.Headers.Add(csrf!.HeaderName, csrf.Token);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        using var verifyScope = _factory.Services.CreateScope();
        var store = verifyScope.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
        Assert.NotNull(await store.FindAsync(userId));
    }

    [Fact]
    public async Task Create_WithoutAntiforgery_IsForbidden()
    {
        using var client = CreateClient();
        var userId = await RegisterAsync(client);
        await SeedInstallationAsync(userId);

        var response = await client.PostAsJsonAsync(
            "/github/repositories",
            new GitHubRepositoriesController.CreateRepositoryRequest { Name = "score-project" });

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
            Email = $"repo.{Guid.NewGuid():N}@viritura.test",
            Password = "GoodPassw0rd!12"
        });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AuthUserResponse>())!.Id;
    }

    private async Task SeedInstallationAsync(string userId)
    {
        using var scope = _factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
        await store.UpsertAsync(userId, new GitHubSessionEnvelope(
            new GitHubTokenBundle(
                "access-token",
                "refresh-token",
                DateTimeOffset.UtcNow.AddHours(1),
                DateTimeOffset.UtcNow.AddDays(30),
                "bearer",
                "repo read:user"),
            new GitHubViewer(101, "viritura-user", "Viritura User", null),
            DateTimeOffset.UtcNow));
    }

    private sealed class RepositoryOAuthClient : IGitHubOAuthClient
    {
        public HttpStatusCode? FailureStatus { get; set; }

        public string? LastAccessToken { get; private set; }

        public Task<GitHubCreatedRepository> CreateRepositoryAsync(
            string accessToken,
            GitHubCreateRepository repository,
            CancellationToken cancellationToken = default)
        {
            LastAccessToken = accessToken;
            if (FailureStatus is { } status) throw new HttpRequestException("GitHub failure", null, status);
            return Task.FromResult(new GitHubCreatedRepository(
                42,
                repository.Name,
                "viritura-user/" + repository.Name,
                "https://github.com/viritura-user/" + repository.Name,
                "https://github.com/viritura-user/" + repository.Name + ".git",
                repository.Private,
                "main"));
        }

        public Task<GitHubTokenBundle> ExchangeCodeAsync(string code, string redirectUri, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubTokenBundle> RefreshAccessTokenAsync(string refreshToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubViewer> GetViewerAsync(string accessToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubInstallationStatus> GetViewerInstallationAsync(string accessToken, GitHubViewer viewer, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<bool> RevokeOAuthGrantAsync(string accessToken, CancellationToken cancellationToken = default) =>
            Task.FromResult(true);
    }
}