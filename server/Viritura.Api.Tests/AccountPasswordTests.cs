using System.Net;
using System.Net.Http.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using Viritura.Api.Contracts.Auth;
using Viritura.Api.Controllers;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Exercises the password-management endpoints on <see cref="AccountController"/>:
/// change, set (for OAuth-only users), and remove. All endpoints require an
/// authenticated cookie session and a matching antiforgery token.
/// </summary>
public sealed class AccountPasswordTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AccountPasswordTests(WebApplicationFactory<Program> factory)
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

    private static async Task<(string UserId, string Email, string Password, string Csrf, string CsrfHeader)>
        RegisterAndSignInAsync(HttpClient client)
    {
        var email = $"pwd.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = password
        });
        register.EnsureSuccessStatusCode();
        var user = await register.Content.ReadFromJsonAsync<AuthUserResponse>();
        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        return (user!.Id, email, password, csrf!.Token, csrf.HeaderName);
    }

    private static HttpRequestMessage BuildAuthorizedPost(string url, object body, string csrf, string csrfHeader)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        msg.Headers.Add(csrfHeader, csrf);
        return msg;
    }

    private async Task<string> IssueRecentAuthCookieAsync(string userId, RecentAuthAction action)
    {
        using var scope = _factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var recentAuth = scope.ServiceProvider.GetRequiredService<RecentAuthService>();
        var user = await userManager.FindByIdAsync(userId) ?? throw new InvalidOperationException("User not found.");
        var context = new DefaultHttpContext();
        recentAuth.Issue(context.Response, user, action, "test-linked-provider");
        return (Assert.Single(context.Response.Headers.SetCookie)
            ?? throw new InvalidOperationException("Recent-auth cookie was not issued."))
            .Split(';', 2)[0];
    }

    // ---- /account/password (change) -------------------------------------------------

    [Fact]
    public async Task ChangePassword_Unauthenticated_ReturnsUnauthorized()
    {
        using var client = CreateClient();
        var response = await client.PostAsJsonAsync("/account/password",
            new AccountController.ChangePasswordRequest { CurrentPassword = "x", NewPassword = "GoodPassw0rd!12" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithoutCsrf_ReturnsBadRequest()
    {
        using var client = CreateClient();
        await RegisterAndSignInAsync(client);
        var response = await client.PostAsJsonAsync("/account/password",
            new AccountController.ChangePasswordRequest { CurrentPassword = "x", NewPassword = "GoodPassw0rd!12" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithWrongCurrent_ReturnsValidationProblem()
    {
        using var client = CreateClient();
        var (_, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        using var request = BuildAuthorizedPost("/account/password",
            new AccountController.ChangePasswordRequest { CurrentPassword = "WrongPassw0rd!12", NewPassword = "NewPassw0rd!12" },
            csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithWeakNew_ReturnsValidationProblem()
    {
        using var client = CreateClient();
        var (_, _, password, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        using var request = BuildAuthorizedPost("/account/password",
            new AccountController.ChangePasswordRequest { CurrentPassword = password, NewPassword = "short" },
            csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithGoodInputs_ReturnsNoContentAndUpdatesPassword()
    {
        using var client = CreateClient();
        var (uid, email, oldPwd, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        const string newPwd = "BrandNewPassw0rd!12";

        using var request = BuildAuthorizedPost("/account/password",
            new AccountController.ChangePasswordRequest { CurrentPassword = oldPwd, NewPassword = newPwd },
            csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // The new password authenticates.
        using var scope = _factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await userManager.FindByIdAsync(uid);
        Assert.True(await userManager.CheckPasswordAsync(user!, newPwd));
        Assert.False(await userManager.CheckPasswordAsync(user!, oldPwd));
        _ = email;
    }

    // ---- /account/password/set ------------------------------------------------------

    [Fact]
    public async Task SetPassword_WhenAlreadyHasPassword_ReturnsConflict()
    {
        using var client = CreateClient();
        var (_, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        using var request = BuildAuthorizedPost("/account/password/set",
            new AccountController.SetPasswordRequest { NewPassword = "NewPassw0rd!12" },
            csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task SetPassword_OnPasswordlessUser_RequiresRecentAuthentication()
    {
        using var client = CreateClient();
        var (uid, _, password, csrf, csrfHeader) = await RegisterAndSignInAsync(client);

        // Make the user passwordless: link a synthetic external login first (so they still have a way
        // to sign in), then remove the password directly via UserManager.
        using (var scope = _factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = await userManager.FindByIdAsync(uid);
            await userManager.AddLoginAsync(user!, new UserLoginInfo("GitHub", "external-" + uid, "GitHub"));
            await userManager.RemovePasswordAsync(user!);
        }

        // Refresh CSRF (cookie may have rotated; in this WAF scenario it hasn't, but be safe).
        var refreshedCsrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        using var request = BuildAuthorizedPost("/account/password/set",
            new AccountController.SetPasswordRequest { NewPassword = "FreshPassw0rd!12" },
            refreshedCsrf!.Token, refreshedCsrf.HeaderName);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        using var scope2 = _factory.Services.CreateScope();
        var um = scope2.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var u = await um.FindByIdAsync(uid);
        Assert.False(await um.HasPasswordAsync(u!));
        _ = password;
    }

    [Fact]
    public async Task SetPassword_OnPasswordlessUser_WithRecentProviderProof_Succeeds()
    {
        using var client = CreateClient();
        var (uid, _, _, _, _) = await RegisterAndSignInAsync(client);

        using (var scope = _factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = await userManager.FindByIdAsync(uid);
            await userManager.AddLoginAsync(user!, new UserLoginInfo("GitHub", "external-" + uid, "GitHub"));
            await userManager.RemovePasswordAsync(user!);
        }

        var csrf = await client.GetFromJsonAsync<CsrfResponse>("/auth/csrf");
        var recentCookie = await IssueRecentAuthCookieAsync(uid, RecentAuthAction.SetPassword);
        using var request = BuildAuthorizedPost(
            "/account/password/set",
            new AccountController.SetPasswordRequest { NewPassword = "FreshPassw0rd!12" },
            csrf!.Token,
            csrf.HeaderName);
        request.Headers.TryAddWithoutValidation("Cookie", recentCookie);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        using var verifyScope = _factory.Services.CreateScope();
        var um = verifyScope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var u = await um.FindByIdAsync(uid);
        Assert.True(await um.HasPasswordAsync(u!));
        Assert.True(await um.CheckPasswordAsync(u!, "FreshPassw0rd!12"));
    }

    // ---- /account/password/remove ---------------------------------------------------

    [Fact]
    public async Task RemovePassword_WhenOnlyCredential_ReturnsConflict()
    {
        using var client = CreateClient();
        var (_, _, password, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        using var request = BuildAuthorizedPost("/account/password/remove",
            new AccountController.RemovePasswordRequest { CurrentPassword = password },
            csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task RemovePassword_WithLinkedProvider_ReturnsNoContent()
    {
        using var client = CreateClient();
        var (uid, _, password, csrf, csrfHeader) = await RegisterAndSignInAsync(client);

        // Link an external provider so removing the password isn't a lockout.
        using (var scope = _factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = await userManager.FindByIdAsync(uid);
            await userManager.AddLoginAsync(user!, new UserLoginInfo("GitHub", "external-" + uid, "GitHub"));
        }

        using var request = BuildAuthorizedPost("/account/password/remove",
            new AccountController.RemovePasswordRequest { CurrentPassword = password },
            csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        using var scope2 = _factory.Services.CreateScope();
        var um = scope2.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var u = await um.FindByIdAsync(uid);
        Assert.False(await um.HasPasswordAsync(u!));
    }

    [Fact]
    public async Task RemovePassword_WithWrongCurrent_ReturnsValidationProblem()
    {
        using var client = CreateClient();
        var (uid, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);

        using (var scope = _factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = await userManager.FindByIdAsync(uid);
            await userManager.AddLoginAsync(user!, new UserLoginInfo("GitHub", "external-" + uid, "GitHub"));
        }

        using var request = BuildAuthorizedPost("/account/password/remove",
            new AccountController.RemovePasswordRequest { CurrentPassword = "WrongPassw0rd!12" },
            csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}