using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.RateLimiting;

using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;

using OpenIddict.Abstractions;
using OpenIddict.Server;

using Viritura.Api;
using Viritura.Api.Contracts.Auth;
using Viritura.Api.Mcp;
using Viritura.Api.Signaling;
using Viritura.GitHub;
using Viritura.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

builder.Services
    .AddOptions<AuthFeatureOptions>()
    .Bind(builder.Configuration.GetSection(AuthFeatureOptions.SectionName))
    .ValidateOnStart();

// Suppress the Kestrel "Server: Kestrel" banner. SecurityHeadersMiddleware also
// strips it defensively, but configuring Kestrel directly avoids ever emitting it.
builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = 256 * 1024;
});

builder.Services.Configure<ForwardedHeadersOptions>(options =>
    ForwardedHeadersConfiguration.Configure(options, builder.Configuration));

builder.Services.AddVirituraInfrastructure(builder.Configuration, builder.Environment);
builder.Services.AddVirituraGitHub(builder.Configuration);

builder.Services.AddOpenIddict()
    .AddCore(options =>
    {
        options.UseEntityFrameworkCore()
            .UseDbContext<VirituraDbContext>();
    })
    .AddServer(options =>
    {
        if (!builder.Environment.IsDevelopment())
        {
            options.SetIssuer(new Uri(
                builder.Configuration["OAuth:Issuer"] ?? "https://api.viritura.com"));
        }
        options.SetAuthorizationEndpointUris("/oauth/authorize")
            .SetTokenEndpointUris("/oauth/token")
            .SetRevocationEndpointUris("/oauth/revoke");
        options.AllowAuthorizationCodeFlow();
        options.RequireProofKeyForCodeExchange();
        // MCP resources are ephemeral /mcp/sessions/{id} URLs and cannot be
        // pre-seeded in OpenIddict's resource store. McpOAuthEndpoint validates
        // their existence, expiry, and owner before issuing an authorization.
        options.DisableResourceValidation();
        options.IgnoreResourcePermissions();
        options.RegisterScopes("score:read", "selection:read", "score:propose");
        options.UseReferenceAccessTokens();
        options.SetAccessTokenLifetime(TimeSpan.FromHours(1));
        options.UseDataProtection();
        options.AddEventHandler<OpenIddictServerEvents.ApplyConfigurationResponseContext>(builder =>
            builder.UseInlineHandler(context =>
            {
                var issuer = context.Transaction.Options.Issuer ?? context.Transaction.BaseUri!;
                context.Response["authorization_endpoint"] = new OpenIddictParameter(
                    new Uri(issuer, "/oauth/authorize").AbsoluteUri);
                context.Response["token_endpoint"] = new OpenIddictParameter(
                    new Uri(issuer, "/oauth/token").AbsoluteUri);
                context.Response["revocation_endpoint"] = new OpenIddictParameter(
                    new Uri(issuer, "/oauth/revoke").AbsoluteUri);
                context.Response["jwks_uri"] = new OpenIddictParameter(
                    new Uri(issuer, "/.well-known/jwks").AbsoluteUri);
                context.Response["registration_endpoint"] = new OpenIddictParameter(
                    new Uri(issuer, "/oauth/register").AbsoluteUri);
                context.Response["code_challenge_methods_supported"] = new OpenIddictParameter(
                    JsonSerializer.SerializeToElement(new[] { OpenIddictConstants.CodeChallengeMethods.Sha256 }));
                return default;
            }));
        // OAuth artifacts use the same persisted Data Protection ring as the
        // Viritura session cookie. Ephemeral protocol credentials satisfy
        // OpenIddict's metadata requirements but never carry token payloads.
        options.AddEphemeralEncryptionKey()
            .AddEphemeralSigningKey();
        options.UseAspNetCore()
            // Public TLS terminates at the host nginx process. Kestrel is
            // reachable only through its loopback-published container port.
            .DisableTransportSecurityRequirement()
            .EnableAuthorizationEndpointPassthrough()
            .EnableTokenEndpointPassthrough()
            .EnableStatusCodePagesIntegration();
    })
    .AddValidation(options =>
    {
        options.UseLocalServer();
        options.UseDataProtection();
        options.UseAspNetCore();
    });

