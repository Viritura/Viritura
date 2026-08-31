using System.Net;
using System.Net.Http.Json;

using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using Viritura.Api.Contracts.Auth;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Brute-force defence for the 2FA challenge endpoints. The <c>TwoFactorAttempt</c> rate-limit
/// policy partitions by the partial-auth cookie value hash (per-victim, per-session) so that one
/// attacker can't burn another user's quota and a single attacker can't exceed the configured
/// permit count against a captured partial cookie. Permits: 10 attempts / 10-minute fixed window.
/// </summary>
public sealed class TwoFactorRateLimitTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public TwoFactorRateLimitTests(WebApplicationFactory<Program> factory)
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

    private HttpClient CreateClient() => _factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost"),
        HandleCookies = true
    });

    [Fact]
    public async Task LoginTwoFactor_AfterTenInvalidCodes_Returns429ForEleventh()
    {
        using var client = CreateClient();
        var (email, password, csrf, csrfHeader) = await RegisterWith2FAAsync(client);

        // /auth/login drops the partial cookie (HandleCookies=true so the HttpClientHandler
        // captures and replays it on subsequent requests).
        using var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = password
        });
        login.EnsureSuccessStatusCode();
        var loginBody = await login.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.True(loginBody!.RequiresTwoFactor);

        for (var i = 0; i < 10; i++)
        {
            using var attempt = await PostTwoFactorAsync(client, csrf, csrfHeader, code: "000000");
            // The first 10 attempts must NOT be 429. Identity's lockout policy can promote 401 to
            // 423 (Locked) after enough failures; that's orthogonal to the rate limiter under test.
            Assert.NotEqual(HttpStatusCode.TooManyRequests, attempt.StatusCode);
        }

        using var blocked = await PostTwoFactorAsync(client, csrf, csrfHeader, code: "000000");
        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
    }

    [Fact]
    public async Task LoginRecovery_AfterTenInvalidCodes_Returns429ForEleventh()
    {
        // Same defence on the recovery-code endpoint. If only /login/2fa were rate-limited the
        // attacker would pivot to /login/recovery and brute-force 10-character codes there.
        using var client = CreateClient();
        var (email, password, csrf, csrfHeader) = await RegisterWith2FAAsync(client);

        using var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = password
        });
        login.EnsureSuccessStatusCode();

        for (var i = 0; i < 10; i++)
        {
            using var attempt = await PostRecoveryAsync(client, csrf, csrfHeader, code: "BADCODE000");
            Assert.NotEqual(HttpStatusCode.TooManyRequests, attempt.StatusCode);
        }

        using var blocked = await PostRecoveryAsync(client, csrf, csrfHeader, code: "BADCODE000");
        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
    }

    private async Task<(string Email, string Password, string Csrf, string CsrfHeader)> RegisterWith2FAAsync(HttpClient client)
    {
        var email = $"2farl.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        using var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = password
        });
        register.EnsureSuccessStatusCode();
        var user = await register.Content.ReadFromJsonAsync<AuthUserResponse>();

        // Enable 2FA directly on the user via UserManager so we don't need the management
        // endpoints' full enrolment dance. Without this, /auth/login returns RequiresTwoFactor=false
        // and the 2FA endpoint shortcuts to 401 before the limiter has anything to measure.
        using (var scope = _factory.Services.CreateScope())
        {
            var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var dbUser = await um.FindByIdAsync(user!.Id)
                ?? throw new InvalidOperationException("User not found post-registration.");
            await um.ResetAuthenticatorKeyAsync(dbUser);
            await um.SetTwoFactorEnabledAsync(dbUser, true);
        }

        // Signing in once registered the user; sign out so /auth/login can re-enter the
        // partial-auth state cleanly.
        using var logout = await client.PostAsync("/auth/logout", content: null);
        // CSRF for the subsequent state-changing 2FA POSTs.
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        return (email, password, csrf!.Token, csrf.HeaderName);
    }

    private static async Task<HttpResponseMessage> PostTwoFactorAsync(HttpClient client, string csrf, string csrfHeader, string code)
    {
        using var msg = new HttpRequestMessage(HttpMethod.Post, "/auth/login/2fa")
        {
            Content = JsonContent.Create(new TwoFactorLoginRequest { Code = code, RememberClient = false })
        };
        msg.Headers.Add(csrfHeader, csrf);
        return await client.SendAsync(msg);
    }

    private static async Task<HttpResponseMessage> PostRecoveryAsync(HttpClient client, string csrf, string csrfHeader, string code)
    {
        using var msg = new HttpRequestMessage(HttpMethod.Post, "/auth/login/recovery")
        {
            Content = JsonContent.Create(new TwoFactorRecoveryLoginRequest { Code = code })
        };
        msg.Headers.Add(csrfHeader, csrf);
        return await client.SendAsync(msg);
    }
}