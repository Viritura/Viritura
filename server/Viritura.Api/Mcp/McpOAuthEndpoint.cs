using System.Collections.Immutable;
using System.Security.Claims;
using System.Text.Json;

using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

using OpenIddict.Abstractions;
using OpenIddict.Server.AspNetCore;

using Viritura.Infrastructure;

using static OpenIddict.Abstractions.OpenIddictConstants;

namespace Viritura.Api.Mcp;

/// <summary>
/// OAuth Authorization Code + PKCE surface for public/native MCP clients.
/// Dynamic clients are restricted to HTTPS and loopback redirect URIs.
/// </summary>
internal static class McpOAuthEndpoint
{
    internal const int DefaultMaxDynamicClients = 10_000;
    internal const string SessionClaim = "viritura:mcp_session";
    internal const string DevelopmentSubject = "development-user";
    private static readonly SemaphoreSlim RegistrationGate = new(1, 1);
    private static readonly string[] SupportedScopes = ["score:read", "selection:read", "score:propose"];
    private static readonly string[] HeaderBearerMethod = ["header"];
    private static readonly string[] CodeResponseType = ["code"];
    private static readonly string[] AuthorizationCodeGrant = ["authorization_code"];
    private static readonly string[] S256ChallengeMethod = ["S256"];
    private static readonly string[] NoClientAuthentication = ["none"];
    private static readonly string[] AccessTokenDestination = [Destinations.AccessToken];
    private static readonly string[] NoDestinations = [];
    private static readonly string[] ApplicationPermissions =
    [
        Permissions.Endpoints.Authorization,
        Permissions.Endpoints.Token,
        Permissions.Endpoints.Revocation,
        Permissions.GrantTypes.AuthorizationCode,
        Permissions.ResponseTypes.Code,
        Permissions.Prefixes.Scope + "score:read",
        Permissions.Prefixes.Scope + "selection:read",
        Permissions.Prefixes.Scope + "score:propose"
    ];

    internal static IResult ProtectedResourceMetadata(
        HttpContext context,
        string sessionId,
        IWebHostEnvironment environment)
    {
        var scheme = environment.IsDevelopment() ? context.Request.Scheme : "https";
        var origin = $"{scheme}://{context.Request.Host}";
        return Results.Json(new
        {
            resource = $"{origin}/mcp/sessions/{sessionId}",
            authorization_servers = new[] { origin },
            scopes_supported = SupportedScopes,
            bearer_methods_supported = HeaderBearerMethod
        });
    }

    internal static IResult StaticProtectedResourceMetadata(
        HttpContext context,
        IWebHostEnvironment environment)
    {
        var scheme = environment.IsDevelopment() ? context.Request.Scheme : "https";
        var origin = $"{scheme}://{context.Request.Host}";
        return Results.Json(new
        {
            resource = $"{origin}/mcp",
            authorization_servers = new[] { origin },
            scopes_supported = SupportedScopes,
            bearer_methods_supported = HeaderBearerMethod
        });
    }

    internal static IResult AuthorizationServerMetadata(
        HttpContext context,
        IWebHostEnvironment environment)
    {
        var scheme = environment.IsDevelopment() ? context.Request.Scheme : "https";
        var origin = $"{scheme}://{context.Request.Host}";
        return Results.Json(new
        {
            issuer = origin,
            authorization_endpoint = $"{origin}/oauth/authorize",
            token_endpoint = $"{origin}/oauth/token",
            revocation_endpoint = $"{origin}/oauth/revoke",
            registration_endpoint = $"{origin}/oauth/register",
            response_types_supported = CodeResponseType,
            grant_types_supported = AuthorizationCodeGrant,
            code_challenge_methods_supported = S256ChallengeMethod,
            token_endpoint_auth_methods_supported = NoClientAuthentication,
            scopes_supported = SupportedScopes
        });
    }

    internal static async Task<IResult> RegisterClientAsync(
        HttpContext context,
        IOpenIddictApplicationManager applications,
        IOptions<McpDynamicClientOptions> options,
        VirituraDbContext db,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        JsonElement body;
        try
        {
            body = (await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: cancellationToken)).RootElement.Clone();
        }
        catch (JsonException)
        {
            return OAuthError(StatusCodes.Status400BadRequest, "invalid_client_metadata", "The registration document is invalid JSON.");
        }

        if (!TryReadRedirectUris(body, out var redirectUris, out var error))
        {
            return OAuthError(StatusCodes.Status400BadRequest, "invalid_redirect_uri", error);
        }

