using System.Net;
using System.Net.Http.Json;

using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

using Viritura.Api.Contracts.Auth;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Exercises the email-verification path with <c>Auth:RequireEmailVerification=true</c>:
/// register should not sign you in, login should be 403 until verified, /auth/verify with a
/// real token completes the flow and signs the user in.
/// </summary>
public sealed class AuthVerificationTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AuthVerificationTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:Provider"] = "Sqlite",
                    ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.test.{Guid.NewGuid():N}.db",
                    ["Auth:RequireEmailVerification"] = "true",
                    ["Auth:WebsiteBaseUrl"] = "http://localhost:5180"
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

    [Fact]
    public async Task Register_WhenVerificationRequired_Returns202AndDoesNotSignIn()
    {
        using var client = CreateClient();
        var email = $"verify.{Guid.NewGuid():N}@viritura.test";

        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "Passw0rd!verify"
        });

        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);
        var pending = await register.Content.ReadFromJsonAsync<RegisterPendingVerificationResponse>();
        Assert.NotNull(pending);
        Assert.Equal(email, pending!.Email);
        Assert.True(pending.RequiresVerification);

        // No auth cookie was issued.
        var me = await client.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.False(me!.Authenticated);
    }

    [Fact]
    public async Task Login_WhenEmailUnconfirmed_Returns401Generic()
    {
        // /auth/login used to return 403 email_not_confirmed when SignInManager reported
        // IsNotAllowed for an unconfirmed mailbox. That distinguishable shape leaked the
        // existence of the email and the fact that its mailbox hadn't been verified — a
        // useful signal for an attacker prioritising targets. The endpoint now collapses
        // every failure mode to a generic 401 so the response is byte-identical to wrong-
        // password, unknown-email, oauth-only, and lockout responses.
        using var client = CreateClient();
        var email = $"unconf.{Guid.NewGuid():N}@viritura.test";

        await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "Passw0rd!unconf"
        });

        using var loginClient = CreateClient();
        var login = await loginClient.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = "Passw0rd!unconf"
        });

        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        var body = await login.Content.ReadFromJsonAsync<UnconfirmedLoginError>();
        Assert.NotNull(body);
        Assert.Equal("Invalid email or password.", body!.Error);
    }

    private sealed record UnconfirmedLoginError(string Error);

    [Fact]
    public async Task Verify_WithRealToken_ConfirmsAndSignsIn()
    {
        using var client = CreateClient();
        var email = $"good.{Guid.NewGuid():N}@viritura.test";

        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "Passw0rd!good"
        });
        register.EnsureSuccessStatusCode();

        // Pull a real confirmation token from Identity directly — easier than parsing the logged email.
        using var scope = _factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await userManager.FindByEmailAsync(email);
        Assert.NotNull(user);
        var token = await userManager.GenerateEmailConfirmationTokenAsync(user!);

        using var verifyClient = CreateClient();
        var verify = await verifyClient.PostAsJsonAsync("/auth/verify", new VerifyEmailRequest
        {
            Uid = user!.Id,
            Token = token
        });

        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var payload = await verify.Content.ReadFromJsonAsync<AuthUserResponse>();
        Assert.NotNull(payload);
        Assert.Equal(email, payload!.Email);

        var me = await verifyClient.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.True(me!.Authenticated);
        Assert.Equal(email, me.User!.Email);
    }

    [Fact]
    public async Task ResendVerification_AlwaysReturnsNoContent_ForExistingAndMissingEmails()
    {
        using var client = CreateClient();

        var missing = await client.PostAsJsonAsync("/auth/resend-verification", new ResendVerificationRequest
        {
            Email = $"nobody.{Guid.NewGuid():N}@viritura.test"
        });
        Assert.Equal(HttpStatusCode.NoContent, missing.StatusCode);

        var email = $"resend.{Guid.NewGuid():N}@viritura.test";
        await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "Passw0rd!resend"
        });

        var existing = await client.PostAsJsonAsync("/auth/resend-verification", new ResendVerificationRequest
        {
            Email = email
        });
        Assert.Equal(HttpStatusCode.NoContent, existing.StatusCode);
    }

    [Fact]
    public async Task VerificationEmails_StopAtPerRecipientQuota()
    {
        var emails = new FlakyEmailSender();
        using var factory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimits:VerificationEmailsPerEmailPerHour"] = "2"
                }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailSender<AppUser>>();
                services.AddSingleton<IEmailSender<AppUser>>(emails);
            });
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });
        var email = $"verification-quota.{Guid.NewGuid():N}@viritura.test";

        await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "Passw0rd!quota"
        });
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var response = await client.PostAsJsonAsync("/auth/resend-verification", new ResendVerificationRequest
            {
                Email = email
            });
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        }

        Assert.Equal(2, emails.ConfirmationAttempts);
    }

    [Fact]
    public async Task Register_WhenVerificationDeliveryFails_RemainsAcceptedAndRetryable()
    {
        var emails = new FlakyEmailSender { FailConfirmation = true };
        using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IEmailSender<AppUser>>();
            services.AddSingleton<IEmailSender<AppUser>>(emails);
        }));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });
        var email = $"recover.{Guid.NewGuid():N}@viritura.test";
        var request = new RegisterRequest { Email = email, Password = "Passw0rd!recover" };

        var initial = await client.PostAsJsonAsync("/auth/register", request);

        Assert.Equal(HttpStatusCode.Accepted, initial.StatusCode);
        Assert.Equal(1, emails.ConfirmationAttempts);
        using (var scope = factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var persisted = await userManager.FindByEmailAsync(email);
            Assert.NotNull(persisted);
            Assert.False(persisted!.EmailConfirmed);
        }

        emails.FailConfirmation = false;
        var retry = await client.PostAsJsonAsync("/auth/register", request);

        Assert.Equal(HttpStatusCode.Accepted, retry.StatusCode);
        var pending = await retry.Content.ReadFromJsonAsync<RegisterPendingVerificationResponse>();
        Assert.NotNull(pending);
        Assert.True(pending!.RequiresVerification);
        Assert.False(pending.LinkExistingAccount);
        Assert.Equal(2, emails.ConfirmationAttempts);
        Assert.Equal(1, emails.ConfirmationDeliveries);
    }

    [Fact]
    public async Task ResendVerification_WhenDeliveryFails_StillReturnsNoContent()
    {
        var emails = new FlakyEmailSender();
        using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IEmailSender<AppUser>>();
            services.AddSingleton<IEmailSender<AppUser>>(emails);
        }));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });
        var email = $"resend-failure.{Guid.NewGuid():N}@viritura.test";
        await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "Passw0rd!resend-failure"
        });
        emails.FailConfirmation = true;

        var response = await client.PostAsJsonAsync("/auth/resend-verification", new ResendVerificationRequest
        {
            Email = email
        });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private sealed class FlakyEmailSender : IEmailSender<AppUser>
    {
        public bool FailConfirmation { get; set; }
        public int ConfirmationAttempts { get; private set; }
        public int ConfirmationDeliveries { get; private set; }

        public Task SendConfirmationLinkAsync(AppUser user, string email, string confirmationLink)
        {
            ConfirmationAttempts++;
            if (FailConfirmation)
            {
                throw new HttpRequestException("Transient email provider failure.");
            }
            ConfirmationDeliveries++;
            return Task.CompletedTask;
        }

        public Task SendPasswordResetLinkAsync(AppUser user, string email, string resetLink) => Task.CompletedTask;

        public Task SendPasswordResetCodeAsync(AppUser user, string email, string resetCode) => Task.CompletedTask;
    }
}