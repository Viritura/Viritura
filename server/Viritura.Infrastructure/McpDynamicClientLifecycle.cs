namespace Viritura.Infrastructure;

/// <summary>
/// Lifecycle record for a dynamically registered MCP OAuth client.
/// Persisted separately from the OpenIddict application table so the
/// pruning service can query by creation age without touching the
/// OpenIddict schema.
/// </summary>
public class McpDynamicClientLifecycle
{
    public required string ClientId { get; set; }
    public required DateTime CreatedAt { get; set; }
}