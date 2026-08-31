using System.Net.Http.Json;

using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using Viritura.Api.Contracts.Auth;
using Viritura.GitHub;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Asserts that GitHub OAuth tokens stored in <see cref="UserGitHubInstallation"/> are not
/// readable as plaintext. The protector uses the <c>"v1:"</c> prefix so legacy plaintext rows
/// (pre-encryption) keep working transparently and get re-encrypted on next write.
/// </summary>
public sealed class GitHubInstallationStoreEncryptionTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public GitHubInstallationStoreEncryptionTests(WebApplicationFactory<Program> factory)
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

    [Fact]
    public async Task UpsertAsync_StoresTokensEncryptedButFindAsyncReturnsPlaintext()
    {
        // Boot the app once so the schema migrations / SQLite file exist.
        using var client = _factory.CreateClient();
        var email = $"enc.{Guid.NewGuid():N}@viritura.test";
        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "GoodPassw0rd!"
        });
        register.EnsureSuccessStatusCode();
        var user = await register.Content.ReadFromJsonAsync<AuthUserResponse>();

        const string plaintextAccess = "ghu_secret-access-token-value";
        const string plaintextRefresh = "ghr_secret-refresh-token-value";
        var gitHubUserId = Random.Shared.NextInt64(1_000_000, long.MaxValue);

        using (var scope = _factory.Services.CreateScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
            await store.UpsertAsync(user!.Id, new GitHubSessionEnvelope(
                new GitHubTokenBundle(
                    plaintextAccess,
                    plaintextRefresh,
                    DateTimeOffset.UtcNow.AddHours(8),
                    DateTimeOffset.UtcNow.AddDays(180),
                    "bearer",
                    "repo read:user"),
                new GitHubViewer(gitHubUserId, "viritura-user", "Viritura User", "https://example.com/u.png"),
                DateTimeOffset.UtcNow));
        }

        // At-rest: tokens must NOT match the plaintext, and must carry the protector's
        // version prefix so future migrations can detect format upgrades.
        using (var dbScope = _factory.Services.CreateScope())
        {
            var db = dbScope.ServiceProvider.GetRequiredService<VirituraDbContext>();
            var stored = await db.UserGitHubInstallations.AsNoTracking()
                .SingleAsync(x => x.UserId == user!.Id);
            Assert.NotEqual(plaintextAccess, stored.AccessToken);
            Assert.NotEqual(plaintextRefresh, stored.RefreshToken);
            Assert.StartsWith("v1:", stored.AccessToken, StringComparison.Ordinal);
            Assert.StartsWith("v1:", stored.RefreshToken, StringComparison.Ordinal);
        }

        // Read-through: callers see plaintext.
        using (var readScope = _factory.Services.CreateScope())
        {
            var store = readScope.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
            var found = await store.FindAsync(user!.Id);
            Assert.NotNull(found);
            Assert.Equal(plaintextAccess, found!.AccessToken);
            Assert.Equal(plaintextRefresh, found.RefreshToken);
        }
    }

    [Fact]
    public async Task FindAsync_WithLegacyPlaintextRow_ReturnsItAsIs()
    {
        // Backwards compat: rows written before encryption was introduced have no "v1:" prefix.
        // The protector must treat them as plaintext and not attempt to unprotect (which would
        // throw CryptographicException) \u2014 they get re-encrypted on the next UpdateTokensAsync /
        // UpsertAsync write through the normal token-refresh flow.
        using var client = _factory.CreateClient();
        var email = $"legacy.{Guid.NewGuid():N}@viritura.test";
        var register = await client.PostAsJsonAsync("/auth/register", new RegisterRequest
        {
            Email = email,
            Password = "GoodPassw0rd!"
        });
        register.EnsureSuccessStatusCode();
        var user = await register.Content.ReadFromJsonAsync<AuthUserResponse>();

        const string legacyPlaintext = "ghu_legacy-plaintext-from-before-encryption";
        var providerKey = $"legacy-{Guid.NewGuid():N}";

        using (var writeScope = _factory.Services.CreateScope())
        {
            var db = writeScope.ServiceProvider.GetRequiredService<VirituraDbContext>();
            db.UserGitHubInstallations.Add(new UserGitHubInstallation
            {
                UserId = user!.Id,
                LoginProvider = "GitHub",
                ProviderKey = providerKey,
                Login = "legacy-user",
                GitHubUserId = Random.Shared.NextInt64(1_000_000, long.MaxValue),
                AccessToken = legacyPlaintext,
                RefreshToken = null,
                TokenType = "bearer"
            });
            await db.SaveChangesAsync();
        }

        using var readScope = _factory.Services.CreateScope();
        var store = readScope.ServiceProvider.GetRequiredService<IGitHubInstallationStore>();
        var found = await store.FindAsync(user!.Id);
        Assert.NotNull(found);
        Assert.Equal(legacyPlaintext, found!.AccessToken);
    }
}