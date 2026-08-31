using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using OpenIddict.Abstractions;

using Viritura.Api.Mcp;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Integration tests for dynamic MCP client lifecycle management:
/// expiry-based reclamation, active-client preservation, capacity recovery,
/// and concurrent registration safety.
/// </summary>
public sealed class McpDynamicClientPruningTests : IDisposable
{
    // Per-instance temp DB ensures complete isolation even when xUnit runs tests
    // in the same AppDomain (static fields would share the DB across test instances).
    private readonly string _dbFile =
        Path.Combine(Path.GetTempPath(), $"viritura-prune-test-{Guid.NewGuid():N}.db");

    private static readonly string[] SingleRedirectUri = ["http://127.0.0.1:43129/callback"];
    private static readonly string[] AltRedirectUri = ["http://127.0.0.1:43130/callback"];
    private static readonly string[] RaceRedirectUri = ["http://127.0.0.1:43131/callback"];

    private readonly WebApplicationFactory<Program> _factory;

    public McpDynamicClientPruningTests()
    {
        _factory = new PruningTestFactory(_dbFile);
    }

    public void Dispose()
    {
        _factory.Dispose();
        // Clear the SQLite connection pool so EF Core's pooled connections release
        // their file lock before we attempt to delete the temp DB file.
        SqliteConnection.ClearAllPools();
        if (File.Exists(_dbFile))
        {
            File.Delete(_dbFile);
        }
    }

    // -------------------------------------------------------------------------
    // Expiry / reclamation
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Prune_RemovesUnactivatedClientOlderThanLifetime()
    {
        using var client = CreateHttpClient();

        // Register a client via the public endpoint (creates app + lifecycle record).
        var reg = await OAuthRegisterAsync(client, SingleRedirectUri);
        var clientId = reg.GetProperty("client_id").GetString()!;

        // Back-date the lifecycle record to simulate the client being old.
        await BackdateLifecycleAsync(clientId, TimeSpan.FromHours(2));

        // Run pruner: client has no authorizations and is past the 1-hour window.
        await RunPrunerAsync();

        // The application should be gone.
        await using var scope = _factory.Services.CreateAsyncScope();
        var manager = scope.ServiceProvider.GetRequiredService<IOpenIddictApplicationManager>();
        Assert.Null(await manager.FindByClientIdAsync(clientId));

        // The lifecycle record should also be gone.
        var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        Assert.Null(await db.McpDynamicClients.FindAsync(clientId));
    }

    [Fact]
    public async Task Prune_DoesNotRemoveUnactivatedClientWithinLifetimeWindow()
    {
        using var client = CreateHttpClient();

        var reg = await OAuthRegisterAsync(client, SingleRedirectUri);
        var clientId = reg.GetProperty("client_id").GetString()!;

        // Back-date by only 30 minutes — still within the 1-hour unactivated window.
        await BackdateLifecycleAsync(clientId, TimeSpan.FromMinutes(30));
        await RunPrunerAsync();

        await using var scope = _factory.Services.CreateAsyncScope();
        var manager = scope.ServiceProvider.GetRequiredService<IOpenIddictApplicationManager>();
        Assert.NotNull(await manager.FindByClientIdAsync(clientId));
    }

    // -------------------------------------------------------------------------
    // Active / authorized client preservation
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Prune_PreservesClientThatHasCompletedAuthorization()
    {
        using var client = CreateHttpClient();

        // Complete a full OAuth flow so the client has an authorization + token.
        var mcpReg = await McpRegisterAsync(client);
        var mcpUrl = $"https://localhost/mcp/sessions/{mcpReg.GetProperty("sessionId").GetString()}";
        var grant = await AuthorizeOAuthAsync(client, mcpUrl, SingleRedirectUri);
        var clientId = grant.ClientId;

        // Age the lifecycle record past both the unactivated and inactive cutoffs.
        await BackdateLifecycleAsync(clientId, TimeSpan.FromDays(60));
        await RunPrunerAsync();

        // The client has a valid (redeemed) authorization, so it must NOT be pruned.
        await using var scope = _factory.Services.CreateAsyncScope();
        var manager = scope.ServiceProvider.GetRequiredService<IOpenIddictApplicationManager>();
        Assert.NotNull(await manager.FindByClientIdAsync(clientId));
    }

