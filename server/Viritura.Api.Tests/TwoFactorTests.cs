using System.Buffers.Binary;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;

using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using Viritura.Api.Contracts.Auth;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Exercises the authenticator-based two-factor flow:
///  * /2fa/* management endpoints on <see cref="Viritura.Api.Controllers.TwoFactorController"/>
///  * The 2FA-aware login pipeline on <see cref="Viritura.Api.Controllers.AuthController"/>
///    (<c>/auth/login</c> returning <c>requiresTwoFactor</c>, then <c>/auth/login/2fa</c> or
///    <c>/auth/login/recovery</c>).
///
/// We use the real Identity stack against an isolated SQLite DB. Valid TOTP codes are minted via
/// <c>UserManager.GenerateTwoFactorTokenAsync</c> with the configured authenticator provider —
/// this uses the same secret + RFC 6238 algorithm the validator does, so the code is always
/// accepted by the live verifier.
/// </summary>
public sealed class TwoFactorTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public TwoFactorTests(WebApplicationFactory<Program> factory)
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
        var email = $"twofa.{Guid.NewGuid():N}@viritura.test";
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

    private static HttpRequestMessage BuildAuthorizedPost(string url, object? body, string csrf, string csrfHeader)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, url);
        if (body is not null) msg.Content = JsonContent.Create(body);
        msg.Headers.Add(csrfHeader, csrf);
        return msg;
    }

    private static async Task GrantRecentAuthAsync(
        HttpClient client,
        string action,
        string password,
        string csrf,
        string csrfHeader,
        string? code = null)
    {
        using var request = BuildAuthorizedPost(
            "/auth/recent/password",
            new RecentAuthPasswordRequest { Action = action, Password = password, Code = code },
            csrf,
            csrfHeader);
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Provisions an authenticator key on <paramref name="uid"/> via the live
    /// <see cref="UserManager{TUser}"/> and returns a currently-valid TOTP for that key.
    /// (We compute the code ourselves because Identity's default
    /// <c>AuthenticatorTokenProvider.GenerateAsync</c> returns an empty string — the provider
    /// only implements validate, on the assumption the client computes its own TOTP.)
    /// </summary>
    private async Task<string> ProvisionAuthenticatorAsync(string uid)
    {
        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await um.FindByIdAsync(uid)
            ?? throw new InvalidOperationException("User not found.");

        await um.ResetAuthenticatorKeyAsync(user);
        var secret = await um.GetAuthenticatorKeyAsync(user)
            ?? throw new InvalidOperationException("Authenticator key not provisioned.");
        return CurrentTotp(secret);
    }

    /// <summary>Returns the current TOTP for an already-provisioned user.</summary>
    private async Task<string> CurrentTotpForAsync(string uid)
    {
        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await um.FindByIdAsync(uid)
            ?? throw new InvalidOperationException("User not found.");
        var secret = await um.GetAuthenticatorKeyAsync(user)
            ?? throw new InvalidOperationException("User has no authenticator key.");
        return CurrentTotp(secret);
    }

    /// <summary>RFC 6238 TOTP for the current 30-second window over the given base32 secret.</summary>
    private static string CurrentTotp(string base32Secret)
    {
        var unix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var key = FromBase32(base32Secret);
        var counter = unix / 30;
        Span<byte> counterBytes = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(counterBytes, counter);
        using var hmac = new HMACSHA1(key);
        var hash = hmac.ComputeHash(counterBytes.ToArray());
        var offset = hash[^1] & 0xF;
        var binCode = ((hash[offset] & 0x7F) << 24)
            | ((hash[offset + 1] & 0xFF) << 16)
            | ((hash[offset + 2] & 0xFF) << 8)
            | (hash[offset + 3] & 0xFF);
        return (binCode % 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
    }

    private static byte[] FromBase32(string input)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        input = input.TrimEnd('=').ToUpperInvariant();
        var output = new List<byte>(input.Length * 5 / 8);
        int bits = 0, value = 0;
        foreach (var c in input)
        {
            var idx = alphabet.IndexOf(c, StringComparison.Ordinal);
            if (idx < 0) continue;
            value = (value << 5) | idx;
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)((value >> (bits - 8)) & 0xFF));
                bits -= 8;
            }
        }
        return output.ToArray();
    }

    // ---- /2fa/status ---------------------------------------------------------------

    [Fact]
    public async Task Status_DefaultUser_ReturnsDisabledWithZeroCodes()
    {
        using var client = CreateClient();
        await RegisterAndSignInAsync(client);

        var status = await client.GetFromJsonAsync<TwoFactorStatusResponse>("/2fa/status");
        Assert.NotNull(status);
        Assert.False(status!.Enabled);
        Assert.Equal(0, status.RemainingRecoveryCodes);
    }

    [Fact]
    public async Task Status_Unauthenticated_ReturnsUnauthorized()
    {
        using var client = CreateClient();
        var response = await client.GetAsync("/2fa/status");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- /2fa/setup ----------------------------------------------------------------

    [Fact]
    public async Task Setup_ReturnsSecretAndOtpAuthUri()
    {
        using var client = CreateClient();
        var (uid, email, password, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        await GrantRecentAuthAsync(client, "ManageTwoFactor", password, csrf, csrfHeader);

        using var request = BuildAuthorizedPost("/2fa/setup", body: null, csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var setup = await response.Content.ReadFromJsonAsync<TwoFactorSetupResponse>();

        Assert.NotNull(setup);
        Assert.False(string.IsNullOrWhiteSpace(setup!.Secret));
        Assert.StartsWith("otpauth://totp/", setup.OtpAuthUri, StringComparison.Ordinal);
        // Label encoding is encoder-specific (e.g. `.` may or may not be escaped). Just assert
        // that the recognizable user identifier (the hex GUID prefix) survives into the URI.
        var emailPrefix = email.Split('@')[0];
        Assert.Contains(emailPrefix, setup.OtpAuthUri, StringComparison.Ordinal);
        Assert.Contains("secret=" + setup.Secret, setup.OtpAuthUri, StringComparison.Ordinal);
        Assert.Contains("issuer=Viritura", setup.OtpAuthUri, StringComparison.Ordinal);

        await using var scope = _factory.Services.CreateAsyncScope();
        var database = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        var connection = database.Database.GetDbConnection();
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Value FROM AspNetUserTokens WHERE UserId = $userId AND Name = 'AuthenticatorKey'";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "$userId";
        parameter.Value = uid;
        command.Parameters.Add(parameter);
        var storedValue = Assert.IsType<string>(await command.ExecuteScalarAsync());
        Assert.StartsWith("dp:v1:", storedValue, StringComparison.Ordinal);
        Assert.DoesNotContain(setup.Secret, storedValue, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Setup_WithoutCsrf_ReturnsBadRequest()
    {
        using var client = CreateClient();
        await RegisterAndSignInAsync(client);
        var response = await client.PostAsync("/2fa/setup", content: null);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Setup_WhenTwoFactorIsEnabled_ReturnsConflictWithoutDisclosingSecret()
    {
        using var client = CreateClient();
        var (uid, _, password, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        var enableCode = await ProvisionAuthenticatorAsync(uid);
        using (var enableRequest = BuildAuthorizedPost(
            "/2fa/enable",
            new TwoFactorCodeRequest { Code = enableCode },
            csrf,
            csrfHeader))
        {
            (await client.SendAsync(enableRequest)).EnsureSuccessStatusCode();
        }

        using var scope = _factory.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await userManager.FindByIdAsync(uid);
        var activeSecret = await userManager.GetAuthenticatorKeyAsync(user!);
        Assert.False(string.IsNullOrWhiteSpace(activeSecret));
        await GrantRecentAuthAsync(
            client,
            "ManageTwoFactor",
            password,
            csrf,
            csrfHeader,
            await CurrentTotpForAsync(uid));

        using var setupRequest = BuildAuthorizedPost("/2fa/setup", body: null, csrf, csrfHeader);
        var response = await client.SendAsync(setupRequest);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.DoesNotContain(activeSecret!, body, StringComparison.Ordinal);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task Setup_ReturnsNoStoreForSecretMaterial()
    {
        using var client = CreateClient();
        var (_, _, password, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        await GrantRecentAuthAsync(client, "ManageTwoFactor", password, csrf, csrfHeader);

        using var request = BuildAuthorizedPost("/2fa/setup", body: null, csrf, csrfHeader);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    // ---- /2fa/enable ---------------------------------------------------------------

    [Fact]
    public async Task Enable_WithValidCode_ReturnsRecoveryCodesAndFlipsEnabled()
    {
        using var client = CreateClient();
        var (uid, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);

        var code = await ProvisionAuthenticatorAsync(uid);
        using var request = BuildAuthorizedPost("/2fa/enable",
            new TwoFactorCodeRequest { Code = code }, csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<TwoFactorRecoveryCodesResponse>();
        Assert.NotNull(payload);
        Assert.Equal(10, payload!.RecoveryCodes.Count);
        Assert.True(response.Headers.CacheControl?.NoStore);

        // Server-side state matches.
        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await um.FindByIdAsync(uid);
        Assert.True(await um.GetTwoFactorEnabledAsync(user!));
        Assert.Equal(10, await um.CountRecoveryCodesAsync(user!));
    }

    [Fact]
    public async Task Enable_WithBadCode_ReturnsValidationProblem()
    {
        using var client = CreateClient();
        var (uid, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);

        // Provision the key but submit a wrong code.
        await ProvisionAuthenticatorAsync(uid);
        using var request = BuildAuthorizedPost("/2fa/enable",
            new TwoFactorCodeRequest { Code = "000000" }, csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await um.FindByIdAsync(uid);
        Assert.False(await um.GetTwoFactorEnabledAsync(user!));
    }

    // ---- /2fa/disable --------------------------------------------------------------

    [Fact]
    public async Task Disable_WhenNotEnabled_ReturnsConflict()
    {
        using var client = CreateClient();
        var (_, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        using var request = BuildAuthorizedPost("/2fa/disable",
            new TwoFactorCodeRequest { Code = "123456" }, csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Disable_WithValidCode_ReturnsNoContentAndResets()
    {
        using var client = CreateClient();
        var (uid, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);

        // Bring 2FA up first.
        var enableCode = await ProvisionAuthenticatorAsync(uid);
        using (var req = BuildAuthorizedPost("/2fa/enable",
            new TwoFactorCodeRequest { Code = enableCode }, csrf, csrfHeader))
        {
            (await client.SendAsync(req)).EnsureSuccessStatusCode();
        }

        // Mint a fresh code (the previous one was for the same secret and is still currently
        // valid, but in production a user re-types a current TOTP — match that pattern).
        var disableCode = await CurrentTotpForAsync(uid);

        using var disableReq = BuildAuthorizedPost("/2fa/disable",
            new TwoFactorCodeRequest { Code = disableCode }, csrf, csrfHeader);
        var disableResp = await client.SendAsync(disableReq);
        Assert.Equal(HttpStatusCode.NoContent, disableResp.StatusCode);

        using var scope2 = _factory.Services.CreateScope();
        var um2 = scope2.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var u = await um2.FindByIdAsync(uid);
        Assert.False(await um2.GetTwoFactorEnabledAsync(u!));
    }

    // ---- /2fa/recovery/regenerate --------------------------------------------------

    [Fact]
    public async Task RegenerateRecoveryCodes_WhenEnabled_ReturnsTenFreshCodes()
    {
        using var client = CreateClient();
        var (uid, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        var enableCode = await ProvisionAuthenticatorAsync(uid);
        using (var req = BuildAuthorizedPost("/2fa/enable",
            new TwoFactorCodeRequest { Code = enableCode }, csrf, csrfHeader))
        {
            (await client.SendAsync(req)).EnsureSuccessStatusCode();
        }

        var regenerateCode = await CurrentTotpForAsync(uid);
        using var request = BuildAuthorizedPost("/2fa/recovery/regenerate",
            new TwoFactorCodeRequest { Code = regenerateCode }, csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<TwoFactorRecoveryCodesResponse>();
        Assert.NotNull(payload);
        Assert.Equal(10, payload!.RecoveryCodes.Count);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task RegenerateRecoveryCodes_WhenCodeInvalid_ReturnsValidationError()
    {
        using var client = CreateClient();
        var (uid, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        var enableCode = await ProvisionAuthenticatorAsync(uid);
        using (var req = BuildAuthorizedPost("/2fa/enable",
            new TwoFactorCodeRequest { Code = enableCode }, csrf, csrfHeader))
        {
            (await client.SendAsync(req)).EnsureSuccessStatusCode();
        }

        // Wrong-but-syntactically-valid code: gate must reject.
        using var request = BuildAuthorizedPost("/2fa/recovery/regenerate",
            new TwoFactorCodeRequest { Code = "000000" }, csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RegenerateRecoveryCodes_WhenDisabled_ReturnsConflict()
    {
        using var client = CreateClient();
        var (_, _, _, csrf, csrfHeader) = await RegisterAndSignInAsync(client);
        using var request = BuildAuthorizedPost("/2fa/recovery/regenerate",
            new TwoFactorCodeRequest { Code = "000000" }, csrf, csrfHeader);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    // ---- Login flow ----------------------------------------------------------------

    [Fact]
    public async Task Login_WhenTwoFactorEnabled_ReturnsRequiresTwoFactorThenAuthenticatorCompletes()
    {
        // Bring up a 2FA-enabled user from one client...
        using var setupClient = CreateClient();
        var (uid, email, password, csrf, csrfHeader) = await RegisterAndSignInAsync(setupClient);
        var enableCode = await ProvisionAuthenticatorAsync(uid);
        using (var req = BuildAuthorizedPost("/2fa/enable",
            new TwoFactorCodeRequest { Code = enableCode }, csrf, csrfHeader))
        {
            (await setupClient.SendAsync(req)).EnsureSuccessStatusCode();
        }

        // ...then start a fresh session on a new client and sign in.
        using var client = CreateClient();
        var loginResp = await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = password,
            RememberMe = true
        });
        Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);
        var login = await loginResp.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(login);
        Assert.True(login!.RequiresTwoFactor);
        Assert.Null(login.User);

        // Complete the second step.
        var code = await CurrentTotpForAsync(uid);

        var twoResp = await client.PostAsJsonAsync("/auth/login/2fa", new TwoFactorLoginRequest
        {
            Code = code,
            RememberClient = false
        });
        Assert.Equal(HttpStatusCode.OK, twoResp.StatusCode);
        var me = await client.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.NotNull(me);
        Assert.True(me!.Authenticated);
        Assert.Equal(email, me.User!.Email);
    }

    [Fact]
    public async Task LoginTwoFactor_WithWrongCode_ReturnsUnauthorized()
    {
        using var setupClient = CreateClient();
        var (uid, email, password, csrf, csrfHeader) = await RegisterAndSignInAsync(setupClient);
        var enableCode = await ProvisionAuthenticatorAsync(uid);
        using (var req = BuildAuthorizedPost("/2fa/enable",
            new TwoFactorCodeRequest { Code = enableCode }, csrf, csrfHeader))
        {
            (await setupClient.SendAsync(req)).EnsureSuccessStatusCode();
        }

        using var client = CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = password,
            RememberMe = true
        })).EnsureSuccessStatusCode();

        var twoResp = await client.PostAsJsonAsync("/auth/login/2fa", new TwoFactorLoginRequest
        {
            Code = "000000",
            RememberClient = false
        });
        Assert.Equal(HttpStatusCode.Unauthorized, twoResp.StatusCode);
    }

    [Fact]
    public async Task LoginRecovery_WithValidCode_CompletesSignIn()
    {
        using var setupClient = CreateClient();
        var (uid, email, password, csrf, csrfHeader) = await RegisterAndSignInAsync(setupClient);
        var enableCode = await ProvisionAuthenticatorAsync(uid);

        TwoFactorRecoveryCodesResponse? recoveryCodes;
        using (var req = BuildAuthorizedPost("/2fa/enable",
            new TwoFactorCodeRequest { Code = enableCode }, csrf, csrfHeader))
        {
            var resp = await setupClient.SendAsync(req);
            resp.EnsureSuccessStatusCode();
            recoveryCodes = await resp.Content.ReadFromJsonAsync<TwoFactorRecoveryCodesResponse>();
        }
        Assert.NotNull(recoveryCodes);
        var firstCode = recoveryCodes!.RecoveryCodes[0];

        using var client = CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new LoginRequest
        {
            Email = email,
            Password = password,
            RememberMe = true
        })).EnsureSuccessStatusCode();

        var recResp = await client.PostAsJsonAsync("/auth/login/recovery", new TwoFactorRecoveryLoginRequest
        {
            Code = firstCode
        });
        Assert.Equal(HttpStatusCode.OK, recResp.StatusCode);
        var me = await client.GetFromJsonAsync<MeResponse>("/auth/me");
        Assert.True(me!.Authenticated);

        // One recovery code consumed.
        using var scope = _factory.Services.CreateScope();
        var um = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = await um.FindByIdAsync(uid);
        Assert.Equal(9, await um.CountRecoveryCodesAsync(user!));
    }
}