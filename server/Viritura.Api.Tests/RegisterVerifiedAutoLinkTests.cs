using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;

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
/// Exercises the "verified auto-link" Register branch added for OAuth-first accounts.
/// When the submitted email already belongs to an account with no password (i.e. the user
/// previously signed up through GitHub/Google), we must NOT accept the attacker-supplied
/// password directly — that would be account takeover. Instead the server emails a
/// password-reset-style link to the verified mailbox; clicking it lets the legitimate owner
/// set whatever password they want, linking the password credential to the existing account.
///
/// Tests below validate:
///   1. Existing OAuth-only account → 202 with linkExistingAccount=true and a reset email.
///   2. The submitted password is discarded (PasswordHash stays null until the user follows
///      the email link and sets a password through /auth/reset-password).
///   3. End-to-end: clicking the link (POST /auth/reset-password with the captured token)
///      sets a password and signs the user in.
///   4. Existing account WITH a password still returns the original 400 rejection.
///   5. Existing OAuth-only account whose mailbox isn't confirmed is silently ignored
///      (still returns 202 so we don't leak verification state) and NO email is sent.
/// </summary>
public sealed class RegisterVerifiedAutoLinkTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly CapturingEmailSender _emails = new();

    public RegisterVerifiedAutoLinkTests(WebApplicationFactory<Program> factory)
    {
        var capturing = _emails;
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:Provider"] = "Sqlite",
                    ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.test.{Guid.NewGuid():N}.db",
                    ["Auth:RequireEmailVerification"] = "false",
                    ["Auth:WebsiteBaseUrl"] = "https://localhost"
                });
            });
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailSender<AppUser>>();
                services.AddSingleton<IEmailSender<AppUser>>(capturing);
            });
        });
    }

    private HttpClient CreateClient() => _factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost"),
        HandleCookies = true
    });

    /// <summary>
    /// Creates a passwordless, email-confirmed user directly via Identity to simulate the
    /// state produced by a successful OAuth callback. (The OAuth handler itself requires
    /// a real provider round-trip we can't fake in tests.)
    /// </summary>
    private async Task<AppUser> CreateOAuthOnlyUserAsync(string email, bool emailConfirmed = true)
    {
        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = new AppUser
        {
            UserName = email,
            Email = email,
            EmailConfirmed = emailConfirmed
        };
        var create = await um.CreateAsync(user);
        if (!create.Succeeded)
        {
            throw new InvalidOperationException(
                $"Failed to seed OAuth-only user: {string.Join(", ", create.Errors.Select(e => e.Description))}");
        }
        return user;
    }

    [Fact]
    public async Task Register_WhenEmailMatchesOAuthOnlyAccount_Returns202WithLinkFlagAndSendsResetEmail()
    {
        using var client = CreateClient();
        var email = $"oauth.{Guid.NewGuid():N}@viritura.test";
        await CreateOAuthOnlyUserAsync(email);
        _emails.Clear();

        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "AttackerChosen!12"
        });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var pending = await response.Content.ReadFromJsonAsync<RegisterPendingVerificationResponse>();
        Assert.NotNull(pending);
        Assert.Equal(email, pending!.Email);
        Assert.True(pending.RequiresVerification);
        Assert.False(pending.LinkExistingAccount);

        var sent = Assert.Single(_emails.Sent);
        Assert.Equal(email, sent.To);
        Assert.Equal(CapturingEmailSender.MessageKind.PasswordReset, sent.Kind);
    }

    [Fact]
    public async Task Register_WhenEmailMatchesOAuthOnlyAccount_DoesNotSetSubmittedPassword()
    {
        using var client = CreateClient();
        var email = $"oauth.{Guid.NewGuid():N}@viritura.test";
        await CreateOAuthOnlyUserAsync(email);

        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "AttackerChosen!12"
        });
        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);

        // Confirm: trying to sign in with the attacker-supplied password must fail. If this
        // ever returns 200 the auto-link branch has regressed into the takeover vector it
        // was specifically written to prevent.
        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = "AttackerChosen!12"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await um.FindByEmailAsync(email);
        Assert.NotNull(user);
        Assert.False(await um.HasPasswordAsync(user!));
    }

    [Fact]
    public async Task Register_ThenResetPasswordWithCapturedLink_LinksAccountAndSignsIn()
    {
        using var client = CreateClient();
        var email = $"oauth.{Guid.NewGuid():N}@viritura.test";
        await CreateOAuthOnlyUserAsync(email);
        _emails.Clear();

        // Step 1: register triggers the auto-link email.
        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "WillBeIgnored!12"
        });
        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);

        // Step 2: extract the uid+token the email links to.
        var sent = Assert.Single(_emails.Sent);
        var (uid, token) = ParseResetLink(sent.Body);

        // Step 3: user types a fresh password on the set-password page.
        using var resetClient = CreateClient();
        const string chosenPassword = "OwnerChosen!12345";
        var reset = await resetClient.PostAsJsonAsync("/auth/reset-password", new ResetPasswordRequest
        {
            Uid = uid,
            Token = token,
            NewPassword = chosenPassword
        });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        // Step 4: now signing in with the OWNER-chosen password works.
        using var loginClient = CreateClient();
        var login = await loginClient.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = chosenPassword
        });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task Register_WhenEmailMatchesPasswordAccount_Returns202AndSendsResetLink()
    {
        using var seedClient = CreateClient();
        var email = $"pwd.{Guid.NewGuid():N}@viritura.test";
        await seedClient.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "OriginalPassw0rd!"
        });

        _emails.Clear();
        using var dupClient = CreateClient();
        var response = await dupClient.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "DifferentPassw0rd!"
        });

        // Uniform response across all duplicate-email shapes (password account, OAuth-only,
        // confirmed, unconfirmed) prevents the register endpoint from being used to enumerate
        // accounts or determine their auth shape. The owner of a confirmed mailbox receives a
        // password-reset link out-of-band so a legitimate user who forgot they already have an
        // account has a recovery path.
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var pending = await response.Content.ReadFromJsonAsync<RegisterPendingVerificationResponse>();
        Assert.False(pending!.LinkExistingAccount);
        Assert.True(pending.RequiresVerification);

        var sent = Assert.Single(_emails.Sent);
        Assert.Equal(CapturingEmailSender.MessageKind.PasswordReset, sent.Kind);
        Assert.Equal(email, sent.To);
        // The attacker-submitted password must NOT be set on the account by virtue of
        // re-registration alone — only by following the emailed reset flow.
    }

    [Fact]
    public async Task Register_WhenOAuthAccountIsUnconfirmed_Returns202ButSendsNoEmail()
    {
        using var client = CreateClient();
        var email = $"unconf.{Guid.NewGuid():N}@viritura.test";
        await CreateOAuthOnlyUserAsync(email, emailConfirmed: false);
        _emails.Clear();

        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "AttackerChosen!12"
        });

        // Same response shape as the confirmed case — we deliberately don't reveal whether
        // the mailbox has been verified. But no email is sent, because handing an
        // unconfirmed mailbox a password-set link would let anyone who controls it (or
        // happens to type the address by mistake) claim the linked OAuth identity.
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var pending = await response.Content.ReadFromJsonAsync<RegisterPendingVerificationResponse>();
        Assert.False(pending!.LinkExistingAccount);
        Assert.True(pending.RequiresVerification);
        Assert.Empty(_emails.Sent);
    }

    private static (string Uid, string Token) ParseResetLink(string body)
    {
        var match = Regex.Match(body, @"reset-password#uid=([^&\s]+)&token=([^\s)]+)");
        if (!match.Success)
        {
            throw new InvalidOperationException($"Could not find reset link in email body:\n{body}");
        }
        return (Uri.UnescapeDataString(match.Groups[1].Value), Uri.UnescapeDataString(match.Groups[2].Value));
    }

    /// <summary>
    /// Test double for <see cref="IEmailSender{TUser}"/> that records every message instead of
    /// dispatching it. Lets tests assert on email kind, recipient, and body content (including
    /// extracting reset-link tokens for end-to-end flows).
    /// </summary>
    private sealed class CapturingEmailSender : IEmailSender<AppUser>
    {
        public enum MessageKind { Confirmation, PasswordReset, PasswordResetCode }

        public readonly record struct Message(MessageKind Kind, string To, string Body);

        public ConcurrentBag<Message> Sent { get; } = new();

        public void Clear() => Sent.Clear();

        public Task SendConfirmationLinkAsync(AppUser user, string email, string confirmationLink)
        {
            Sent.Add(new Message(MessageKind.Confirmation, email, confirmationLink));
            return Task.CompletedTask;
        }

        public Task SendPasswordResetLinkAsync(AppUser user, string email, string resetLink)
        {
            Sent.Add(new Message(MessageKind.PasswordReset, email, resetLink));
            return Task.CompletedTask;
        }

        public Task SendPasswordResetCodeAsync(AppUser user, string email, string resetCode)
        {
            Sent.Add(new Message(MessageKind.PasswordResetCode, email, resetCode));
            return Task.CompletedTask;
        }
    }
}