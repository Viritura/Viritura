using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;

using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;

using Viritura.Infrastructure;

namespace Viritura.Api;

public enum RecentAuthAction
{
    SetPassword,
    ChangeEmail,
    DeleteAccount,
    UnlinkLogin,
    LinkLogin,
    ManageTwoFactor
}

public sealed class RecentAuthOptions
{
    public TimeSpan GrantLifetime { get; set; } = TimeSpan.FromMinutes(10);

    public TimeSpan FlowLifetime { get; set; } = TimeSpan.FromMinutes(10);
}

public sealed class RecentAuthService(
    IDataProtectionProvider dataProtectionProvider,
    TimeProvider timeProvider,
    IHostEnvironment environment,
    Microsoft.Extensions.Options.IOptions<RecentAuthOptions> options)
{
    public const string CookieName = "__Host-viritura-recent-auth";
    public const string FlowPrefix = "viritura-recent-auth:";

    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);
    private readonly IDataProtector _protector = dataProtectionProvider.CreateProtector("Viritura.RecentAuth.v1");
    private readonly ConcurrentDictionary<string, DateTimeOffset> _outstandingNonces = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, RecentAuthFlow> _flows = new(StringComparer.Ordinal);
    private readonly RecentAuthOptions _options = options.Value;

    public string BeginProviderFlow(string userId, string provider, RecentAuthAction action, string returnTo)
    {
        SweepExpired();
        var flowId = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        _flows[flowId] = new RecentAuthFlow(
            userId,
            provider,
            action,
            returnTo,
            timeProvider.GetUtcNow().Add(_options.FlowLifetime));
        return FlowPrefix + flowId;
    }

    public bool TryConsumeProviderFlow(
        string marker,
        string userId,
        string provider,
        out RecentAuthAction action,
        out string returnTo)
    {
        action = default;
        returnTo = string.Empty;
        if (!marker.StartsWith(FlowPrefix, StringComparison.Ordinal)) return false;
        var flowId = marker[FlowPrefix.Length..];
        if (!_flows.TryRemove(flowId, out var flow) ||
            flow.ExpiresAtUtc <= timeProvider.GetUtcNow() ||
            !string.Equals(flow.UserId, userId, StringComparison.Ordinal) ||
            !string.Equals(flow.Provider, provider, StringComparison.Ordinal))
        {
            return false;
        }
        action = flow.Action;
        returnTo = flow.ReturnTo;
        return true;
    }

    public void Issue(HttpResponse response, AppUser user, RecentAuthAction action, string proofMethod)
    {
        SweepExpired();
        var now = timeProvider.GetUtcNow();
        var nonce = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var expiresAt = now.Add(_options.GrantLifetime);
        var payload = new RecentAuthPayload(
            user.Id,
            user.SecurityStamp ?? string.Empty,
            action,
            proofMethod,
            nonce,
            now,
            expiresAt);
        _outstandingNonces[nonce] = expiresAt;
        response.Cookies.Append(
            CookieName,
            _protector.Protect(JsonSerializer.Serialize(payload, SerializerOptions)),
            CreateCookieOptions(environment, _options.GrantLifetime));
        response.Headers.CacheControl = "no-store";
    }

    public bool IsValid(HttpRequest request, AppUser user, RecentAuthAction action) =>
        TryValidate(request, user, action, consume: false, out _);

    public bool TryConsume(HttpRequest request, HttpResponse response, AppUser user, RecentAuthAction action)
    {
        var valid = TryValidate(request, user, action, consume: true, out _);
        if (valid)
        {
            response.Cookies.Delete(CookieName, CreateCookieOptions(environment, _options.GrantLifetime));
        }
        return valid;
    }

    private bool TryValidate(
        HttpRequest request,
        AppUser user,
        RecentAuthAction action,
        bool consume,
        out RecentAuthPayload? payload)
    {
        payload = null;
        if (!request.Cookies.TryGetValue(CookieName, out var protectedValue) ||
            string.IsNullOrWhiteSpace(protectedValue))
        {
            return false;
        }

        try
        {
            payload = JsonSerializer.Deserialize<RecentAuthPayload>(
                _protector.Unprotect(protectedValue),
                SerializerOptions);
        }
        catch (CryptographicException)
        {
            return false;
        }
        catch (JsonException)
        {
            return false;
        }

        var now = timeProvider.GetUtcNow();
        if (payload is null || payload.ExpiresAtUtc <= now || payload.IssuedAtUtc > now ||
            payload.Action != action ||
            !string.Equals(payload.UserId, user.Id, StringComparison.Ordinal) ||
            !CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(payload.SecurityStamp),
                System.Text.Encoding.UTF8.GetBytes(user.SecurityStamp ?? string.Empty)))
        {
            return false;
        }

        if (!_outstandingNonces.TryGetValue(payload.Nonce, out var nonceExpiry) || nonceExpiry <= now)
        {
            return false;
        }
        return !consume || _outstandingNonces.TryRemove(payload.Nonce, out _);
    }

    private void SweepExpired()
    {
        var now = timeProvider.GetUtcNow();
        foreach (var nonce in _outstandingNonces)
        {
            if (nonce.Value <= now) _outstandingNonces.TryRemove(nonce.Key, out _);
        }
        foreach (var flow in _flows)
        {
            if (flow.Value.ExpiresAtUtc <= now) _flows.TryRemove(flow.Key, out _);
        }
    }

    private static CookieOptions CreateCookieOptions(IHostEnvironment environment, TimeSpan lifetime) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = environment.IsDevelopment() ? SameSiteMode.None : SameSiteMode.Lax,
        IsEssential = true,
        Path = "/",
        MaxAge = lifetime
    };

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record RecentAuthPayload(
        string UserId,
        string SecurityStamp,
        RecentAuthAction Action,
        string ProofMethod,
        string Nonce,
        DateTimeOffset IssuedAtUtc,
        DateTimeOffset ExpiresAtUtc);

    private sealed record RecentAuthFlow(
        string UserId,
        string Provider,
        RecentAuthAction Action,
        string ReturnTo,
        DateTimeOffset ExpiresAtUtc);
}