using System.Net;
using System.Net.Http.Json;

using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

using Viritura.Api.Contracts.Auth;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class AuthControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AuthControllerTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:Provider"] = "Sqlite",
                    ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.test.{Guid.NewGuid():N}.db",
                    // Existing fixtures predate the verification flow and assume register-signs-you-in.
                    // Tests below that exercise verification opt in via their own factory override.
                    ["Auth:RequireEmailVerification"] = "false"
                });
            });
        });
    }

    private HttpClient CreateClient() => _factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost"),
        HandleCookies = true
    });

    private WebApplicationFactory<Program> WithAuthConfiguration(
        IReadOnlyDictionary<string, string?> values) =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(values);
            });
        });

    [Fact]
    public async Task Me_WhenAnonymous_ReturnsAuthenticatedFalse()
    {
        using var client = CreateClient();

        var response = await client.GetFromJsonAsync<MeResponse>("/auth/me");

        Assert.NotNull(response);
        Assert.False(response!.Authenticated);
        Assert.Null(response.User);
    }

    [Fact]
    public async Task Csrf_OverHttpDevelopment_ReturnsNonSecureCookie()
    {
        using var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("http://localhost")
        });

        var response = await client.GetAsync("/auth/csrf");

        response.EnsureSuccessStatusCode();
        var csrf = await response.Content.ReadFromJsonAsync<CsrfResponse>();
        Assert.NotNull(csrf);
        Assert.NotEmpty(csrf!.Token);
        Assert.DoesNotContain(
            response.Headers.GetValues("Set-Cookie"),
            value => value.Contains("; secure", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Capabilities_WhenGoogleFlagIsOff_DoesNotExposeConfiguredProvider()
    {
        using var factory = WithAuthConfiguration(new Dictionary<string, string?>
        {
            ["Features:Authentication:GoogleLoginEnabled"] = "false",
            ["Authentication:Google:ClientId"] = "configured-client",
            ["Authentication:Google:ClientSecret"] = "configured-secret",
            ["Viritura:GitHub:ClientId"] = "configured-github-client",
            ["Viritura:GitHub:ClientSecret"] = "configured-github-secret",
            ["Features:Authentication:EmailRegistrationMode"] = "AllowList",
            ["Features:Authentication:EmailRegistrationAllowList:0"] = "invited@viritura.test"
        });
        using var client = factory.CreateClient();

        var capabilities = await client.GetFromJsonAsync<AuthCapabilitiesResponse>("/auth/capabilities");

        Assert.NotNull(capabilities);
        Assert.True(capabilities!.GitHubLoginEnabled);
        Assert.False(capabilities.GoogleLoginEnabled);
        Assert.Equal("AllowList", capabilities.EmailRegistrationMode);
    }

    [Fact]
    public async Task GoogleStart_WhenFeatureIsDisabled_ReturnsNotFound()
    {
        using var factory = WithAuthConfiguration(new Dictionary<string, string?>
        {
            ["Features:Authentication:GoogleLoginEnabled"] = "false",
            ["Authentication:Google:ClientId"] = "configured-client",
            ["Authentication:Google:ClientSecret"] = "configured-secret"
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });

        var response = await client.GetAsync("/auth/external/google/start");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Register_InAllowListMode_RejectsUninvitedEmail()
    {
        using var factory = WithAuthConfiguration(new Dictionary<string, string?>
        {
            ["Features:Authentication:EmailRegistrationMode"] = "AllowList",
            ["Features:Authentication:EmailRegistrationAllowList:0"] = "invited@viritura.test"
        });
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = $"uninvited.{Guid.NewGuid():N}@viritura.test",
            Password = "RegisterPassw0rd!"
        });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Register_InAllowListMode_RejectsExistingAndUnknownUninvitedEmailsUniformly()
    {
        using var factory = WithAuthConfiguration(new Dictionary<string, string?>
        {
            ["Features:Authentication:EmailRegistrationMode"] = "AllowList",
            ["Features:Authentication:EmailRegistrationAllowList:0"] = "invited@viritura.test"
        });
        var existingEmail = $"existing-uninvited.{Guid.NewGuid():N}@viritura.test";
        using (var scope = factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var create = await userManager.CreateAsync(new AppUser
            {
                UserName = existingEmail,
                Email = existingEmail,
                EmailConfirmed = true
            }, "RegisterPassw0rd!");
            Assert.True(create.Succeeded);
        }

        using var client = factory.CreateClient();
        var existingResponse = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = existingEmail,
            Password = "RegisterPassw0rd!"
        });
        var unknownResponse = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = $"unknown-uninvited.{Guid.NewGuid():N}@viritura.test",
            Password = "RegisterPassw0rd!"
        });

        Assert.Equal(HttpStatusCode.Forbidden, existingResponse.StatusCode);
        Assert.Equal(existingResponse.StatusCode, unknownResponse.StatusCode);
        Assert.Equal(
            await existingResponse.Content.ReadAsStringAsync(),
            await unknownResponse.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Register_InAllowListMode_AcceptsInvitedEmailCaseInsensitively()
    {
        using var factory = WithAuthConfiguration(new Dictionary<string, string?>
        {
            ["Features:Authentication:EmailRegistrationMode"] = "AllowList",
            ["Features:Authentication:EmailRegistrationAllowList:0"] = "  Invited@Viritura.Test  "
        });
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = "invited@viritura.test",
            Password = "RegisterPassw0rd!"
        });

        Assert.True(response.IsSuccessStatusCode);
    }

    [Fact]
    public async Task Register_WithValidPayload_CreatesUserAndSignsIn()
    {
        using var client = CreateClient();
        var email = $"new.{Guid.NewGuid():N}@viritura.test";

        var registerResponse = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "RegisterPassw0rd!",
            DisplayName = "Phase A"
        });

        Assert.Equal(HttpStatusCode.OK, registerResponse.StatusCode);
        var user = await registerResponse.Content.ReadFromJsonAsync<AuthUserResponse>();
        Assert.NotNull(user);
        Assert.Equal(email, user!.Email);
        Assert.Equal("Phase A", user.DisplayName);

        var me = await client.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.True(me!.Authenticated);
        Assert.Equal(email, me.User!.Email);
    }

    [Fact]
    public async Task Register_WithDuplicateEmail_Returns202WithoutLeakingExistence()
    {
        using var client = CreateClient();
        var email = $"dup.{Guid.NewGuid():N}@viritura.test";

        await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "DupPassw0rd!12"
        });

        using var freshClient = CreateClient();
        var second = await freshClient.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "DupPassw0rd!12"
        });

        // Must not 400 — a distinguishable response for duplicates is an email-enumeration
        // oracle. The duplicate path mirrors every pending-registration response. The owner
        // gets a password-reset link out-of-band if their
        // mailbox was confirmed.
        Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);
    }

    [Fact]
    public async Task Login_WithWrongPassword_ReturnsUnauthorized()
    {
        using var registerClient = CreateClient();
        var email = $"login.{Guid.NewGuid():N}@viritura.test";

        await registerClient.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "GoodPassw0rd!"
        });

        using var loginClient = CreateClient();
        var response = await loginClient.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = "WrongPassword!"
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_WithCorrectPassword_SignsInUser()
    {
        using var registerClient = CreateClient();
        var email = $"login.{Guid.NewGuid():N}@viritura.test";

        await registerClient.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "GoodPassw0rd!"
        });

        using var loginClient = CreateClient();
        var response = await loginClient.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = "GoodPassw0rd!",
            RememberMe = true
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var me = await loginClient.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.True(me!.Authenticated);
        Assert.Equal(email, me.User!.Email);
    }

    [Fact]
    public async Task Login_WhenAccountIsOAuthOnly_Returns401Generic()
    {
        // OAuth-only accounts (no password) used to return a structured "oauth_only" response
        // with the provider list. That made /auth/login an enumeration oracle — an unauthenticated
        // caller could probe an email and learn (a) that it was registered and (b) which OAuth
        // providers it was linked to. The endpoint now returns the same generic 401 it returns
        // for unknown emails, wrong passwords, unconfirmed accounts, and lockouts.
        var email = $"oauth.{Guid.NewGuid():N}@viritura.test";
        using (var scope = _factory.Services.CreateScope())
        {
            var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = new AppUser { UserName = email, Email = email, EmailConfirmed = true };
            var create = await um.CreateAsync(user);
            Assert.True(create.Succeeded);
            var link = await um.AddLoginAsync(user, new UserLoginInfo("Google", $"test-{Guid.NewGuid():N}", "Google"));
            Assert.True(link.Succeeded);
        }

        using var client = CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = "anything"
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<GenericLoginError>();
        Assert.NotNull(body);
        Assert.Equal("Invalid email or password.", body!.Error);
    }

    [Fact]
    public async Task Login_WhenEmailUnknown_Returns401Generic()
    {
        // Sanity check that the "no such user" branch produces byte-identical output to
        // the OAuth-only and unconfirmed branches above (and AuthVerificationTests covers
        // the unconfirmed-mailbox branch under RequireEmailVerification=true).
        using var client = CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = $"ghost.{Guid.NewGuid():N}@viritura.test",
            Password = "anything"
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<GenericLoginError>();
        Assert.NotNull(body);
        Assert.Equal("Invalid email or password.", body!.Error);
    }

    private sealed record GenericLoginError(string Error);

    [Fact]
    public async Task Logout_WithoutCsrfToken_ReturnsBadRequest()
    {
        using var client = CreateClient();
        var email = $"out.{Guid.NewGuid():N}@viritura.test";

        await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "GoodPassw0rd!"
        });

        var response = await client.PostAsync("/auth/logout", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Logout_WithCsrfToken_SignsOutUser()
    {
        using var client = CreateClient();
        var email = $"out.{Guid.NewGuid():N}@viritura.test";

        await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "GoodPassw0rd!"
        });

        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        Assert.NotNull(csrf);
        Assert.False(string.IsNullOrWhiteSpace(csrf!.Token));

        using var logoutRequest = new HttpRequestMessage(HttpMethod.Post, "/auth/logout");
        logoutRequest.Headers.Add(csrf.HeaderName, csrf.Token);

        var logoutResponse = await client.SendAsync(logoutRequest);
        Assert.Equal(HttpStatusCode.NoContent, logoutResponse.StatusCode);

        var me = await client.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.False(me!.Authenticated);
    }
}