var authBuilder = builder.Services
    .AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddCookie(IdentityConstants.ApplicationScheme, options =>
    {
        options.Cookie.Name = "viritura.sid";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.IsEssential = true;
        options.ExpireTimeSpan = TimeSpan.FromDays(14);
        options.SlidingExpiration = true;
        options.LoginPath = PathString.Empty;
        options.AccessDeniedPath = PathString.Empty;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    })
    .AddCookie(IdentityConstants.ExternalScheme, options =>
    {
        options.Cookie.Name = "viritura.ext";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.None;
        options.Cookie.IsEssential = true;
        options.ExpireTimeSpan = TimeSpan.FromMinutes(10);
    })
    .AddCookie(IdentityConstants.TwoFactorUserIdScheme, options =>
    {
        options.Cookie.Name = "viritura.2fa.uid";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.IsEssential = true;
        options.ExpireTimeSpan = TimeSpan.FromMinutes(10);
    })
    .AddCookie(IdentityConstants.TwoFactorRememberMeScheme, options =>
    {
        options.Cookie.Name = "viritura.2fa.rem";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.IsEssential = true;
        options.ExpireTimeSpan = TimeSpan.FromDays(30);
    });

var googleClientId = builder.Configuration["Authentication:Google:ClientId"];
var googleClientSecret = builder.Configuration["Authentication:Google:ClientSecret"];
var authFeatures = builder.Configuration
    .GetSection(AuthFeatureOptions.SectionName)
    .Get<AuthFeatureOptions>() ?? new AuthFeatureOptions();
if (authFeatures.GoogleLoginEnabled
    && !string.IsNullOrWhiteSpace(googleClientId)
    && !string.IsNullOrWhiteSpace(googleClientSecret))
{
    authBuilder.AddGoogle(GoogleDefaults.AuthenticationScheme, options =>
    {
        options.ClientId = googleClientId;
        options.ClientSecret = googleClientSecret;
        options.SignInScheme = IdentityConstants.ExternalScheme;
        options.CallbackPath = "/signin-google";
        options.SaveTokens = true;
        // Surface Google's `email_verified` claim so the callback can refuse to auto-link
        // an unverified address (ProviderEmailPolicy + ExternalAuthController).
        options.ClaimActions.MapJsonKey("urn:google:email_verified", "email_verified", "boolean");
        // Surface the profile picture so the account UI / live cursor avatars can render it.
        // Google's `picture` URL is hot-linkable and reasonably stable; AppUser.AvatarUrl
        // captures the value at sign-in time and is refreshed on every subsequent callback.
        options.ClaimActions.MapJsonKey("urn:google:picture", "picture");
    });
}

var configuredOrigins = builder.Configuration.GetSection("Viritura:GitHub:AllowedFrontendOrigins").Get<string[]>() ?? [];
var gitHubOptions = builder.Configuration.GetSection(GitHubAuthOptions.SectionName).Get<GitHubAuthOptions>() ?? new GitHubAuthOptions();
var builtInOrigins = builder.Environment.IsDevelopment()
    ? new[]
    {
        "https://app.viritura.com",
        "https://viritura.com",
        "http://localhost:5173",
        "https://localhost:5173",
        "http://localhost:4173",
        "https://localhost:4173",
        // Marketing site dev server (apps/website, vite port 5180). Hosts /signup + /auth/verify.
        "http://localhost:5180",
        "https://localhost:5180"
    }
    :
    [
        "https://app.viritura.com",
        "https://viritura.com"
    ];

if (!builder.Environment.IsDevelopment())
{
    GitHubSecurityOptionsValidator.ValidateProductionOrigins(gitHubOptions, configuredOrigins);
}

var allowedOrigins = configuredOrigins
    .Concat(builtInOrigins)
    .Where(origin => builder.Environment.IsDevelopment() || !IsLocalhostOrigin(origin))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();
