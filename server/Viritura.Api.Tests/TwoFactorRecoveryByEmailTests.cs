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
using Viritura.Infrastructure.Email;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Covers the "lost authenticator AND lost recovery codes" recovery flow:
///   POST /auth/login/2fa-recover (anonymous, requires 2FA-partial cookie) → emails link
///   POST /auth/2fa/disable-by-recovery-token (anonymous) → disables 2FA + signs user in.
///
/// We use a capturing email sender to extract the link, the real Identity stack against an
/// isolated SQLite DB, and the production-equivalent cookie config so the partial cookie
/// flow matches what the browser sees.
/// </summary>
public sealed class TwoFactorRecoveryByEmailTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly CapturingEmailSender _emails = new();

    public TwoFactorRecoveryByEmailTests(WebApplicationFactory<Program> factory)
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
                services.RemoveAll<IVirituraEmailSender>();
                services.AddSingleton<IEmailSender<AppUser>>(capturing);
                services.AddSingleton<IVirituraEmailSender>(capturing);
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
    /// Provisions a user with TOTP enabled (no need to know the actual TOTP — these tests never
    /// take the happy 2FA-completion path; they exercise the recovery branch instead).
    /// </summary>
    private async Task<string> SeedUserWithTwoFactorAsync(string email, string password, bool confirmEmail = true) =>
        await SeedUserWithTwoFactorAsync(_factory, email, password, confirmEmail);

    private static async Task<string> SeedUserWithTwoFactorAsync(
        WebApplicationFactory<Program> factory, string email, string password, bool confirmEmail = true)
    {
        using var scope = factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = new AppUser { UserName = email, Email = email, EmailConfirmed = confirmEmail };
        var create = await um.CreateAsync(user, password);
        if (!create.Succeeded)
        {
            throw new InvalidOperationException(string.Join(", ", create.Errors.Select(e => e.Description)));
        }
        await um.ResetAuthenticatorKeyAsync(user);
        var enable = await um.SetTwoFactorEnabledAsync(user, true);
        if (!enable.Succeeded)
        {
            throw new InvalidOperationException(string.Join(", ", enable.Errors.Select(e => e.Description)));
        }
        return user.Id;
    }

    /// <summary>
    /// Drives the password step so the client receives the 2FA-partial cookie. Returns the
    /// HttpClient holding that cookie.
    /// </summary>
    private async Task<HttpClient> SignInToPartialTwoFactorStateAsync(string email, string password)
    {
        var client = CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = password
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<LoginResponse>();
        if (body?.RequiresTwoFactor != true)
        {
            throw new InvalidOperationException("Expected /auth/login to return RequiresTwoFactor=true.");
        }
        return client;
    }

    [Fact]
    public async Task Recover_WithPartialCookieAndConfirmedEmail_SendsRecoveryEmail()
    {
        var email = $"recov.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        await SeedUserWithTwoFactorAsync(email, password);
        _emails.Clear();

        using var client = await SignInToPartialTwoFactorStateAsync(email, password);
        var response = await client.PostAsync("/auth/login/2fa-recover", content: null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var sent = Assert.Single(_emails.Sent);
        Assert.Equal(email, sent.To);
        Assert.Equal(CapturingEmailSender.MessageKind.TwoFactorRecovery, sent.Kind);
        Assert.Contains("/auth/2fa-recovery#uid=", sent.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Recover_WithoutPartialCookie_Returns204AndSendsNoEmail()
    {
        // Anonymous client — no partial cookie present at all. We still return 204 (don't reveal
        // whether the endpoint did anything) but obviously can't identify a user, so no email
        // can be sent.
        using var anonymous = CreateClient();
        _emails.Clear();

        var response = await anonymous.PostAsync("/auth/login/2fa-recover", content: null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(_emails.Sent);
    }

    [Fact]
    public async Task Recover_WithUnconfirmedEmail_Returns204AndSendsNoEmail()
    {
        var email = $"recov.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        await SeedUserWithTwoFactorAsync(email, password, confirmEmail: false);

        // Need the partial cookie. With RequireEmailVerification=false the user can still sign
        // in (SignInManager doesn't reject), so we can get to the partial-2FA state. The
        // recovery endpoint then checks EmailConfirmed itself.
        using var client = await SignInToPartialTwoFactorStateAsync(email, password);
        _emails.Clear();

        var response = await client.PostAsync("/auth/login/2fa-recover", content: null);

        // Same 204 response (no leak of mailbox-verification state) but no email — we never hand
        // a recovery link to an unverified mailbox because that defeats the whole point of using
        // email as the second-factor backup.
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(_emails.Sent);
    }

    [Fact]
    public async Task DisableByRecoveryToken_WithValidToken_DisablesTwoFactorAndSignsIn()
    {
        var email = $"recov.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        var uid = await SeedUserWithTwoFactorAsync(email, password);

        using var partialClient = await SignInToPartialTwoFactorStateAsync(email, password);
        _emails.Clear();
        var requestResp = await partialClient.PostAsync("/auth/login/2fa-recover", content: null);
        Assert.Equal(HttpStatusCode.NoContent, requestResp.StatusCode);
        var sent = Assert.Single(_emails.Sent);
        var (linkUid, token) = ParseRecoveryLink(sent.Body);
        Assert.Equal(uid, linkUid);

        // Fresh client (link clicked from email, possibly a different browser).
        using var disableClient = CreateClient();
        var disable = await disableClient.PostAsJsonAsync(
            "/auth/2fa/disable-by-recovery-token",
            new TwoFactorRecoveryDisableRequest { Uid = uid, Token = token });
        Assert.Equal(HttpStatusCode.OK, disable.StatusCode);

        // The success response sets the full auth cookie; /auth/me should now report authenticated.
        var me = await disableClient.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.True(me!.Authenticated);
        Assert.Equal(email, me.User!.Email);

        // 2FA must be off and the authenticator key must have been rolled — the old shared
        // secret on the user's lost device is now useless even if they find it later. (Identity's
        // ResetAuthenticatorKeyAsync rotates to a new key rather than nulling it; the key only
        // becomes "active" again after an explicit re-pair from Account settings, since 2FA
        // itself is now off.)
        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await um.FindByIdAsync(uid);
        Assert.NotNull(user);
        Assert.False(await um.GetTwoFactorEnabledAsync(user!));
        var newKey = await um.GetAuthenticatorKeyAsync(user!);
        Assert.False(string.IsNullOrEmpty(newKey));
    }

    [Fact]
    public async Task DisableByRecoveryToken_WithInvalidToken_Returns400AndLeavesTwoFactorOn()
    {
        var email = $"recov.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        var uid = await SeedUserWithTwoFactorAsync(email, password);

        using var client = CreateClient();
        var response = await client.PostAsJsonAsync(
            "/auth/2fa/disable-by-recovery-token",
            new TwoFactorRecoveryDisableRequest { Uid = uid, Token = "not-a-real-token" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await um.FindByIdAsync(uid);
        Assert.True(await um.GetTwoFactorEnabledAsync(user!));
    }

    [Fact]
    public async Task DisableByRecoveryToken_TokenIsSingleUse_SecondAttemptRejected()
    {
        var email = $"recov.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        var uid = await SeedUserWithTwoFactorAsync(email, password);

        using var partialClient = await SignInToPartialTwoFactorStateAsync(email, password);
        _emails.Clear();
        await partialClient.PostAsync("/auth/login/2fa-recover", content: null);
        var sent = Assert.Single(_emails.Sent);
        var (_, token) = ParseRecoveryLink(sent.Body);

        // First use succeeds (and disables 2FA, rolling the security stamp).
        using var first = CreateClient();
        var firstResp = await first.PostAsJsonAsync(
            "/auth/2fa/disable-by-recovery-token",
            new TwoFactorRecoveryDisableRequest { Uid = uid, Token = token });
        Assert.Equal(HttpStatusCode.OK, firstResp.StatusCode);

        // Second use must be rejected — DataProtectorTokenProvider tokens are invalidated when
        // the security stamp rolls (ResetAuthenticatorKeyAsync + SetTwoFactorEnabledAsync both
        // roll it). This is the only thing standing between us and replay attacks if the link
        // ever leaks (e.g. mailbox shared with a partner who later turns hostile).
        using var second = CreateClient();
        var secondResp = await second.PostAsJsonAsync(
            "/auth/2fa/disable-by-recovery-token",
            new TwoFactorRecoveryDisableRequest { Uid = uid, Token = token });
        Assert.Equal(HttpStatusCode.BadRequest, secondResp.StatusCode);
    }

    [Fact]
    public async Task DisableByRecoveryToken_WithUnknownUid_Returns400()
    {
        using var client = CreateClient();
        var response = await client.PostAsJsonAsync(
            "/auth/2fa/disable-by-recovery-token",
            new TwoFactorRecoveryDisableRequest { Uid = Guid.NewGuid().ToString(), Token = "anything" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static (string Uid, string Token) ParseRecoveryLink(string body)
    {
        var match = Regex.Match(body, @"2fa-recovery#uid=([^&\s]+)&token=([^\s)]+)");
        if (!match.Success)
        {
            throw new InvalidOperationException($"Could not find recovery link in email body:\n{body}");
        }
        return (Uri.UnescapeDataString(match.Groups[1].Value), Uri.UnescapeDataString(match.Groups[2].Value));
    }

    // ── Throttle tests ───────────────────────────────────────────────────────────────────────
    //
    // Each test that exercises the per-recipient quota creates a derived factory that replaces the
    // singleton throttle with a fresh instance configured to a low limit (e.g. 2 per hour). This
    // isolation prevents state from the class-level factory leaking across tests.

    /// <summary>
    /// Creates a derived factory whose <see cref="TwoFactorRecoveryEmailThrottle"/> has the given
    /// quota. The capturing email sender is also replaced so each throttle test has independent
    /// capture state.
    /// </summary>
    private (WebApplicationFactory<Program> Factory, CapturingEmailSender Emails) CreateThrottledFactory(
        int permitsPerHour)
    {
        var emails = new CapturingEmailSender();
        var factory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<TwoFactorRecoveryEmailThrottle>();
                services.AddSingleton(new TwoFactorRecoveryEmailThrottle(permitsPerHour));
                services.RemoveAll<IEmailSender<AppUser>>();
                services.RemoveAll<IVirituraEmailSender>();
                services.AddSingleton<IEmailSender<AppUser>>(emails);
                services.AddSingleton<IVirituraEmailSender>(emails);
            });
        });
        return (factory, emails);
    }

    private static HttpClient CreateClientFor(WebApplicationFactory<Program> factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost"),
            HandleCookies = true
        });

    private static async Task<HttpClient> SignInToPartialStateAsync(
        HttpClient client, string email, string password)
    {
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = password
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<LoginResponse>();
        if (body?.RequiresTwoFactor != true)
        {
            throw new InvalidOperationException("Expected /auth/login to return RequiresTwoFactor=true.");
        }
        return client;
    }

    [Fact]
    public async Task Recover_Throttle_RepeatedRequests_SuppressesEmailAfterQuota()
    {
        // Quota is 2 per hour. Calls 1 and 2 must produce emails; call 3 must be silently
        // suppressed. All three responses must be 204 (quota exhaustion is not observable from
        // the response).
        var (factory, emails) = CreateThrottledFactory(permitsPerHour: 2);
        var email = $"thr.rep.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        await SeedUserWithTwoFactorAsync(factory, email, password);

        using var client = await SignInToPartialStateAsync(CreateClientFor(factory), email, password);

        for (var i = 1; i <= 3; i++)
        {
            using var resp = await client.PostAsync("/auth/login/2fa-recover", content: null);
            Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        }

        // The 2FA-partial cookie is re-read on every call, so all three see the same user.
        Assert.Equal(2, emails.Sent.Count);
        Assert.All(emails.Sent, m => Assert.Equal(CapturingEmailSender.MessageKind.TwoFactorRecovery, m.Kind));
    }

    [Fact]
    public async Task Recover_Throttle_DistinctRecipients_HaveIndependentQuotas()
    {
        // Quota is 1. Each user gets their own bucket; the first user hitting the limit does not
        // block the second user.
        var (factory, emails) = CreateThrottledFactory(permitsPerHour: 1);
        var emailA = $"thr.a.{Guid.NewGuid():N}@viritura.test";
        var emailB = $"thr.b.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        await SeedUserWithTwoFactorAsync(factory, emailA, password);
        await SeedUserWithTwoFactorAsync(factory, emailB, password);

        using var clientA = await SignInToPartialStateAsync(CreateClientFor(factory), emailA, password);
        using var clientB = await SignInToPartialStateAsync(CreateClientFor(factory), emailB, password);

        // User A — first call succeeds, second is throttled.
        using var a1 = await clientA.PostAsync("/auth/login/2fa-recover", content: null);
        Assert.Equal(HttpStatusCode.NoContent, a1.StatusCode);
        using var a2 = await clientA.PostAsync("/auth/login/2fa-recover", content: null);
        Assert.Equal(HttpStatusCode.NoContent, a2.StatusCode);

        // User B — still has a fresh quota.
        using var b1 = await clientB.PostAsync("/auth/login/2fa-recover", content: null);
        Assert.Equal(HttpStatusCode.NoContent, b1.StatusCode);

        // A's quota was 1, B's was 1 → total emails sent = 2.
        Assert.Equal(2, emails.Sent.Count);
        Assert.Single(emails.Sent, m => m.To == emailA);
        Assert.Single(emails.Sent, m => m.To == emailB);
    }

    [Fact]
    public void Recover_Throttle_Normalization_DifferentCaseSharesQuota()
    {
        // The throttle must normalise to uppercase so that mixed-case variants of the same
        // address don't each get their own bucket, preventing quota bypassing via casing tricks.
        using var throttle = new TwoFactorRecoveryEmailThrottle(permitsPerHour: 1);
        Assert.True(throttle.TryAcquire("User@Example.com"));
        Assert.False(throttle.TryAcquire("user@example.com"));  // same normalised key
        Assert.False(throttle.TryAcquire("USER@EXAMPLE.COM")); // same normalised key
    }

    [Fact]
    public async Task Recover_Throttle_ResponseShape_IsAlways204()
    {
        // Even after quota is exhausted the response must be 204 — not 429 — to avoid leaking
        // quota state to an attacker who doesn't know which victim email they're targeting.
        var (factory, emails) = CreateThrottledFactory(permitsPerHour: 1);
        var email = $"thr.shape.{Guid.NewGuid():N}@viritura.test";
        const string password = "GoodPassw0rd!12";
        await SeedUserWithTwoFactorAsync(factory, email, password);

        using var client = await SignInToPartialStateAsync(CreateClientFor(factory), email, password);

        using var r1 = await client.PostAsync("/auth/login/2fa-recover", content: null);
        Assert.Equal(HttpStatusCode.NoContent, r1.StatusCode); // within quota

        using var r2 = await client.PostAsync("/auth/login/2fa-recover", content: null);
        Assert.Equal(HttpStatusCode.NoContent, r2.StatusCode); // quota exhausted — still 204

        Assert.Single(emails.Sent); // only first call triggered a send
    }

    private sealed class CapturingEmailSender : IEmailSender<AppUser>, IVirituraEmailSender
    {
        public enum MessageKind { Confirmation, PasswordReset, PasswordResetCode, TwoFactorRecovery, EmailChange, EmailChangeNotification }

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

        public Task SendTwoFactorRecoveryLinkAsync(AppUser user, string email, string recoveryLink)
        {
            Sent.Add(new Message(MessageKind.TwoFactorRecovery, email, recoveryLink));
            return Task.CompletedTask;
        }

        public Task SendEmailChangeLinkAsync(AppUser user, string newEmail, string confirmationLink)
        {
            Sent.Add(new Message(MessageKind.EmailChange, newEmail, confirmationLink));
            return Task.CompletedTask;
        }

        public Task SendEmailChangeNotificationAsync(AppUser user, string oldEmail, string newEmail)
        {
            Sent.Add(new Message(MessageKind.EmailChangeNotification, oldEmail, newEmail));
            return Task.CompletedTask;
        }

        // Security-event notifications: tests in this fixture don't assert on these channels
        // (they exist to keep the build green now that IVirituraEmailSender carries them); the
        // dedicated coverage lives in AccountControllerTests / TwoFactorTests where the action
        // surface is.
        public Task SendExternalLoginAddedNotificationAsync(AppUser user, string email, string provider) => Task.CompletedTask;
        public Task SendExternalLoginRemovedNotificationAsync(AppUser user, string email, string provider) => Task.CompletedTask;
        public Task SendPasswordSetNotificationAsync(AppUser user, string email) => Task.CompletedTask;
        public Task SendPasswordChangedNotificationAsync(AppUser user, string email) => Task.CompletedTask;
        public Task SendPasswordRemovedNotificationAsync(AppUser user, string email) => Task.CompletedTask;
        public Task SendTwoFactorEnabledNotificationAsync(AppUser user, string email) => Task.CompletedTask;
        public Task SendTwoFactorDisabledNotificationAsync(AppUser user, string email) => Task.CompletedTask;
        public Task SendRecoveryCodesRegeneratedNotificationAsync(AppUser user, string email) => Task.CompletedTask;
    }
}