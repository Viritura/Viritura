using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using Viritura.GitHub;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Endpoint-level tests for POST /github/webhooks covering the completion-aware
/// delivery deduplication state machine.
/// </summary>
public sealed class GitHubWebhookControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private const string TestSecret = "test-webhook-secret-x7k2";

    private static readonly byte[] InstallationDeletedBody =
        """{"action":"deleted","installation":{"account":{"id":99887766}}}"""u8.ToArray();

    private readonly WebApplicationFactory<Program> _factory;

    public GitHubWebhookControllerTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(BaseConfig());
            });
        });
    }

    private static Dictionary<string, string?> BaseConfig() => new()
    {
        ["Database:Provider"] = "Sqlite",
        ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.webhook.test.{Guid.NewGuid():N}.db",
        ["Auth:RequireEmailVerification"] = "false",
        ["Features:Authentication:EmailRegistrationMode"] = "Open",
        ["Viritura:GitHub:ClientId"] = "client-id",
        ["Viritura:GitHub:ClientSecret"] = "client-secret",
        ["Viritura:GitHub:RedirectUri"] = "https://localhost/github/auth/callback",
        ["Viritura:GitHub:FrontendBaseUrl"] = "http://localhost:5173",
        ["Viritura:GitHub:AppSlug"] = "viritura-test",
        ["Viritura:GitHub:WebhookSecret"] = TestSecret,
        ["Email:Provider"] = "Console",
    };

    private HttpClient CreateClient() => _factory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost"),
    });

    private static string Sign(byte[] body, string secret = TestSecret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return "sha256=" + Convert.ToHexString(hmac.ComputeHash(body)).ToUpperInvariant();
    }

    private static HttpRequestMessage MakeDelivery(
        string deliveryId,
        byte[] body,
        string signature,
        string eventName = "ping")
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/github/webhooks");
        req.Content = new ByteArrayContent(body);
        req.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");
        req.Headers.Add("X-GitHub-Delivery", deliveryId);
        req.Headers.Add("X-Hub-Signature-256", signature);
        req.Headers.Add("X-GitHub-Event", eventName);
        return req;
    }

    // ── 1. Valid signature, unrecognised event ───────────────────────────────

    [Fact]
    public async Task ValidSignature_UnknownEvent_Returns200()
    {
        using var client = CreateClient();
        var body = "{}"u8.ToArray();
        var deliveryId = Guid.NewGuid().ToString();

        using var request = MakeDelivery(deliveryId, body, Sign(body));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── 2. Invalid signature ─────────────────────────────────────────────────

    [Fact]
    public async Task InvalidSignature_Returns401()
    {
        using var client = CreateClient();
        var body = "{}"u8.ToArray();
        var deliveryId = Guid.NewGuid().ToString();

        // Signature computed with wrong key.
        using var request = MakeDelivery(deliveryId, body, Sign(body, "wrong-secret"));
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── 3. Completed replay is idempotent ────────────────────────────────────

    [Fact]
    public async Task CompletedReplay_Returns200Idempotently()
    {
        using var client = CreateClient();
        var body = "{}"u8.ToArray();
        var deliveryId = Guid.NewGuid().ToString();
        var sig = Sign(body);

        using var req1 = MakeDelivery(deliveryId, body, sig);
        var r1 = await client.SendAsync(req1);
        Assert.Equal(HttpStatusCode.OK, r1.StatusCode);

        // Same delivery id — must still be 200 (not 4xx or 5xx).
        using var req2 = MakeDelivery(deliveryId, body, sig);
        var r2 = await client.SendAsync(req2);
        Assert.Equal(HttpStatusCode.OK, r2.StatusCode);
    }

    // ── 4. Concurrent duplicate ──────────────────────────────────────────────

    [Fact]
    public async Task ConcurrentDuplicate_Returns503()
    {
        // Pre-claim the lease on the shared singleton to simulate an in-flight request.
        var deduplicator = _factory.Services.GetRequiredService<WebhookDeliveryDeduplicator>();
        var deliveryId = Guid.NewGuid().ToString();
        Assert.Equal(LeaseAcquireResult.Acquired, deduplicator.TryAcquireLease(deliveryId));

        try
        {
            using var client = CreateClient();
            var body = "{}"u8.ToArray();
            using var request = MakeDelivery(deliveryId, body, Sign(body));
            var response = await client.SendAsync(request);

            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        }
        finally
        {
            // Clean up the pre-claimed lease so it doesn't outlive the test.
            deduplicator.Release(deliveryId);
        }
    }

    // ── 5. Malformed signed payload ──────────────────────────────────────────

    [Fact]
    public async Task MalformedSignedPayload_Returns200()
    {
        // Body has a valid signature but is not valid JSON.
        var body = "NOT-VALID-JSON"u8.ToArray();
        var deliveryId = Guid.NewGuid().ToString();

        using var client = CreateClient();
        using var request = MakeDelivery(deliveryId, body, Sign(body), "installation");
        var response = await client.SendAsync(request);

        // Malformed JSON is not retryable — controller must acknowledge with 200.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── 6. Transient storage failure: first attempt returns 503, retry succeeds ──

    [Fact]
    public async Task TransientStorageFailure_Returns503_ThenRetrySucceeds()
    {
        var failOnce = new FailOnceInstallationStore();

        // Use a child factory that injects the failing store.
        using var failFactory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                // Last registration wins — overrides the scoped EF-backed store.
                services.AddSingleton<IGitHubInstallationStore>(failOnce);
            });
        });

        using var client = failFactory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost"),
        });

        var deliveryId = Guid.NewGuid().ToString();
        var sig = Sign(InstallationDeletedBody);

        // First delivery: store throws → lease is released → 503.
        using var req1 = MakeDelivery(deliveryId, InstallationDeletedBody, sig, "installation");
        var r1 = await client.SendAsync(req1);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, r1.StatusCode);

        // Retry with same delivery id: store succeeds → 200.
        using var req2 = MakeDelivery(deliveryId, InstallationDeletedBody, sig, "installation");
        var r2 = await client.SendAsync(req2);
        Assert.Equal(HttpStatusCode.OK, r2.StatusCode);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Throws on the first <see cref="DeleteByGitHubAccountIdAsync"/> call; succeeds on subsequent ones.
    /// </summary>
    private sealed class FailOnceInstallationStore : IGitHubInstallationStore
    {
        private int _deleteCallCount;

        public Task<int> DeleteByGitHubAccountIdAsync(long gitHubAccountId, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _deleteCallCount) == 1)
                throw new InvalidOperationException("Simulated transient storage failure.");
            return Task.FromResult(1);
        }

        public Task<UserGitHubInstallation?> FindAsync(string userId, CancellationToken cancellationToken = default)
            => Task.FromResult<UserGitHubInstallation?>(null);

        public Task<UserGitHubInstallation?> FindByProviderKeyAsync(string providerKey, CancellationToken cancellationToken = default)
            => Task.FromResult<UserGitHubInstallation?>(null);

        public Task UpsertAsync(string userId, GitHubSessionEnvelope session, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task UpdateTokensAsync(int installationId, GitHubTokenBundle tokens, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task DeleteAsync(string userId, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}