var editorOrigins = allowedOrigins
    .Where(origin => !origin.Equals("https://viritura.com", StringComparison.OrdinalIgnoreCase))
    .Where(origin => !origin.Equals("http://localhost:5180", StringComparison.OrdinalIgnoreCase))
    .Where(origin => !origin.Equals("https://localhost:5180", StringComparison.OrdinalIgnoreCase))
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy("VirituraFrontends", policy =>
    {
        policy
            .WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
    options.AddPolicy("VirituraEditor", policy =>
    {
        policy
            .WithOrigins(editorOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

builder.Services.AddSingleton(new FrontendOriginPolicy(allowedOrigins));
builder.Services.Configure<RecentAuthOptions>(builder.Configuration.GetSection("Auth:RecentAuth"));
builder.Services.AddSingleton<RecentAuthService>();
builder.Services.AddSingleton<PasswordTimingProtector>();
builder.Services.AddSingleton<WebhookDeliveryDeduplicator>();
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddScoped<IAuthEmailDispatcher, InlineAuthEmailDispatcher>();
}
else
{
    builder.Services.AddSingleton<QueuedAuthEmailDispatcher>();
    builder.Services.AddSingleton<IAuthEmailDispatcher>(services =>
        services.GetRequiredService<QueuedAuthEmailDispatcher>());
    builder.Services.AddHostedService(services =>
        services.GetRequiredService<QueuedAuthEmailDispatcher>());
}
builder.Services.AddSingleton<EmailLoginRateLimiter>(_ =>
    new EmailLoginRateLimiter(
        permitsPerMinute: builder.Configuration.GetValue(
            "RateLimits:LoginByEmailPerMinute",
            EmailLoginRateLimiter.DefaultPermitsPerMinute)));
builder.Services.AddSingleton<PasswordResetEmailThrottle>(_ =>
    new PasswordResetEmailThrottle(
        permitsPerHour: builder.Configuration.GetValue(
            "RateLimits:PasswordResetEmailsPerEmailPerHour",
            PasswordResetEmailThrottle.DefaultPermitsPerHour)));
builder.Services.AddSingleton<VerificationEmailThrottle>(_ =>
    new VerificationEmailThrottle(
        permitsPerHour: builder.Configuration.GetValue(
            "RateLimits:VerificationEmailsPerEmailPerHour",
            VerificationEmailThrottle.DefaultPermitsPerHour)));
builder.Services.AddSingleton<TwoFactorRecoveryEmailThrottle>(_ =>
    new TwoFactorRecoveryEmailThrottle(
        permitsPerHour: builder.Configuration.GetValue(
            "RateLimits:TwoFactorRecoveryEmailsPerEmailPerHour",
            TwoFactorRecoveryEmailThrottle.DefaultPermitsPerHour)));

builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(GetRateLimitPartitionKey(context), _ => new FixedWindowRateLimiterOptions
        {
            AutoReplenishment = true,
            PermitLimit = 600,
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            Window = TimeSpan.FromMinutes(1)
        }));
    options.AddPolicy("Auth", context => CreateFixedWindowPartition(context, permitLimit: 30));
    options.AddPolicy("GitHubAuth", context => CreateFixedWindowPartition(context, permitLimit: 30));
    options.AddPolicy("GitHubSession", context => CreateFixedWindowPartition(context, permitLimit: 120));
    options.AddPolicy("GitHubRepository", context => CreateFixedWindowPartition(context, permitLimit: 20));
    options.AddPolicy("GitHubGitProxy", context => CreateFixedWindowPartition(context, permitLimit: 60));

    // Live-collab DoS caps. Snapshot reads are higher than writes because a popular
    // room can be opened by many guests in a short window; writes are throttled tightly
    // because each one allocates and persists a multi-MB blob in the in-process store.
    // Signaling handshake is the WebSocket *upgrade* request only — once a connection
    // is established it pays the per-connection message-rate cap inside SignalingHub.
    options.AddPolicy("LiveSnapshotPut", context => CreateFixedWindowPartition(context, permitLimit: 12));
    options.AddPolicy("LiveSnapshotGet", context => CreateFixedWindowPartition(context, permitLimit: 120));
    options.AddPolicy("LiveSignalingHandshake", context => CreateFixedWindowPartition(context, permitLimit: 30));
    options.AddPolicy("McpSessionCreate", context => CreateFixedWindowPartition(context, permitLimit: 30));
    options.AddPolicy("McpRequest", context => CreateFixedWindowPartition(context, permitLimit: 120));
    options.AddPolicy("McpOAuthRegistration", context => CreateFixedWindowPartition(context, permitLimit: 20));

    // Brute-force defence for the two endpoints behind the 2FA partial-auth cookie
    // (/auth/login/2fa, /auth/login/recovery). Partitioning by client IP would let one
    // attacker burn another user's quota; partitioning by user id requires asynchronously
    // unsealing the partial cookie, which the rate-limiter pipeline can't do. We partition
    // by a hash of the encrypted partial-cookie value instead: it's unique per partial-auth
    // session (so per-victim), opaque to the attacker, and trivially cheap to derive. If the
    // cookie is missing we fall back to the IP partition — that case is the controller
    // returning 401 immediately anyway, so the limit just bounds noise.
    options.AddPolicy("TwoFactorAttempt", context =>
        RateLimitPartition.GetFixedWindowLimiter(GetTwoFactorPartitionKey(context), _ => new FixedWindowRateLimiterOptions
        {
            AutoReplenishment = true,
            PermitLimit = 10,
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            Window = TimeSpan.FromMinutes(10)
        }));
});
builder.Services.AddSingleton<SignalingHub>();
builder.Services.AddSingleton<IActiveRoomQuery>(sp => sp.GetRequiredService<SignalingHub>());
builder.Services.Configure<SignalingHubOptions>(builder.Configuration.GetSection("Signaling:Hub"));
// In-process room snapshot store — late joiners pull the most recent
// Y.Doc encoded state from here so the initial sync isn't gated by the
// WebRTC SCTP 256 KB message cap. See RoomSnapshotStore.cs for rationale.
builder.Services.AddSingleton<IRoomSnapshotStore, InMemoryRoomSnapshotStore>();
builder.Services.Configure<RoomSnapshotStoreOptions>(builder.Configuration.GetSection("Signaling:Snapshots"));
builder.Services.AddSingleton<SnapshotTransferLimiter>();
builder.Services.AddHostedService<RoomSnapshotIdleSweeper>();
builder.Services.AddSingleton<McpSessionRegistry>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services
    .AddOptions<McpDynamicClientOptions>()
    .Bind(builder.Configuration.GetSection(McpDynamicClientOptions.SectionName));
builder.Services.AddSingleton<DynamicClientPruningService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<DynamicClientPruningService>());
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-XSRF-TOKEN";
    options.Cookie.Name = "viritura.antiforgery";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.IsEssential = true;
});
// Built-in OpenAPI document generation (Microsoft.AspNetCore.OpenApi, ships with .NET 9+).
// Replaces Swashbuckle.AspNetCore. The JSON document is served from /openapi/v1.json in
// development; paste into editor.swagger.io or a Scalar/Redoc viewer if a UI is needed.
builder.Services.AddOpenApi();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// One production instance owns the SQLite file. Applying idempotent EF
// migrations before accepting traffic keeps first deploys and upgrades atomic.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
    await db.Database.MigrateAsync();
    await DevelopmentTestAccountSeeder.SeedAsync(scope.ServiceProvider);
}