        var displayName = body.TryGetProperty("client_name", out var name) && name.ValueKind == JsonValueKind.String
            ? name.GetString()![..Math.Min(name.GetString()!.Length, 100)]
            : "MCP client";
        var maxDynamicClients = Math.Max(0, options.Value.MaxDynamicClients);

        await RegistrationGate.WaitAsync(cancellationToken);
        try
        {
            // Count only tracked dynamic registrations so stale entries pruned by the
            // background service immediately reduce the effective load against the cap.
            if (await db.McpDynamicClients.CountAsync(cancellationToken) >= maxDynamicClients)
            {
                return OAuthError(
                    StatusCodes.Status503ServiceUnavailable,
                    Errors.TemporarilyUnavailable,
                    "Dynamic client registration is currently at capacity.");
            }

            var clientId = $"mcp-{Guid.NewGuid():N}";
            var descriptor = new OpenIddictApplicationDescriptor
            {
                ClientId = clientId,
                ClientType = ClientTypes.Public,
                ConsentType = ConsentTypes.Explicit,
                DisplayName = displayName
            };
            descriptor.RedirectUris.UnionWith(redirectUris);
            descriptor.Permissions.UnionWith(ApplicationPermissions);
            descriptor.Requirements.Add(Requirements.Features.ProofKeyForCodeExchange);

            // Create the application and the lifecycle record atomically so the cap
            // count and the pruner's candidate query are always consistent.
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            await applications.CreateAsync(descriptor, cancellationToken);
            db.McpDynamicClients.Add(new McpDynamicClientLifecycle
            {
                ClientId = clientId,
                CreatedAt = timeProvider.GetUtcNow().UtcDateTime
            });
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return Results.Json(new
            {
                client_id = clientId,
                client_name = displayName,
                redirect_uris = redirectUris.Select(uri => uri.AbsoluteUri),
                token_endpoint_auth_method = "none",
                grant_types = AuthorizationCodeGrant,
                response_types = CodeResponseType
            }, statusCode: StatusCodes.Status201Created);
        }
        finally
        {
            RegistrationGate.Release();
        }
    }

    internal static async Task<IResult> AuthorizeAsync(
        HttpContext context,
        McpSessionRegistry sessions,
        IWebHostEnvironment environment,
        IAntiforgery antiforgery,
        IOpenIddictApplicationManager applications)
    {
        var request = context.GetOpenIddictServerRequest();
        if (request is null)
        {
            return OAuthError(StatusCodes.Status400BadRequest, Errors.InvalidRequest, "The authorization request is unavailable.");
        }
        if (!string.Equals(request.CodeChallengeMethod, CodeChallengeMethods.Sha256, StringComparison.Ordinal))
        {
            return OAuthError(StatusCodes.Status400BadRequest, Errors.InvalidRequest, "S256 PKCE is required.");
        }

        var resource = request.GetParameter(Parameters.Resource)?.ToString();
        if (!TryParseMcpResource(context, environment, resource, out var sessionId, out var isStaticResource))
        {
            return OAuthError(StatusCodes.Status400BadRequest, Errors.InvalidTarget, "The resource must identify Viritura's MCP endpoint.");
        }

        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var developmentSubject = environment.IsDevelopment() && string.IsNullOrEmpty(userId) ? DevelopmentSubject : null;
        var canAuthorize = isStaticResource
            ? McpSessionRegistry.CanAuthorizeStaticOAuth(userId, environment.IsDevelopment())
            : sessions.CanAuthorizeOAuth(sessionId!, userId, environment.IsDevelopment());
        if (!canAuthorize)
        {
            return Results.Unauthorized();
        }

        if (context.Request.Method == HttpMethods.Get)
        {
            var tokens = antiforgery.GetAndStoreTokens(context);
            var clientName = request.ClientId ?? "MCP client";
            if (request.ClientId is not null
                && await applications.FindByClientIdAsync(request.ClientId, context.RequestAborted) is { } application)
            {
                clientName = await applications.GetDisplayNameAsync(application, context.RequestAborted) ?? clientName;
            }
            return Results.Content(
                McpConsentPage.Build(context, request, clientName, tokens.FormFieldName, tokens.RequestToken!),
                "text/html");
        }

        await antiforgery.ValidateRequestAsync(context);
        if (!context.Request.HasFormContentType)
        {
            return OAuthError(StatusCodes.Status400BadRequest, Errors.InvalidRequest, "Consent form data is required.");
        }
        var form = await context.Request.ReadFormAsync(context.RequestAborted);
        if (!string.Equals(form["decision"], "allow", StringComparison.Ordinal))
        {
            return Results.Forbid(
                new AuthenticationProperties(new Dictionary<string, string?>
                {
                    [OpenIddictServerAspNetCoreConstants.Properties.Error] = Errors.AccessDenied,
                    [OpenIddictServerAspNetCoreConstants.Properties.ErrorDescription] = "The resource owner denied access."
                }),
                [OpenIddictServerAspNetCoreDefaults.AuthenticationScheme]);
        }

        var subject = userId ?? developmentSubject!;
        var identity = new ClaimsIdentity(OpenIddictServerAspNetCoreDefaults.AuthenticationScheme, Claims.Name, Claims.Role);
        identity.SetClaim(Claims.Subject, subject)
            .SetClaim(Claims.Name, context.User.Identity?.Name ?? "Viritura user");
        if (sessionId is not null)
        {
            identity.SetClaim(SessionClaim, sessionId);
        }
        var principal = new ClaimsPrincipal(identity);
        principal.SetScopes(request.GetScopes().Intersect(SupportedScopes));
        principal.SetResources(request.GetResources());
        principal.SetDestinations(static claim => claim.Type switch
        {
            Claims.Name => AccessTokenDestination,
            SessionClaim => AccessTokenDestination,
            _ => NoDestinations
        });

        return Results.SignIn(principal, authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
    }

    internal static async Task<IResult> ExchangeTokenAsync(HttpContext context)
    {
        var request = context.GetOpenIddictServerRequest();
        if (request?.IsAuthorizationCodeGrantType() != true)
        {
            return OAuthError(StatusCodes.Status400BadRequest, Errors.UnsupportedGrantType, "Only authorization_code is supported.");
        }

        var result = await context.AuthenticateAsync(OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
        if (!result.Succeeded || result.Principal is null)
        {
            return OAuthError(StatusCodes.Status400BadRequest, Errors.InvalidGrant, "The authorization code is invalid or expired.");
        }

        return Results.SignIn(
            result.Principal,
            authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
    }

    private static bool TryReadRedirectUris(
        JsonElement body,
        out ImmutableArray<Uri> redirectUris,
        out string error)
    {
        var builder = ImmutableArray.CreateBuilder<Uri>();
        if (!body.TryGetProperty("redirect_uris", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            redirectUris = [];
            error = "redirect_uris is required.";
            return false;
        }

        foreach (var value in values.EnumerateArray())
        {
            if (value.ValueKind != JsonValueKind.String
                || !Uri.TryCreate(value.GetString(), UriKind.Absolute, out var uri)
                || !IsSafeRedirectUri(uri))
            {
                redirectUris = [];
                error = "Redirect URIs must use HTTPS or loopback HTTP.";
                return false;
            }
            builder.Add(uri);
        }

        redirectUris = builder.ToImmutable();
        error = string.Empty;
        return redirectUris.Length is > 0 and <= 10;
    }

    private static bool IsSafeRedirectUri(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttps
        || (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback);

    private static bool TryParseMcpResource(
        HttpContext context,
        IWebHostEnvironment environment,
        string? resource,
        out string? sessionId,
        out bool isStaticResource)
    {
        sessionId = null;
        isStaticResource = false;
        if (!Uri.TryCreate(resource, UriKind.Absolute, out var uri)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            return false;
        }

        var expectedScheme = environment.IsDevelopment() ? context.Request.Scheme : "https";
        if (!string.Equals(uri.Scheme, expectedScheme, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.Authority, context.Request.Host.Value, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (string.Equals(uri.AbsolutePath.TrimEnd('/'), "/mcp", StringComparison.Ordinal))
        {
            isStaticResource = true;
            return true;
        }

        const string Marker = "/mcp/sessions/";
        if (!uri.AbsolutePath.StartsWith(Marker, StringComparison.Ordinal))
        {
            return false;
        }

        var candidate = uri.AbsolutePath[Marker.Length..].TrimEnd('/');
        if (string.IsNullOrEmpty(candidate) || candidate.Contains('/', StringComparison.Ordinal))
        {
            return false;
        }

        sessionId = candidate;
        return true;
    }

    private static IResult OAuthError(int statusCode, string error, string description) =>
        Results.Json(new { error, error_description = description }, statusCode: statusCode);
}