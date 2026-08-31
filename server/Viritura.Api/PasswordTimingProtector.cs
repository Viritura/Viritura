using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

using Viritura.Infrastructure;

namespace Viritura.Api;

/// <summary>
/// Performs a real Identity password-hash verification for unknown and
/// passwordless identities so the login response does not expose a large
/// deterministic "hash work happened" timing oracle.
/// </summary>
public sealed class PasswordTimingProtector
{
    private readonly PasswordHasher<AppUser> _hasher;
    private readonly string _dummyHash;
    private readonly AppUser _dummyUser = new() { Id = "timing-dummy" };

    public PasswordTimingProtector(IOptions<PasswordHasherOptions> options)
    {
        _hasher = new PasswordHasher<AppUser>(options);
        _dummyHash = _hasher.HashPassword(_dummyUser, Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)));
    }

    public void VerifyDummy(string password)
    {
        _ = _hasher.VerifyHashedPassword(_dummyUser, _dummyHash, password);
    }
}