app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}
app.UseVirituraSecurityHeaders(app.Environment);
var serverUiDist = Path.GetFullPath(
    Path.Combine(app.Environment.ContentRootPath, "..", "..", "apps", "server-ui", "dist"));
if (Directory.Exists(serverUiDist))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(serverUiDist),
        RequestPath = "/server-ui"
    });
}
app.UseStaticFiles();
app.UseRouting();
app.UseCors();
app.UseRateLimiter();
app.UseWebSockets(new WebSocketOptions
{
    // 90s matches y-webrtc's client-side ping cadence (30s) with margin
    // for slow networks; the hub also pumps its own protocol-level pings.
    KeepAliveInterval = TimeSpan.FromSeconds(90)
});
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();
app.MapControllers();

// y-webrtc–compatible signaling relay. Anonymous — the room id in the
// subscribe message IS the capability token (matches the rest of the
// live-collab model where the share link is the capability).
app.Map("/live/signal", async (HttpContext context, SignalingHub hub, FrontendOriginPolicy origins) =>
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

    var sourceIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    if (!hub.TryAcquireConnection(sourceIp))
    {
        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        return;
    }

    try
    {
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        await hub.HandleAsync(socket, context.RequestAborted);
    }
    finally
    {
        hub.ReleaseConnection(sourceIp);
    }
}).RequireRateLimiting("LiveSignalingHandshake");

// Room snapshot endpoints — out-of-band initial-state delivery for live
// collab. See Signaling/SnapshotEndpoint.cs and Signaling/RoomSnapshotStore.cs.
app.MapGet("/live/room/{roomId}/snapshot", SnapshotEndpoint.Get)
    .RequireCors("VirituraEditor")
    .RequireRateLimiting("LiveSnapshotGet");
app.MapPut("/live/room/{roomId}/snapshot", SnapshotEndpoint.PutAsync)
    .WithMetadata(new RequestSizeLimitAttribute(SnapshotEndpoint.MaxSnapshotBytes))
    .RequireCors("VirituraEditor")
    .RequireRateLimiting("LiveSnapshotPut");

// Browser-hosted MCP relay. The opaque session URL is the client capability;
// the separately returned host token proves that a browser owns the session.
// Score state remains in the tab and all tool calls cross the host WebSocket.
app.MapPost("/mcp/sessions", McpEndpoint.Register)
    .RequireCors("VirituraEditor")
    .RequireRateLimiting("McpSessionCreate");
