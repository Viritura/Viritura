using System.Net;
using System.Net.Http.Json;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

using Viritura.Api.Contracts.Auth;
using Viritura.Api.Controllers;
using Viritura.GitHub;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class GitHubAuthControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public GitHubAuthControllerTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(GitHubTestConfiguration("http://localhost:5173"));
            });
        });
    }

    private static Dictionary<string, string?> GitHubTestConfiguration(string frontendBaseUrl) => new()
    {
        ["Database:Provider"] = "Sqlite",
        ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.test.{Guid.NewGuid():N}.db",
        ["Auth:RequireEmailVerification"] = "false",
        ["Features:Authentication:EmailRegistrationMode"] = "Open",
        ["Viritura:GitHub:ClientId"] = "client-id",
        ["Viritura:GitHub:ClientSecret"] = "client-secret",
        ["Viritura:GitHub:RedirectUri"] = "https://localhost/github/auth/callback",
        ["Viritura:GitHub:FrontendBaseUrl"] = frontendBaseUrl,
        ["Viritura:GitHub:AppSlug"] = "viritura-dev",
        ["Email:Provider"] = "Console"
    };

    private HttpClient CreateClient() => _factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost"),
        HandleCookies = true
    });

    private static async Task<string> RegisterAndSignInAsync(HttpClient client)
    {
        var email = $"gh.{Guid.NewGuid():N}@viritura.test";
        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "GoodPassw0rd!"
        });
        response.EnsureSuccessStatusCode();
        var user = await response.Content.ReadFromJsonAsync<AuthUserResponse>();
        Assert.NotNull(user);
        return user!.Id;
    }

    private async Task SeedInstallationAsync(string userId, GitHubSessionEnvelope session)
    {
        using var scope = _factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
        await store.UpsertAsync(userId, session);
    }

    [Fact]
    public async Task Callback_WithGitHubAppInstallSetup_RedirectsToEditor()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/github/auth/callback?installation_id=123&setup_action=install");

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("http://localhost:5173/", response.Headers.Location?.ToString());
    }

    [Fact]
    public async Task Callback_WithoutOAuthOrSetupParameters_ReturnsBadRequest()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/github/auth/callback");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Session_WhenUnauthenticated_ReturnsUnauthorized()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/github/session");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Session_WhenAuthenticatedWithoutInstallation_ReturnsDisconnected()
    {
        using var client = CreateClient();
        await RegisterAndSignInAsync(client);

        var response = await client.GetAsync("/github/session");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<GitHubSessionResponse>();
        Assert.NotNull(body);
        Assert.False(body!.Connected);
        Assert.Null(body.Viewer);
    }

    [Fact]
    public async Task BrowserTokenEndpoint_IsNotExposed()
    {
        using var client = CreateClient();

        var response = await client.PostAsync("/github/token", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Session_WithRevokedGitHubToken_DeletesInstallationAndReturnsDisconnected()
    {
        using var factory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<IGitHubOAuthClient, RevokedInstallationOAuthClient>();
            });
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost"),
            HandleCookies = true
        });

        var email = $"rev.{Guid.NewGuid():N}@viritura.test";
        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "GoodPassw0rd!"
        });
        register.EnsureSuccessStatusCode();
        var user = await register.Content.ReadFromJsonAsync<AuthUserResponse>();

        using (var scope = factory.Services.CreateScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
            await store.UpsertAsync(user!.Id, CreateSession());
        }

        var response = await client.GetAsync("/github/session");
        var body = await response.Content.ReadFromJsonAsync<GitHubSessionResponse>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(body!.Connected);

        using var verifyScope = factory.Services.CreateScope();
        var verifyStore = verifyScope.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
        var installation = await verifyStore.FindAsync(user!.Id);
        Assert.Null(installation);
    }

    [Fact]
    public async Task GitProxy_WithoutUiOrigin_AndUnauthenticated_ReturnsUnauthorized()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/github/git/github.com/owner/repo.git/info/refs?service=git-receive-pack");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GitProxy_AuthenticatedWithDisallowedOrigin_ReturnsForbidden()
    {
        using var client = CreateClient();
        await RegisterAndSignInAsync(client);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/github/git/github.com/owner/repo.git/info/refs?service=git-receive-pack");
        request.Headers.TryAddWithoutValidation("Origin", "https://example.com");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task GitProxy_WithUiOriginButUnauthenticated_ReturnsUnauthorized()
    {
        using var client = CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/github/git/github.com/owner/repo.git/info/refs?service=git-receive-pack");
        request.Headers.TryAddWithoutValidation("Origin", "http://localhost:5173");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GitProxy_WhenAuthenticatedWithoutInstallation_ReturnsUnauthorized()
    {
        using var client = CreateClient();
        await RegisterAndSignInAsync(client);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/github/git/github.com/owner/repo.git/info/refs?service=git-receive-pack");
        request.Headers.TryAddWithoutValidation("Origin", "http://localhost:5173");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GitProxy_InProduction_AuthenticatedWithLocalhostUiOrigin_ReturnsForbidden()
    {
        using var factory = CreateProductionFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost"),
            HandleCookies = true
        });
        var email = $"prod.{Guid.NewGuid():N}@viritura.test";
        await client.PostAsJsonAsync("/auth/register", new RegisterRequest { Email = email, Password = "GoodPassw0rd!" });

        using var request = new HttpRequestMessage(HttpMethod.Get, "/github/git/github.com/owner/repo.git/info/refs?service=git-receive-pack");
        request.Headers.TryAddWithoutValidation("Origin", "http://localhost:5173");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task GitProxy_InProduction_WithAppUiOriginUnauthenticated_ReturnsUnauthorized()
    {
        using var client = CreateProductionFactory().CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost"),
            HandleCookies = true
        });
        using var request = new HttpRequestMessage(HttpMethod.Get, "/github/git/github.com/owner/repo.git/info/refs?service=git-receive-pack");
        request.Headers.TryAddWithoutValidation("Origin", "https://app.viritura.com");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public void ProductionOriginValidation_WithHttpConfiguredOrigin_Throws()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubSecurityOptionsValidator.ValidateProductionOrigins(
                new GitHubAuthOptions { FrontendBaseUrl = "https://app.viritura.com" },
                ["http://example.com"]));

        Assert.Contains("must use HTTPS", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void AccountCreationFailureLog_OmitsIdentityDescriptionsAndEmail()
    {
        var logger = new CapturingLogger<GitHubAuthController>();
        var email = "sensitive.create@example.com";
        var result = SensitiveIdentityFailure(email);

        GitHubAuthController.LogAccountCreationFailure(logger, "101", result);

        AssertSafeIdentityErrorLog(logger, email, "ProviderKey", "101");
    }

    [Fact]
    public void EmailBackfillFailureLog_OmitsIdentityDescriptionsAndEmail()
    {
        var logger = new CapturingLogger<GitHubAuthController>();
        var email = "sensitive.backfill@example.com";
        var result = SensitiveIdentityFailure(email);

        GitHubAuthController.LogEmailBackfillFailure(logger, "user-101", result);

        AssertSafeIdentityErrorLog(logger, email, "UserId", "user-101");
    }

    private static IdentityResult SensitiveIdentityFailure(string email) =>
        IdentityResult.Failed(
            new IdentityError
            {
                Code = "DuplicateEmail",
                Description = $"Email '{email}' is already taken."
            },
            new IdentityError
            {
                Code = "InvalidEmail",
                Description = $"Email '{email}' is invalid."
            });

    private static void AssertSafeIdentityErrorLog(
        CapturingLogger<GitHubAuthController> logger,
        string email,
        string contextKey,
        string contextValue)
    {
        Assert.DoesNotContain(email, logger.RenderedMessage, StringComparison.Ordinal);
        Assert.DoesNotContain("already taken", logger.RenderedMessage, StringComparison.Ordinal);
        Assert.DoesNotContain("is invalid", logger.RenderedMessage, StringComparison.Ordinal);
        Assert.Equal("DuplicateEmail; InvalidEmail", logger.Properties["ErrorCodes"]);
        Assert.Equal(contextValue, logger.Properties[contextKey]);

        var structuredLog = string.Join(
            "|",
            logger.Properties.Select(property => $"{property.Key}={property.Value}"));
        Assert.DoesNotContain(email, structuredLog, StringComparison.Ordinal);
    }

    private WebApplicationFactory<Program> CreateProductionFactory() =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            // Production-mode DataProtection requires an explicit keys directory; use a
            // per-test temp dir so the assertion in AddDataProtectionPersistence is satisfied
            // without leaking key material between tests. UseSetting writes into the
            // IConfigurationBuilder early enough that builder.Configuration[...] in Program.cs
            // sees it (ConfigureAppConfiguration hooks ran too late for this code path).
            builder.UseSetting(
                "DataProtection:KeysDirectory",
                Path.Combine(Path.GetTempPath(), "viritura-test-dp-" + Guid.NewGuid().ToString("N")));
            builder.UseSetting("Email:Provider", "Resend");
            builder.UseSetting("Email:Resend:ApiKey", "re_test_key");
            builder.UseSetting("Email:Resend:From", "Viritura <accounts@viritura.test>");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(GitHubTestConfiguration("https://app.viritura.com"));
            });
        });

    private static GitHubSessionEnvelope CreateSession() =>
        new(
            new GitHubTokenBundle(
                "access-token",
                "refresh-token",
                DateTimeOffset.UtcNow.AddHours(1),
                DateTimeOffset.UtcNow.AddDays(30),
                "bearer",
                "repo read:user"),
            new GitHubViewer(101, "viritura-user", "Viritura User", "https://avatars.githubusercontent.com/u/101"),
            DateTimeOffset.UtcNow);

    private static GitHubSessionEnvelope CreateExpiredSessionWithoutRefreshToken() =>
        new(
            new GitHubTokenBundle(
                "expired-access-token",
                null,
                DateTimeOffset.UtcNow.AddMinutes(-5),
                null,
                "bearer",
                "repo read:user"),
            new GitHubViewer(101, "viritura-user", "Viritura User", "https://avatars.githubusercontent.com/u/101"),
            DateTimeOffset.UtcNow.AddDays(-7));

    private sealed class RevokedInstallationOAuthClient : IGitHubOAuthClient
    {
        public Task<GitHubTokenBundle> ExchangeCodeAsync(string code, string redirectUri, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubTokenBundle> RefreshAccessTokenAsync(string refreshToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubViewer> GetViewerAsync(string accessToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<GitHubInstallationStatus> GetViewerInstallationAsync(string accessToken, GitHubViewer viewer, CancellationToken cancellationToken = default) =>
            throw new HttpRequestException("GitHub token was revoked.", null, HttpStatusCode.Unauthorized);

        public Task<GitHubCreatedRepository> CreateRepositoryAsync(
            string accessToken,
            GitHubCreateRepository repository,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<bool> RevokeOAuthGrantAsync(string accessToken, CancellationToken cancellationToken = default) =>
            Task.FromResult(true);
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public string RenderedMessage { get; private set; } = string.Empty;

        public Dictionary<string, object?> Properties { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            RenderedMessage = formatter(state, exception);
            if (state is IEnumerable<KeyValuePair<string, object?>> properties)
            {
                foreach (var property in properties)
                {
                    Properties[property.Key] = property.Value;
                }
            }
        }
    }
}