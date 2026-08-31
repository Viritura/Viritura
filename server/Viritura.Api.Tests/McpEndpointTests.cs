using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using Viritura.Api.Mcp;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class McpEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private static readonly string[] CapacityTestRedirectUris = ["http://127.0.0.1:43129/callback"];
    private static readonly string[] NonObjectPayload = ["not", "an", "object"];
    private readonly WebApplicationFactory<Program> _factory;

    public McpEndpointTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Register_ReturnsOpaqueMcpAndHostCapabilities()
    {
        using var client = CreateClient();
        var registration = await RegisterAsync(client);
        var sessionId = registration.GetProperty("sessionId").GetString();
        Assert.NotNull(sessionId);
        Assert.True(sessionId.Length >= 32);
        Assert.True(registration.GetProperty("hostToken").GetString()?.Length >= 40);
        Assert.False(registration.TryGetProperty("accessToken", out _));
        Assert.False(registration.TryGetProperty("scopes", out _));
        Assert.False(registration.TryGetProperty("expiresAt", out _));
        Assert.Equal("https://localhost/mcp", registration.GetProperty("mcpUrl").GetString());
        Assert.EndsWith(
            $"/mcp/sessions/{sessionId}/host",
            registration.GetProperty("hostWebSocketUrl").GetString(),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Register_RequiresCsrfResistantCustomHeader()
    {
        using var client = CreateClient();

        var response = await client.PostAsync("/mcp/sessions", content: null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public void Register_RequiresSignedInUser_InProduction()
    {
        Assert.False(McpEndpoint.CanRegister(isDevelopment: false, userId: null));
        Assert.True(McpEndpoint.CanRegister(isDevelopment: false, userId: "user-1"));
        Assert.True(McpEndpoint.CanRegister(isDevelopment: true, userId: null));
    }

    [Fact]
    public void Registry_RejectsRegistrationsBeyondPerUserLimitWithoutEviction()
    {
        using var registry = new McpSessionRegistry();
        var registrations = Enumerable.Range(0, 16)
            .Select(_ => registry.TryCreate("user-1", out var registration) ? registration : null)
            .ToArray();

        Assert.All(registrations, Assert.NotNull);
        Assert.False(registry.TryCreate("user-1", out var rejected));
        Assert.Null(rejected);
        Assert.True(registry.TryCreate("user-2", out var otherUser));
        Assert.NotNull(otherUser);
        Assert.All(registrations, registration => Assert.True(registry.Exists(registration!.SessionId)));
    }

    [Fact]
    public async Task OAuthRegistration_RejectsNewClientsAtStorageCapacity()
    {
        using var factory = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Mcp:MaxDynamicClients"] = "0"
                })));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });

        var response = await client.PostAsJsonAsync("/oauth/register", new
        {
            client_name = "Capacity test",
            redirect_uris = CapacityTestRedirectUris
        });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("temporarily_unavailable", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Initialize_AndToolsList_ImplementMcpJsonRpc()
    {
        using var client = CreateClient();
        var registration = await RegisterAsync(client);
        var endpoint = SessionMcpUrl(registration);
        var grant = await AuthorizeOAuthAsync(client, endpoint);

        var initialize = await PostRpcAsync(client, endpoint, grant.AccessToken, new
        {
            jsonrpc = "2.0",
            id = 1,
            method = "initialize",
            @params = new { protocolVersion = "2025-06-18", clientInfo = new { name = "test", version = "1" } }
        });
        Assert.Equal("2025-06-18", initialize.GetProperty("result").GetProperty("protocolVersion").GetString());
        Assert.Equal("Viritura live editor", initialize.GetProperty("result").GetProperty("serverInfo").GetProperty("name").GetString());

        var tools = await PostRpcAsync(
            client,
            endpoint,
            grant.AccessToken,
            new { jsonrpc = "2.0", id = 2, method = "tools/list" });
        var names = tools.GetProperty("result").GetProperty("tools").EnumerateArray()
            .Select(tool => tool.GetProperty("name").GetString())
            .ToArray();
        Assert.Contains("score.overview", names);
        Assert.Contains("score.get_measures", names);
        Assert.Contains("editor.get_selected_music", names);
        Assert.Contains("score.analyze_chords", names);
        Assert.Contains("score.get_timeline", names);
        Assert.Contains("score.validate", names);
        Assert.Contains("score.get_video_sync", names);
        Assert.Contains("score.get_instruments", names);
        Assert.Contains("preview.propose_patches", names);
        Assert.Contains("preview.propose_mnx", names);
        Assert.Contains("preview.split_orchestral_staves", names);
        Assert.Contains("preview.normalize_tritsch_instruments", names);
        Assert.Contains("preview.propose_chord_notes", names);
    }

    [Theory]
    [InlineData("score.get_timeline", "score:read")]
    [InlineData("score.validate", "score:read")]
    [InlineData("score.get_video_sync", "score:read")]
    [InlineData("score.get_instruments", "score:read")]
    [InlineData("preview.propose_mnx", "score:propose")]
    [InlineData("preview.split_orchestral_staves", "score:propose")]
    [InlineData("preview.normalize_tritsch_instruments", "score:propose")]
    public void RequiredScope_MapsNewAuthoringTools(string tool, string expectedScope)
    {
        Assert.True(McpToolCatalog.Contains(tool));
        Assert.Equal(expectedScope, McpToolCatalog.RequiredScope(tool));
    }

    [Fact]
    public async Task ToolCall_ReturnsEditorOffline_WhenHostIsAbsent()
    {
        using var client = CreateClient();
        var registration = await RegisterAsync(client);
        var endpoint = SessionMcpUrl(registration);
        var grant = await AuthorizeOAuthAsync(client, endpoint);

        var response = await PostRpcAsync(client, endpoint, grant.AccessToken, new
        {
            jsonrpc = "2.0",
            id = "call-1",
            method = "tools/call",
            @params = new { name = "score.overview", arguments = new { } }
        });

        var result = response.GetProperty("result");
        Assert.True(result.GetProperty("isError").GetBoolean());
        Assert.Equal("editor_offline", result.GetProperty("structuredContent").GetProperty("code").GetString());
    }

    [Fact]
    public async Task NonObjectJsonRpcPayload_ReturnsInvalidRequest()
    {
        using var client = CreateClient();
        var registration = await RegisterAsync(client);
        var endpoint = SessionMcpUrl(registration);
        var grant = await AuthorizeOAuthAsync(client, endpoint);

        using var request = CreateAuthorizedRequest(endpoint, grant.AccessToken, NonObjectPayload);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(-32600, body.GetProperty("error").GetProperty("code").GetInt32());
    }

    [Fact]
    public async Task McpRequests_RequireOAuthAccessToken()
    {
        using var client = CreateClient();
        var endpoint = "https://localhost/mcp";
        var body = new { jsonrpc = "2.0", id = 1, method = "ping" };

        var missing = await client.PostAsJsonAsync(endpoint, body);
        Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
        Assert.Equal("Bearer", missing.Headers.WwwAuthenticate.Single().Scheme);

        using var wrongRequest = CreateAuthorizedRequest(endpoint, "wrong-token", body);
        var wrong = await client.SendAsync(wrongRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
    }

    [Fact]
    public async Task OAuthDiscovery_AdvertisesPkceAndDynamicRegistration()
    {
        using var client = CreateClient();
        var registration = await RegisterAsync(client);
        var sessionId = registration.GetProperty("sessionId").GetString();

        var protectedResource = await client.GetFromJsonAsync<JsonElement>(
            $"/.well-known/oauth-protected-resource/mcp/sessions/{sessionId}");
        Assert.Equal(
            $"https://localhost/mcp/sessions/{sessionId}",
            protectedResource.GetProperty("resource").GetString());
        var staticProtectedResource = await client.GetFromJsonAsync<JsonElement>(
            "/.well-known/oauth-protected-resource/mcp");
        Assert.Equal("https://localhost/mcp", staticProtectedResource.GetProperty("resource").GetString());

        var server = await client.GetFromJsonAsync<JsonElement>("/.well-known/oauth-authorization-server");
        Assert.Equal("https://localhost/oauth/register", server.GetProperty("registration_endpoint").GetString());
        Assert.Equal(
            ["S256"],
            server.GetProperty("code_challenge_methods_supported").EnumerateArray()
                .Select(method => method.GetString()!)
                .ToArray());
    }

    [Fact]
    public async Task OAuthAuthorizationCodePkce_IssuesTokenAcceptedByMcp()
    {
        using var client = CreateClient();
        var registration = await RegisterAsync(client);
        var mcpUrl = SessionMcpUrl(registration);
        var grant = await AuthorizeOAuthAsync(client, mcpUrl);

        using var ping = CreateAuthorizedRequest(
            mcpUrl,
            grant.AccessToken,
            new { jsonrpc = "2.0", id = 1, method = "ping" });
        var pingResponse = await client.SendAsync(ping);
        pingResponse.EnsureSuccessStatusCode();

        using var revoke = new HttpRequestMessage(HttpMethod.Post, "/oauth/revoke")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = grant.ClientId,
                ["token"] = grant.AccessToken,
                ["token_type_hint"] = "access_token"
            })
        };
        var revoked = await client.SendAsync(revoke);
        revoked.EnsureSuccessStatusCode();

        using var afterRevoke = CreateAuthorizedRequest(
            mcpUrl,
            grant.AccessToken,
            new { jsonrpc = "2.0", id = 2, method = "ping" });
        var blocked = await client.SendAsync(afterRevoke);
        Assert.Equal(HttpStatusCode.Unauthorized, blocked.StatusCode);
    }

    [Fact]
    public async Task StaticOAuthUrl_RoutesToAuthenticatedUsersConnectedHost()
    {
        using var client = CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var registration = await RegisterAsync(client);
        var staticUrl = registration.GetProperty("mcpUrl").GetString()!;

        using var manualRequest = CreateAuthorizedRequest(
            staticUrl,
            "not-an-oauth-token",
            new { jsonrpc = "2.0", id = 1, method = "ping" });
        var manualResponse = await client.SendAsync(manualRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, manualResponse.StatusCode);
        Assert.Contains(
            "/.well-known/oauth-protected-resource/mcp",
            manualResponse.Headers.WwwAuthenticate.Single().Parameter,
            StringComparison.Ordinal);

        var grant = await AuthorizeOAuthAsync(client, staticUrl);
        var host = _factory.Server.CreateWebSocketClient();
        host.ConfigureRequest = request => request.Headers.Origin = "https://app.viritura.com";
        var hostUri = new Uri(registration.GetProperty("hostWebSocketUrl").GetString()!
            .Replace("wss://", "ws://", StringComparison.Ordinal));
        using var socket = await host.ConnectAsync(hostUri, timeout.Token);
        await SendSocketJsonAsync(socket, new
        {
            type = "authenticate",
            hostToken = registration.GetProperty("hostToken").GetString()
        }, timeout.Token);
        var ready = await ReceiveSocketJsonAsync(socket, timeout.Token);
        Assert.Equal("ready", ready.GetProperty("type").GetString());
        var registry = _factory.Services.GetRequiredService<McpSessionRegistry>();
        Assert.False(registry.TryResolveOwnedSession(
            registration.GetProperty("sessionId").GetString()!,
            userId: "different-user",
            isDevelopment: false,
            out _));

        var sessionGrant = await AuthorizeOAuthAsync(client, SessionMcpUrl(registration));
        using var wrongAudience = CreateAuthorizedRequest(
            staticUrl,
            sessionGrant.AccessToken,
            new { jsonrpc = "2.0", id = 2, method = "ping" });
        var wrongAudienceResponse = await client.SendAsync(wrongAudience);
        Assert.Equal(HttpStatusCode.Unauthorized, wrongAudienceResponse.StatusCode);

        using var ping = CreateAuthorizedRequest(
            staticUrl,
            grant.AccessToken,
            new
            {
                jsonrpc = "2.0",
                id = 3,
                method = "initialize",
                @params = new { protocolVersion = "2025-06-18", clientInfo = new { name = "static-test", version = "1" } }
            });
        var initializeResponse = await client.SendAsync(ping);
        initializeResponse.EnsureSuccessStatusCode();
        var initialized = await initializeResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            "Viritura live editor",
            initialized.GetProperty("result").GetProperty("serverInfo").GetProperty("name").GetString());
        var clientConnected = await ReceiveSocketJsonAsync(socket, timeout.Token);
        Assert.Equal("client_connected", clientConnected.GetProperty("type").GetString());
        Assert.Equal(
            "static-test",
            clientConnected.GetProperty("detail").GetProperty("clientInfo").GetProperty("name").GetString());

        await PostRpcAsync(
            client,
            staticUrl,
            grant.AccessToken,
            new
            {
                jsonrpc = "2.0",
                id = 4,
                method = "tools/call",
                @params = new { name = "editor.list_sessions", arguments = new { } }
            });
        var clientActivity = await ReceiveSocketJsonAsync(socket, timeout.Token);
        Assert.Equal("client_connected", clientActivity.GetProperty("type").GetString());

        using var stop = new HttpRequestMessage(HttpMethod.Delete, staticUrl);
        stop.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", grant.AccessToken);
        var stopped = await client.SendAsync(stop);
        Assert.Equal(HttpStatusCode.NoContent, stopped.StatusCode);

        using var afterStop = CreateAuthorizedRequest(
            staticUrl,
            grant.AccessToken,
            new { jsonrpc = "2.0", id = 5, method = "ping" });
        var stillAvailable = await client.SendAsync(afterStop);
        stillAvailable.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ToolCall_RoundTripsThroughAuthenticatedBrowserHost()
    {
        using var client = CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var registration = await RegisterAsync(client);
        var host = _factory.Server.CreateWebSocketClient();
        host.ConfigureRequest = request => request.Headers.Origin = "https://app.viritura.com";
        var hostUri = new Uri(registration.GetProperty("hostWebSocketUrl").GetString()!.Replace("wss://", "ws://", StringComparison.Ordinal));
        using var socket = await host.ConnectAsync(hostUri, timeout.Token);
        await SendSocketJsonAsync(socket, new
        {
            type = "authenticate",
            hostToken = registration.GetProperty("hostToken").GetString()
        }, timeout.Token);
        var ready = await ReceiveSocketJsonAsync(socket, timeout.Token);
        Assert.Equal("ready", ready.GetProperty("type").GetString());

        var mcpUrl = registration.GetProperty("mcpUrl").GetString()!;
        var grant = await AuthorizeOAuthAsync(client, mcpUrl);

#pragma warning disable CA2025 // callTask is awaited below before the owning HttpClient is disposed.
        var callTask = PostRpcAsync(
            client,
            mcpUrl,
            grant.AccessToken,
            new
            {
                jsonrpc = "2.0",
                id = "relay-1",
                method = "tools/call",
                @params = new { name = "score.overview", arguments = new { } }
            });
#pragma warning restore CA2025
        var forwarded = await ReceiveSocketMessageOfTypeAsync(socket, "tool_call", timeout.Token);
        Assert.Equal("tool_call", forwarded.GetProperty("type").GetString());
        Assert.Equal("score.overview", forwarded.GetProperty("name").GetString());
        await SendSocketJsonAsync(socket, new
        {
            type = "tool_result",
            requestId = forwarded.GetProperty("requestId").GetString(),
            result = new
            {
                content = new[] { new { type = "text", text = "One-part score" } },
                structuredContent = new { partCount = 1 }
            }
        }, timeout.Token);

        var response = await callTask;
        Assert.Equal(1, response.GetProperty("result").GetProperty("structuredContent").GetProperty("partCount").GetInt32());
    }

    [Fact]
    public async Task StaticOAuth_MultipleSessionsRequireExplicitOwnedSessionRouting()
    {
        using var client = CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var first = await RegisterAsync(client);
        var second = await RegisterAsync(client);
        var host = _factory.Server.CreateWebSocketClient();
        host.ConfigureRequest = request => request.Headers.Origin = "https://app.viritura.com";
        using var firstSocket = await ConnectHostAsync(host, first, "First score", "https://example.test/first.mnx", timeout.Token);
        using var secondSocket = await ConnectHostAsync(host, second, "Second score", "https://example.test/second.mnx", timeout.Token);
        var grant = await AuthorizeOAuthAsync(client, "https://localhost/mcp");

        var listed = await PostRpcAsync(client, "https://localhost/mcp", grant.AccessToken, new
        {
            jsonrpc = "2.0",
            id = 1,
            method = "tools/call",
            @params = new { name = "editor.list_sessions", arguments = new { } }
        });
        var sessions = listed.GetProperty("result").GetProperty("structuredContent").GetProperty("sessions");
        Assert.Equal(2, sessions.GetArrayLength());
        Assert.Contains(sessions.EnumerateArray(), session => session.GetProperty("title").GetString() == "First score");
        Assert.Contains(sessions.EnumerateArray(), session => session.GetProperty("title").GetString() == "Second score");

        var ambiguous = await PostRpcAsync(client, "https://localhost/mcp", grant.AccessToken, new
        {
            jsonrpc = "2.0",
            id = 2,
            method = "tools/call",
            @params = new { name = "score.overview", arguments = new { } }
        });
        Assert.Equal(
            "session_required",
            ambiguous.GetProperty("result").GetProperty("structuredContent").GetProperty("code").GetString());

        var firstSessionId = first.GetProperty("sessionId").GetString()!;
#pragma warning disable CA2025 // routedCall is awaited below before the owning HttpClient is disposed.
        var routedCall = PostRpcAsync(client, "https://localhost/mcp", grant.AccessToken, new
        {
            jsonrpc = "2.0",
            id = 3,
            method = "tools/call",
            @params = new { name = "score.overview", arguments = new { sessionId = firstSessionId } }
        });
#pragma warning restore CA2025
        var forwarded = await ReceiveSocketMessageOfTypeAsync(firstSocket, "tool_call", timeout.Token);
        Assert.Equal("score.overview", forwarded.GetProperty("name").GetString());
        Assert.False(forwarded.GetProperty("arguments").TryGetProperty("sessionId", out _));
        await SendSocketJsonAsync(firstSocket, new
        {
            type = "tool_result",
            requestId = forwarded.GetProperty("requestId").GetString(),
            result = new
            {
                content = new[] { new { type = "text", text = "First score" } },
                structuredContent = new { title = "First score" }
            }
        }, timeout.Token);
        var routed = await routedCall;
        Assert.Equal("First score", routed.GetProperty("result").GetProperty("structuredContent").GetProperty("title").GetString());

        using var unknownOwner = CreateAuthorizedRequest("https://localhost/mcp", grant.AccessToken, new
        {
            jsonrpc = "2.0",
            id = 4,
            method = "tools/call",
            @params = new { name = "score.overview", arguments = new { sessionId = "someone-elses-session-id" } }
        });
        var rejectedResponse = await client.SendAsync(unknownOwner);
        var rejected = await rejectedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            "session_not_found",
            rejected.GetProperty("result").GetProperty("structuredContent").GetProperty("code").GetString());
    }

    [Fact]
    public async Task HostStop_RequiresTheSeparateHostToken()
    {
        using var client = CreateClient();
        var registration = await RegisterAsync(client);
        var sessionId = registration.GetProperty("sessionId").GetString();

        var unauthorized = await client.DeleteAsync($"/mcp/sessions/{sessionId}/host");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/mcp/sessions/{sessionId}/host");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            registration.GetProperty("hostToken").GetString());
        var stopped = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, stopped.StatusCode);
    }

    [Fact]
    public async Task ClientStop_RequiresSessionBoundOAuth_AndRevokesSession()
    {
        using var client = CreateClient();
        var registration = await RegisterAsync(client);
        var sessionId = registration.GetProperty("sessionId").GetString();
        var endpoint = SessionMcpUrl(registration);
        var grant = await AuthorizeOAuthAsync(client, endpoint);

        var unauthorized = await client.DeleteAsync($"/mcp/sessions/{sessionId}");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        using var stop = new HttpRequestMessage(HttpMethod.Delete, $"/mcp/sessions/{sessionId}");
        stop.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer",
            grant.AccessToken);
        var stopped = await client.SendAsync(stop);
        Assert.Equal(HttpStatusCode.NoContent, stopped.StatusCode);

        using var afterStop = CreateAuthorizedRequest(
            endpoint,
            grant.AccessToken,
            new { jsonrpc = "2.0", id = 1, method = "ping" });
        var revoked = await client.SendAsync(afterStop);
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
    }

    private HttpClient CreateClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });

    private static async Task<JsonElement> RegisterAsync(HttpClient client)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp/sessions");
        request.Headers.Add("X-Viritura-MCP-Registration", "1");
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static string SessionMcpUrl(JsonElement registration) =>
        $"https://localhost/mcp/sessions/{registration.GetProperty("sessionId").GetString()}";

    private static async Task<WebSocket> ConnectHostAsync(
        WebSocketClient host,
        JsonElement registration,
        string title,
        string fileName,
        CancellationToken cancellationToken)
    {
        var hostUri = new Uri(registration.GetProperty("hostWebSocketUrl").GetString()!
            .Replace("wss://", "ws://", StringComparison.Ordinal));
        var socket = await host.ConnectAsync(hostUri, cancellationToken);
        await SendSocketJsonAsync(socket, new
        {
            type = "authenticate",
            hostToken = registration.GetProperty("hostToken").GetString(),
            metadata = new { title, fileName, documentId = $"url:{fileName}", focused = false }
        }, cancellationToken);
        var ready = await ReceiveSocketJsonAsync(socket, cancellationToken);
        Assert.Equal("ready", ready.GetProperty("type").GetString());
        return socket;
    }

    private static async Task<JsonElement> PostRpcAsync(
        HttpClient client,
        string endpoint,
        string accessToken,
        object request)
    {
        using var message = CreateAuthorizedRequest(endpoint, accessToken, request);
        var response = await client.SendAsync(message);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static HttpRequestMessage CreateAuthorizedRequest(string endpoint, string accessToken, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = JsonContent.Create(body)
        };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
        return request;
    }

    private static async Task<OAuthGrant> AuthorizeOAuthAsync(HttpClient client, string resource)
    {
        const string RedirectUri = "http://127.0.0.1:43129/callback";
        var clientRegistration = await client.PostAsJsonAsync("/oauth/register", new
        {
            client_name = "xUnit MCP client",
            redirect_uris = new[] { RedirectUri }
        });
        clientRegistration.EnsureSuccessStatusCode();
        var clientDocument = await clientRegistration.Content.ReadFromJsonAsync<JsonElement>();
        var clientId = clientDocument.GetProperty("client_id").GetString()!;
        var verifier = Base64Url(RandomNumberGenerator.GetBytes(48));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var state = Guid.NewGuid().ToString("N");
        var parameters = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = clientId,
            ["redirect_uri"] = RedirectUri,
            ["scope"] = "score:read selection:read score:propose",
            ["state"] = state,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
            ["resource"] = resource
        };
        var authorizeUrl = "/oauth/authorize?" + string.Join(
            "&",
            parameters.Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));

        var consent = await client.GetAsync(authorizeUrl);
        consent.EnsureSuccessStatusCode();
        var html = await consent.Content.ReadAsStringAsync();
        Assert.Contains("xUnit MCP client", html, StringComparison.Ordinal);
        Assert.Contains("/server-ui/server-ui.css", html, StringComparison.Ordinal);
        Assert.Contains("/server-ui/server-ui.js", html, StringComparison.Ordinal);
        var consentCsp = consent.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("script-src 'self'", consentCsp, StringComparison.Ordinal);
        Assert.Contains("style-src 'self'", consentCsp, StringComparison.Ordinal);
        Assert.Contains("form-action 'self'", consentCsp, StringComparison.Ordinal);
        var form = ParseHiddenInputs(html);
        form["decision"] = "allow";
        using var consentRequest = new HttpRequestMessage(HttpMethod.Post, authorizeUrl)
        {
            Content = new FormUrlEncodedContent(form)
        };
        var authorized = await client.SendAsync(consentRequest);
        Assert.Equal(HttpStatusCode.Redirect, authorized.StatusCode);
        var callback = authorized.Headers.Location!;
        Assert.Equal(state, ParseQuery(callback.Query)["state"]);
        var code = ParseQuery(callback.Query)["code"];

        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, "/oauth/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["client_id"] = clientId,
                ["redirect_uri"] = RedirectUri,
                ["code"] = code,
                ["code_verifier"] = verifier
            })
        };
        var tokenResponse = await client.SendAsync(tokenRequest);
        tokenResponse.EnsureSuccessStatusCode();
        var token = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Bearer", token.GetProperty("token_type").GetString());
        return new OAuthGrant(clientId, token.GetProperty("access_token").GetString()!);
    }

    private static Dictionary<string, string> ParseHiddenInputs(string html)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (Match match in Regex.Matches(
            html,
            "<input type=\\\"hidden\\\" name=\\\"([^\\\"]+)\\\" value=\\\"([^\\\"]*)\\\">",
            RegexOptions.CultureInvariant,
            TimeSpan.FromSeconds(1)))
        {
            values[WebUtility.HtmlDecode(match.Groups[1].Value)] = WebUtility.HtmlDecode(match.Groups[2].Value);
        }
        return values;
    }

    private static Dictionary<string, string> ParseQuery(string query) =>
        query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(value => value.Split('=', 2))
            .ToDictionary(
                pair => Uri.UnescapeDataString(pair[0]),
                pair => Uri.UnescapeDataString(pair.ElementAtOrDefault(1) ?? string.Empty),
                StringComparer.Ordinal);

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record OAuthGrant(string ClientId, string AccessToken);

    private static async Task SendSocketJsonAsync(WebSocket socket, object value, CancellationToken cancellationToken)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        await socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken);
    }

    private static async Task<JsonElement> ReceiveSocketJsonAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        var result = await socket.ReceiveAsync(buffer, cancellationToken);
        Assert.Equal(WebSocketMessageType.Text, result.MessageType);
        Assert.True(result.EndOfMessage);
        return JsonDocument.Parse(Encoding.UTF8.GetString(buffer, 0, result.Count)).RootElement.Clone();
    }

    private static async Task<JsonElement> ReceiveSocketMessageOfTypeAsync(
        WebSocket socket,
        string expectedType,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            var message = await ReceiveSocketJsonAsync(socket, cancellationToken);
            if (message.TryGetProperty("type", out var type) && type.GetString() == expectedType)
            {
                return message;
            }
        }
    }
}