app.MapMethods("/mcp/sessions/{sessionId}/host", [HttpMethods.Get, HttpMethods.Connect], McpEndpoint.HandleHostAsync)
    .RequireRateLimiting("McpSessionCreate");
app.MapDelete("/mcp/sessions/{sessionId}/host", McpEndpoint.StopHost)
    .RequireCors("VirituraEditor")
    .RequireRateLimiting("McpSessionCreate");
app.MapPost("/mcp/sessions/{sessionId}", McpEndpoint.HandleMcpAsync)
    .WithMetadata(new RequestSizeLimitAttribute(256 * 1024))
    .RequireRateLimiting("McpRequest");
app.MapDelete("/mcp/sessions/{sessionId}", McpEndpoint.StopClient)
    .RequireRateLimiting("McpRequest");
app.MapPost("/mcp", McpEndpoint.HandleStaticMcpAsync)
    .WithMetadata(new RequestSizeLimitAttribute(256 * 1024))
    .RequireRateLimiting("McpRequest");
app.MapDelete("/mcp", (Delegate)McpEndpoint.StopStaticClient)
    .RequireRateLimiting("McpRequest");

// MCP OAuth 2.1 discovery + Authorization Code/PKCE. Native clients register
// loopback/HTTPS redirect URIs, open /oauth/authorize in the system browser,
// and receive their access token directly from /oauth/token.
app.MapGet(
    "/.well-known/oauth-protected-resource/mcp/sessions/{sessionId}",
    McpOAuthEndpoint.ProtectedResourceMetadata)
    .RequireRateLimiting("McpRequest");
app.MapGet(
    "/.well-known/oauth-protected-resource/mcp",
    McpOAuthEndpoint.StaticProtectedResourceMetadata)
    .RequireRateLimiting("McpRequest");
app.MapGet("/.well-known/oauth-authorization-server", McpOAuthEndpoint.AuthorizationServerMetadata)
    .RequireRateLimiting("McpRequest");
app.MapPost("/oauth/register", McpOAuthEndpoint.RegisterClientAsync)
    .RequireRateLimiting("McpOAuthRegistration");
app.MapMethods("/oauth/authorize", [HttpMethods.Get, HttpMethods.Post], McpOAuthEndpoint.AuthorizeAsync)
    .RequireRateLimiting("McpRequest");
app.MapPost("/oauth/token", (Delegate)McpOAuthEndpoint.ExchangeTokenAsync)
    .RequireRateLimiting("McpRequest");
app.MapPost("/oauth/revoke", static () => Results.NotFound())
    .RequireRateLimiting("McpRequest");

await app.RunAsync();

static bool IsLocalhostOrigin(string origin)
{
    return Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
        (uri.IsLoopback || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase));
}

static string GetRateLimitPartitionKey(HttpContext context) =>
    context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

static RateLimitPartition<string> CreateFixedWindowPartition(HttpContext context, int permitLimit) =>
    RateLimitPartition.GetFixedWindowLimiter(GetRateLimitPartitionKey(context), _ => new FixedWindowRateLimiterOptions
    {
        AutoReplenishment = true,
        PermitLimit = permitLimit,
        QueueLimit = 0,
        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
        Window = TimeSpan.FromMinutes(1)
    });

/// <summary>
/// Partition key for the <c>TwoFactorAttempt</c> rate-limit policy. Returns a 128-bit hash of
/// the Identity 2FA partial-auth cookie value, prefixed with <c>2fa:</c>. Hashing keeps the
/// session-bound encrypted blob out of the limiter's in-memory partition table. Falls back to
/// <c>ip:</c>-prefixed remote address if the cookie isn't present so the limiter still partitions
/// off-flow requests instead of collapsing them all into one bucket.
/// </summary>
static string GetTwoFactorPartitionKey(HttpContext context)
{
    // Cookie name matches the customized 2FA partial-auth cookie configured above
    // (.AddCookie(IdentityConstants.TwoFactorUserIdScheme, options => options.Cookie.Name = ...)).
    const string TwoFactorUserIdCookieName = "viritura.2fa.uid";
    var cookieValue = context.Request.Cookies[TwoFactorUserIdCookieName];
    if (string.IsNullOrEmpty(cookieValue))
    {
        return "ip:" + GetRateLimitPartitionKey(context);
    }
    var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(cookieValue));
    return "2fa:" + Convert.ToHexString(bytes, 0, 16);
}

public partial class Program;