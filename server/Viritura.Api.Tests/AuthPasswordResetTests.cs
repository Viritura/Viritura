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
/// Exercises the forgot-password / reset-password flow. <c>/auth/forgot-password</c> must be
/// enumeration-safe (always 204), <c>/auth/reset-password</c> must accept a real token, replace
/// the password, sign the user in, and reject invalid/weak inputs.
/// </summary>
public sealed class AuthPasswordResetTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AuthPasswordResetTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:Provider"] = "Sqlite",
                    ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.test.{Guid.NewGuid():N}.db",
                    // Skip verification so we can focus on the reset flow itself.
                    ["Auth:RequireEmailVerification"] = "false",
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

    private async Task<(string Id, string Email, string Password)> RegisterUserAsync(HttpClient client)
    {
        var email = $"reset.{Guid.NewGuid():N}@viritura.test";
        const string password = "Passw0rd!reset";

        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = password
        });
        register.EnsureSuccessStatusCode();

        using var scope = _factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await userManager.FindByEmailAsync(email);
        Assert.NotNull(user);
        return (user!.Id, email, password);
    }

    [Fact]
    public async Task ForgotPassword_ReturnsNoContent_ForExistingAndMissingEmails()
    {
        using var client = CreateClient();

        var missing = await client.PostAsJsonAsync("/auth/forgot-password", new ForgotPasswordRequest
        {
            Email = $"nobody.{Guid.NewGuid():N}@viritura.test"
        });
        Assert.Equal(HttpStatusCode.NoContent, missing.StatusCode);

        var (_, email, _) = await RegisterUserAsync(client);

        var existing = await client.PostAsJsonAsync("/auth/forgot-password", new ForgotPasswordRequest
        {
            Email = email
        });
        Assert.Equal(HttpStatusCode.NoContent, existing.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_WithRealToken_ResetsAndSignsIn()
    {
        using var client = CreateClient();
        var (uid, email, oldPassword) = await RegisterUserAsync(client);

        string token;
        using (var scope = _factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = await userManager.FindByIdAsync(uid);
            token = await userManager.GeneratePasswordResetTokenAsync(user!);
        }

        const string newPassword = "Passw0rd!fresh";
        using var resetClient = CreateClient();
        var reset = await resetClient.PostAsJsonAsync("/auth/reset-password", new ResetPasswordRequest
        {
            Uid = uid,
            Token = token,
            NewPassword = newPassword
        });

        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        var payload = await reset.Content.ReadFromJsonAsync<AuthUserResponse>();
        Assert.NotNull(payload);
        Assert.Equal(email, payload!.Email);

        // Reset client is signed in.
        var me = await resetClient.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.True(me!.Authenticated);

        // Old password no longer works.
        using var oldClient = CreateClient();
        var oldLogin = await oldClient.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = oldPassword
        });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);

        // New password works.
        using var newClient = CreateClient();
        var newLogin = await newClient.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = newPassword
        });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_WithInvalidToken_Returns400()
    {
        using var client = CreateClient();
        var (uid, _, _) = await RegisterUserAsync(client);

        var reset = await client.PostAsJsonAsync("/auth/reset-password", new ResetPasswordRequest
        {
            Uid = uid,
            Token = "not-a-real-token",
            NewPassword = "Passw0rd!whatever"
        });

        Assert.Equal(HttpStatusCode.BadRequest, reset.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_WithUnknownUid_Returns400()
    {
        using var client = CreateClient();

        var reset = await client.PostAsJsonAsync("/auth/reset-password", new ResetPasswordRequest
        {
            Uid = Guid.NewGuid().ToString(),
            Token = "anything",
            NewPassword = "Passw0rd!whatever"
        });

        Assert.Equal(HttpStatusCode.BadRequest, reset.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_WithWeakPassword_ReturnsValidationProblem()
    {
        using var client = CreateClient();
        var (uid, _, _) = await RegisterUserAsync(client);

        string token;
        using (var scope = _factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = await userManager.FindByIdAsync(uid);
            token = await userManager.GeneratePasswordResetTokenAsync(user!);
        }

        var reset = await client.PostAsJsonAsync("/auth/reset-password", new ResetPasswordRequest
        {
            Uid = uid,
            Token = token,
            // Server-side annotation requires >= 8 chars; this triggers ModelState validation
            // before we ever touch Identity, which still returns 400 with a problem document.
            NewPassword = "short"
        });

        Assert.Equal(HttpStatusCode.BadRequest, reset.StatusCode);
    }
}