using System.Net.WebSockets;
using System.Security.Claims;
using System.Text.Json;

using Microsoft.AspNetCore.Authentication;

using OpenIddict.Abstractions;
using OpenIddict.Validation.AspNetCore;

namespace Viritura.Api.Mcp;

internal static class McpEndpoint
{
    private const string ProtocolVersion = "2025-06-18";

    internal static IResult Register(
        HttpContext context,
        McpSessionRegistry registry,
        IWebHostEnvironment environment)
    {
        if (context.Request.Headers["X-Viritura-MCP-Registration"] != "1")
        {
            return Results.BadRequest(new { error = "MCP registration header is required." });
        }

        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!CanRegister(environment.IsDevelopment(), userId))
        {
            return Results.Unauthorized();
        }

        if (!registry.TryCreate(userId, out var registration) || registration is null)
        {
            context.Response.Headers.RetryAfter = "60";
            return Results.Json(
                new { error = "MCP session capacity reached. Disconnect another editor tab and try again." },
                statusCode: StatusCodes.Status429TooManyRequests);
        }
        var publicScheme = environment.IsDevelopment() ? context.Request.Scheme : "https";
        var httpBase = $"{publicScheme}://{context.Request.Host}";
        var webSocketScheme = publicScheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";
        var webSocketBase = $"{webSocketScheme}://{context.Request.Host}";
        return Results.Json(new
        {
            registration.SessionId,
            registration.HostToken,
            mcpUrl = $"{httpBase}/mcp",
            hostWebSocketUrl = $"{webSocketBase}/mcp/sessions/{registration.SessionId}/host"
        });
    }

    internal static bool CanRegister(bool isDevelopment, string? userId) =>
        isDevelopment || !string.IsNullOrEmpty(userId);

    internal static async Task HandleHostAsync(
        HttpContext context,
        string sessionId,
        McpSessionRegistry registry,
        FrontendOriginPolicy origins)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsync("WebSocket upgrade required.");
            return;
        }

        var originValue = context.Request.Headers.Origin.ToString();
        if (!Uri.TryCreate(originValue, UriKind.Absolute, out var origin) || !origins.IsAllowed(origin))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        if (!registry.Exists(sessionId))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        var authenticated = await registry.AuthenticateAndRunHostAsync(sessionId, socket, context.RequestAborted);
        if (!authenticated && socket.State == WebSocketState.Open)
        {
            await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Host authentication failed.", CancellationToken.None);
        }
    }

    internal static IResult StopHost(HttpContext context, string sessionId, McpSessionRegistry registry)
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        var token = authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? authorization["Bearer ".Length..]
            : null;
        if (string.IsNullOrEmpty(token))
        {
            return Results.Unauthorized();
        }
        return registry.Stop(sessionId, token) ? Results.NoContent() : Results.Unauthorized();
    }

    internal static async Task<IResult> HandleMcpAsync(
        HttpContext context,
        string sessionId,
        McpSessionRegistry registry,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        if (!await AuthorizeClientAsync(context, sessionId, registry))
        {
            SetBearerChallenge(context, sessionId);
            return McpError(null, -32000, "OAuth authorization is required.", "unauthorized", StatusCodes.Status401Unauthorized);
        }

        return await HandleAuthorizedMcpAsync(
            context,
            sessionId,
            registry,
            context.User.FindFirstValue(OpenIddictConstants.Claims.Subject),
            environment,
            cancellationToken);
    }

    internal static async Task<IResult> HandleStaticMcpAsync(
        HttpContext context,
        McpSessionRegistry registry,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var subject = await AuthenticateOAuthSubjectAsync(context);
        if (subject is null)
        {
            SetStaticBearerChallenge(context);
            return McpError(null, -32000, "OAuth authorization is required.", "unauthorized", StatusCodes.Status401Unauthorized);
        }

        return await HandleAuthorizedMcpAsync(
            context,
            sessionId: null,
            registry,
            subject,
            environment,
            cancellationToken);
    }

    internal static async Task<IResult> StopStaticClient(HttpContext context)
    {
        if (await AuthenticateOAuthSubjectAsync(context) is null)
        {
            SetStaticBearerChallenge(context);
            return Results.Unauthorized();
        }

        // Closing one MCP client transport must not disconnect the browser host
        // or other clients using this user's stable endpoint.
        return Results.NoContent();
    }

    private static async Task<IResult> HandleAuthorizedMcpAsync(
        HttpContext context,
        string? sessionId,
        McpSessionRegistry registry,
        string? subject,
        IWebHostEnvironment? environment,
        CancellationToken cancellationToken)
    {

        JsonElement request;
        try
        {
            request = (await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: cancellationToken)).RootElement.Clone();
        }
        catch (JsonException)
        {
            return McpError(null, -32700, "Parse error.", "invalid_json", StatusCodes.Status400BadRequest);
        }

        if (request.ValueKind != JsonValueKind.Object
            || !request.TryGetProperty("jsonrpc", out var version) || version.GetString() != "2.0"
            || !request.TryGetProperty("method", out var methodElement))
        {
            return McpError(GetId(request), -32600, "Invalid JSON-RPC request.", "invalid_request", StatusCodes.Status400BadRequest);
        }

        var id = GetId(request);
        var method = methodElement.GetString();
        if (id is null)
        {
            return Results.StatusCode(StatusCodes.Status202Accepted);
        }

        switch (method)
        {
            case "initialize":
                var clientDetail = request.TryGetProperty("params", out var init) ? init.Clone() : (JsonElement?)null;
                if (sessionId is not null)
                {
                    _ = NotifyHostBestEffortAsync(registry, sessionId, clientDetail);
                }
                else
                {
                    _ = NotifyOwnedHostsBestEffortAsync(
                        registry,
                        subject,
                        environment?.IsDevelopment() == true,
                        clientDetail);
                }
                return McpResult(id.Value, new
                {
                    protocolVersion = ProtocolVersion,
                    capabilities = new { tools = new { listChanged = false } },
                    serverInfo = new { name = "Viritura live editor", version = "0.1.0" },
                    instructions = "Call editor.list_sessions first when more than one Viritura document may be open, then pass sessionId to score and preview tools. Submit edits with preview.propose_patches; a person must approve them in Viritura."
                });

            case "ping":
                return McpResult(id.Value, new { });

            case "tools/list":
                return McpResult(id.Value, new { tools = McpToolCatalog.Tools });

            case "tools/call":
                return await CallToolAsync(
                    context,
                    id.Value,
                    request,
                    sessionId,
                    registry,
                    subject,
                    environment?.IsDevelopment() == true,
                    cancellationToken);

            default:
                return McpError(id, -32601, $"Method not found: {method}", "method_not_found");
        }
    }

    private static async Task NotifyHostBestEffortAsync(
        McpSessionRegistry registry,
        string sessionId,
        JsonElement? detail)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            await registry.NotifyHostAsync(sessionId, "client_connected", detail, timeout.Token);
        }
        catch (Exception error) when (error is OperationCanceledException or McpRelayException or WebSocketException)
        {
            // Client identity is display-only browser state. A stale or slow
            // host socket must never prevent the MCP initialize response.
        }
    }

    private static async Task NotifyOwnedHostsBestEffortAsync(
        McpSessionRegistry registry,
        string? subject,
        bool isDevelopment,
        JsonElement? detail)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            await registry.NotifyOwnedHostsAsync(
                subject,
                isDevelopment,
                "client_connected",
                detail,
                timeout.Token);
        }
        catch (Exception error) when (error is OperationCanceledException or McpRelayException or WebSocketException)
        {
            // Client identity is display-only browser state. A stale or slow
            // host socket must never prevent the MCP initialize response.
        }
    }

    internal static async Task<IResult> StopClient(
        HttpContext context,
        string sessionId,
        McpSessionRegistry registry)
    {
        if (!await AuthorizeClientAsync(context, sessionId, registry))
        {
            SetBearerChallenge(context, sessionId);
            return Results.Unauthorized();
        }

        return registry.Stop(sessionId) ? Results.NoContent() : Results.NotFound();
    }

    private static async Task<IResult> CallToolAsync(
        HttpContext context,
        JsonElement id,
        JsonElement request,
        string? sessionId,
        McpSessionRegistry registry,
        string? subject,
        bool isDevelopment,
        CancellationToken cancellationToken)
    {
        if (!request.TryGetProperty("params", out var parameters)
            || !parameters.TryGetProperty("name", out var nameElement)
            || nameElement.GetString() is not { } name)
        {
            return McpError(id, -32602, "tools/call requires params.name.", "invalid_params");
        }

        var arguments = parameters.TryGetProperty("arguments", out var suppliedArguments)
            ? suppliedArguments.Clone()
            : JsonSerializer.SerializeToElement(new { });
        var requiredScope = McpToolCatalog.RequiredScope(name);
        if (requiredScope is not null && !context.User.HasScope(requiredScope))
        {
            return McpResult(id, new
            {
                content = new[] { new { type = "text", text = $"Missing required MCP scope: {requiredScope}." } },
                isError = true,
                structuredContent = new { code = "insufficient_scope", requiredScope }
            });
        }
        if (name == "editor.list_sessions")
        {
            var sessions = registry.ListConnectedSessions(subject, isDevelopment);
            if (sessionId is null)
            {
                _ = NotifyOwnedHostsBestEffortAsync(registry, subject, isDevelopment, detail: null);
            }
            return McpResult(id, new
            {
                content = new[] { new { type = "text", text = $"Found {sessions.Count} opted-in Viritura sessions." } },
                structuredContent = new { sessions }
            });
        }

        var resolution = ResolveToolSession(registry, subject, isDevelopment, sessionId, arguments);
        if (resolution.Error is not null)
        {
            return McpResult(id, new
            {
                content = new[] { new { type = "text", text = resolution.Error.Value.Message } },
                isError = true,
                structuredContent = new { code = resolution.Error.Value.Code, message = resolution.Error.Value.Message }
            });
        }
        if (sessionId is null)
        {
            _ = NotifyHostBestEffortAsync(registry, resolution.SessionId!, detail: null);
        }
        try
        {
            var result = await registry.InvokeToolAsync(
                resolution.SessionId!,
                name,
                RemoveRoutingSessionId(arguments),
                cancellationToken);
            return McpResult(id, result);
        }
        catch (McpRelayException error)
        {
            // Tool-level failures are valid MCP tool results, not transport failures.
            return McpResult(id, new
            {
                content = new[] { new { type = "text", text = error.Message } },
                isError = true,
                structuredContent = new { code = error.Code, message = error.Message }
            });
        }
    }

    private static SessionResolution ResolveToolSession(
        McpSessionRegistry registry,
        string? subject,
        bool isDevelopment,
        string? routeSessionId,
        JsonElement arguments)
    {
        if (routeSessionId is not null)
        {
            return new SessionResolution(routeSessionId, null);
        }

        var requestedSessionId = arguments.ValueKind == JsonValueKind.Object
            && arguments.TryGetProperty("sessionId", out var requested)
            && requested.ValueKind == JsonValueKind.String
                ? requested.GetString()
                : null;
        if (requestedSessionId is not null)
        {
            return registry.TryResolveOwnedSession(requestedSessionId, subject, isDevelopment, out var ownedSessionId)
                ? new SessionResolution(ownedSessionId, null)
                : new SessionResolution(null, ("session_not_found", "That Viritura session is unavailable or is not owned by this OAuth user."));
        }

        var sessions = registry.ListConnectedSessions(subject, isDevelopment);
        return sessions.Count switch
        {
            0 => new SessionResolution(null, ("editor_offline", "No opted-in Viritura browser session is connected.")),
            1 => new SessionResolution(sessions[0].SessionId, null),
            _ => new SessionResolution(null, ("session_required", "Multiple Viritura sessions are connected. Call editor.list_sessions and pass sessionId."))
        };
    }

    private static JsonElement RemoveRoutingSessionId(JsonElement arguments)
    {
        if (arguments.ValueKind != JsonValueKind.Object || !arguments.TryGetProperty("sessionId", out _))
        {
            return arguments;
        }

        return JsonSerializer.SerializeToElement(arguments.EnumerateObject()
            .Where(property => property.Name != "sessionId")
            .ToDictionary(property => property.Name, property => property.Value.Clone(), StringComparer.Ordinal));
    }

    private sealed record SessionResolution(
        string? SessionId,
        (string Code, string Message)? Error);

    private static JsonElement? GetId(JsonElement request) =>
        request.ValueKind == JsonValueKind.Object && request.TryGetProperty("id", out var id) && id.ValueKind != JsonValueKind.Null
            ? id.Clone()
            : null;

    private static async Task<bool> AuthorizeClientAsync(
        HttpContext context,
        string sessionId,
        McpSessionRegistry registry)
    {
        var result = await context.AuthenticateAsync(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme);
        if (!registry.Exists(sessionId)
            || !result.Succeeded
            || result.Principal?.FindFirstValue(McpOAuthEndpoint.SessionClaim) != sessionId)
        {
            return false;
        }

        context.User = result.Principal;
        return true;
    }

    private static async Task<string?> AuthenticateOAuthSubjectAsync(HttpContext context)
    {
        var result = await context.AuthenticateAsync(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme);
        var subject = result.Succeeded ? result.Principal?.GetClaim(OpenIddictConstants.Claims.Subject) : null;
        var scheme = context.Request.Host.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            ? context.Request.Scheme
            : "https";
        var expectedAudience = $"{scheme}://{context.Request.Host}/mcp";
        if (string.IsNullOrEmpty(subject)
            || result.Principal is null
            || !result.Principal.GetAudiences().Contains(expectedAudience, StringComparer.Ordinal))
        {
            return null;
        }

        context.User = result.Principal;
        return subject;
    }

    private static void SetBearerChallenge(HttpContext context, string sessionId)
    {
        var scheme = context.Request.Host.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            ? context.Request.Scheme
            : "https";
        var origin = $"{scheme}://{context.Request.Host}";
        var metadata = $"{origin}/.well-known/oauth-protected-resource/mcp/sessions/{sessionId}";
        context.Response.Headers.WWWAuthenticate = $"Bearer resource_metadata=\"{metadata}\"";
    }

    private static void SetStaticBearerChallenge(HttpContext context)
    {
        var scheme = context.Request.Host.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            ? context.Request.Scheme
            : "https";
        var origin = $"{scheme}://{context.Request.Host}";
        context.Response.Headers.WWWAuthenticate = $"Bearer resource_metadata=\"{origin}/.well-known/oauth-protected-resource/mcp\"";
    }

    private static IResult McpResult(JsonElement id, object result) =>
        Results.Json(new { jsonrpc = "2.0", id, result }, contentType: "application/json");

    private static IResult McpError(
        JsonElement? id,
        int code,
        string message,
        string detailCode,
        int statusCode = StatusCodes.Status200OK) =>
        Results.Json(
            new { jsonrpc = "2.0", id, error = new { code, message, data = new { code = detailCode } } },
            statusCode: statusCode,
            contentType: "application/json");
}