using System.Security.Cryptography;
using System.Text.Json;

using Microsoft.AspNetCore.DataProtection;

using Viritura.GitHub;

namespace Viritura.GitHub;

public sealed class GitHubOAuthStateService(
    IDataProtectionProvider dataProtectionProvider,
    TimeProvider timeProvider) : IGitHubOAuthStateService
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);
    private readonly IDataProtector _protector = dataProtectionProvider.CreateProtector("Viritura.GitHub.OAuthState.v1");

    public GitHubOAuthStateChallenge CreateChallenge(string? returnTo)
    {
        var state = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var payload = new StatePayload
        {
            Nonce = state,
            ReturnTo = returnTo,
            ExpiresAtUtc = timeProvider.GetUtcNow().AddMinutes(10)
        };

        var serialized = JsonSerializer.Serialize(payload, SerializerOptions);
        var cookieValue = _protector.Protect(serialized);

        return new GitHubOAuthStateChallenge(state, cookieValue);
    }

    public bool TryValidate(string state, string? cookieValue, out string returnTo)
    {
        returnTo = "/";

        if (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(cookieValue))
        {
            return false;
        }

        try
        {
            var payloadJson = _protector.Unprotect(cookieValue);
            var payload = JsonSerializer.Deserialize<StatePayload>(payloadJson, SerializerOptions);

            if (payload is null)
            {
                return false;
            }

            if (!string.Equals(payload.Nonce, state, StringComparison.Ordinal))
            {
                return false;
            }

            if (payload.ExpiresAtUtc <= timeProvider.GetUtcNow())
            {
                return false;
            }

            returnTo = string.IsNullOrWhiteSpace(payload.ReturnTo) ? "/" : payload.ReturnTo!;
            return true;
        }
#pragma warning disable CA1031 // boundary: any decode/validate failure means the state is invalid
        catch (Exception)
#pragma warning restore CA1031
        {
            return false;
        }
    }

    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private sealed record StatePayload
    {
        public string Nonce { get; init; } = string.Empty;

        public string? ReturnTo { get; init; }

        public DateTimeOffset ExpiresAtUtc { get; init; }
    }
}