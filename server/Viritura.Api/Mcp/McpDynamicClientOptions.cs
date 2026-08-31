namespace Viritura.Api.Mcp;

/// <summary>
/// Configuration for the MCP dynamic client lifecycle and capacity limits.
/// Bind to the "Mcp" configuration section.
/// </summary>
internal sealed class McpDynamicClientOptions
{
    internal const string SectionName = "Mcp";

    /// <summary>
    /// Maximum number of dynamic MCP client registrations allowed in the database.
    /// Default 10,000. Set to 0 to block all dynamic registrations.
    /// </summary>
    public int MaxDynamicClients { get; set; } = McpOAuthEndpoint.DefaultMaxDynamicClients;

    /// <summary>
    /// How long an unactivated client (one that never received an authorization) is kept
    /// before being reclaimed. Default 1 hour. Must be positive.
    /// </summary>
    public TimeSpan UnactivatedClientLifetime { get; set; } = TimeSpan.FromHours(1);

    /// <summary>
    /// How long a client with no valid authorizations or non-expired tokens is kept before
    /// being reclaimed. Default 30 days. Must be greater than UnactivatedClientLifetime.
    /// </summary>
    public TimeSpan InactiveClientLifetime { get; set; } = TimeSpan.FromDays(30);

    /// <summary>
    /// How often the background pruning service runs. Default 30 minutes.
    /// </summary>
    public TimeSpan PruningInterval { get; set; } = TimeSpan.FromMinutes(30);
}