    // -------------------------------------------------------------------------
    // Capacity recovery
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Prune_RecoversCapacityAfterStaleClientsAreRemoved()
    {
        var dbFile = Path.Combine(Path.GetTempPath(), $"viritura-cap1-{Guid.NewGuid():N}.db");
        using var factory = new CapLimitedPruningTestFactory(dbFile, cap: 1);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });

        try
        {
            // Register the one allowed client.
            var first = await OAuthRegisterAsync(client, SingleRedirectUri);
            var firstId = first.GetProperty("client_id").GetString()!;

            // A second registration is blocked.
            var blocked = await client.PostAsJsonAsync("/oauth/register", new
            {
                client_name = "Second",
                redirect_uris = AltRedirectUri
            });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, blocked.StatusCode);

            // Age the first client so it becomes eligible for pruning.
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
                var mc = await db.McpDynamicClients.FindAsync(firstId);
                mc!.CreatedAt = DateTime.UtcNow - TimeSpan.FromHours(2);
                await db.SaveChangesAsync();
            }

            // Invoke the pruner directly from the factory's DI container.
            var pruner = factory.Services.GetRequiredService<DynamicClientPruningService>();
            await pruner.PruneAsync(CancellationToken.None);

            // Now a new registration succeeds.
            var second = await client.PostAsJsonAsync("/oauth/register", new
            {
                client_name = "Second (recovered)",
                redirect_uris = AltRedirectUri
            });
            Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            if (File.Exists(dbFile))
            {
                File.Delete(dbFile);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Concurrent registration safety
    // -------------------------------------------------------------------------

    [Fact]
    public async Task ConcurrentRegistrations_AtCapacity_DoNotExceedLimit()
    {
        const int Cap = 5;
        const int Total = 10;

        var dbFile = Path.Combine(Path.GetTempPath(), $"viritura-race-{Guid.NewGuid():N}.db");
        using var limitedFactory = new CapLimitedPruningTestFactory(dbFile, Cap);

        // Create all clients upfront and fire all requests before awaiting any, so the
        // requests truly race against the registration gate.
        var httpClients = new HttpClient[Total];
        var tasks = new Task<HttpResponseMessage>[Total];
        for (var i = 0; i < Total; i++)
        {
            httpClients[i] = limitedFactory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                BaseAddress = new Uri("https://localhost")
            });
            tasks[i] = httpClients[i].PostAsJsonAsync("/oauth/register", new
            {
                client_name = "concurrent",
                redirect_uris = RaceRedirectUri
            });
        }

        try
        {
            var responses = await Task.WhenAll(tasks);
            var successes = responses.Count(r => r.StatusCode == HttpStatusCode.Created);
            var failures = responses.Count(r => r.StatusCode == HttpStatusCode.ServiceUnavailable);

            Assert.Equal(Cap, successes);
            Assert.Equal(Total - Cap, failures);

            // Verify DB count matches.
            using var scope = limitedFactory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
            Assert.Equal(Cap, await db.McpDynamicClients.CountAsync());
        }
        finally
        {
            foreach (var c in httpClients)
            {
                c.Dispose();
            }
            SqliteConnection.ClearAllPools();
            if (File.Exists(dbFile))
            {
                File.Delete(dbFile);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private HttpClient CreateHttpClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });

    private static async Task<JsonElement> OAuthRegisterAsync(HttpClient client, string[] redirectUris)
    {
        var response = await client.PostAsJsonAsync("/oauth/register", new
        {
            client_name = "Test MCP client",
            redirect_uris = redirectUris
        });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<JsonElement> McpRegisterAsync(HttpClient client)
    {
        using var request = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Post, "/mcp/sessions");
        request.Headers.Add("X-Viritura-MCP-Registration", "1");
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task BackdateLifecycleAsync(string clientId, TimeSpan age)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        var mc = await db.McpDynamicClients.FindAsync(clientId);
        Assert.NotNull(mc);
        mc.CreatedAt = DateTime.UtcNow - age;
        await db.SaveChangesAsync();
    }

    private async Task RunPrunerAsync()
    {
        var pruner = _factory.Services.GetRequiredService<DynamicClientPruningService>();
        await pruner.PruneAsync(CancellationToken.None);
    }

    private static async Task<OAuthGrant> AuthorizeOAuthAsync(
        HttpClient client,
        string resource,
        string[] redirectUris)
    {
        var redirectUri = redirectUris[0];
        var clientReg = await client.PostAsJsonAsync("/oauth/register", new
        {
            client_name = "xUnit pruning test client",
            redirect_uris = redirectUris
        });
        clientReg.EnsureSuccessStatusCode();
        var clientDoc = await clientReg.Content.ReadFromJsonAsync<JsonElement>();
        var clientId = clientDoc.GetProperty("client_id").GetString()!;

        var verifier = Base64Url(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48));
        var challenge = Base64Url(
            System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(verifier)));
        var state = Guid.NewGuid().ToString("N");

        var authorizeUrl = "/oauth/authorize?" + string.Join("&", new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = clientId,
            ["redirect_uri"] = redirectUri,
            ["scope"] = "score:read",
            ["state"] = state,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
            ["resource"] = resource
        }.Select(p => $"{Uri.EscapeDataString(p.Key)}={Uri.EscapeDataString(p.Value)}"));

        var consent = await client.GetAsync(authorizeUrl);
        consent.EnsureSuccessStatusCode();
        var html = await consent.Content.ReadAsStringAsync();

        var form = ParseHiddenInputs(html);
        form["decision"] = "allow";
        using var consentReq = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Post, authorizeUrl)
        {
            Content = new System.Net.Http.FormUrlEncodedContent(form)
        };
        var authorized = await client.SendAsync(consentReq);
        Assert.Equal(HttpStatusCode.Redirect, authorized.StatusCode);
        var code = ParseQuery(authorized.Headers.Location!.Query)["code"];

        using var tokenReq = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Post, "/oauth/token")
        {
            Content = new System.Net.Http.FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["client_id"] = clientId,
                ["redirect_uri"] = redirectUri,
                ["code"] = code,
                ["code_verifier"] = verifier
            })
        };
        var tokenResp = await client.SendAsync(tokenReq);
        tokenResp.EnsureSuccessStatusCode();
        var token = await tokenResp.Content.ReadFromJsonAsync<JsonElement>();
        return new OAuthGrant(clientId, token.GetProperty("access_token").GetString()!);
    }

    private static Dictionary<string, string> ParseHiddenInputs(string html)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(
            html,
            "<input type=\\\"hidden\\\" name=\\\"([^\\\"]+)\\\" value=\\\"([^\\\"]*)\\\">",
            System.Text.RegularExpressions.RegexOptions.CultureInvariant,
            TimeSpan.FromSeconds(1)))
        {
            values[System.Net.WebUtility.HtmlDecode(match.Groups[1].Value)] =
                System.Net.WebUtility.HtmlDecode(match.Groups[2].Value);
        }
        return values;
    }

    private static Dictionary<string, string> ParseQuery(string query) =>
        query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(kv => kv.Split('=', 2))
            .ToDictionary(
                p => Uri.UnescapeDataString(p[0]),
                p => Uri.UnescapeDataString(p.ElementAtOrDefault(1) ?? string.Empty),
                StringComparer.Ordinal);

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record OAuthGrant(string ClientId, string AccessToken);

    private sealed class PruningTestFactory(string dbFile) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) =>
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:VirituraDb"] = $"Data Source={dbFile}",
                    ["Mcp:PruningInterval"] = "23:59:59"
                }));
    }

    // Used by capacity and concurrent tests that need both a custom cap and full DB isolation.
    private sealed class CapLimitedPruningTestFactory(string dbFile, int cap) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) =>
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:VirituraDb"] = $"Data Source={dbFile}",
                    ["Mcp:MaxDynamicClients"] = cap.ToString(CultureInfo.InvariantCulture),
                    ["Mcp:PruningInterval"] = "23:59:59"
                }));
    }
}