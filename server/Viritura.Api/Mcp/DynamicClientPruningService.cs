using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

using OpenIddict.Abstractions;
using OpenIddict.EntityFrameworkCore.Models;

using Viritura.Infrastructure;

namespace Viritura.Api.Mcp;

/// <summary>
/// Background service that periodically prunes stale dynamic MCP OAuth client registrations
/// so they do not permanently consume capacity against the client cap.
///
/// Two categories are reclaimed:
/// - Unactivated: clients that never received an authorization, older than UnactivatedClientLifetime.
///   Typical of registration requests abandoned before completing the OAuth flow.
/// - Inactive: clients whose every authorization is in a terminal state (no valid auth or live token),
///   older than InactiveClientLifetime. Clients used historically whose tokens all expired or revoked.
///
/// Clients with at least one valid authorization or a non-expired access token are never pruned.
/// Deletion is performed through IOpenIddictApplicationManager so the EF Core store handles cascade
/// (ClientSetNull) cleanup of related authorizations and tokens correctly.
/// </summary>
internal sealed class DynamicClientPruningService(
    IServiceScopeFactory scopeFactory,
    IOptionsMonitor<McpDynamicClientOptions> optionsMonitor,
    ILogger<DynamicClientPruningService> logger)
    : BackgroundService
{
    private const int BatchSize = 500;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Yield so host startup is not blocked waiting for the first pruning tick.
        await Task.Yield();

        using var timer = new PeriodicTimer(optionsMonitor.CurrentValue.PruningInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await PruneAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                throw;
            }
#pragma warning disable CA1031 // -- background loop must absorb infrastructure faults to keep the host alive
            catch (Exception ex)
#pragma warning restore CA1031
            {
                logger.LogError(ex, "Dynamic MCP client pruning failed; will retry next interval.");
            }
        }
    }

    /// <summary>
    /// Runs one pruning pass. Called by the background loop and exposed internally for direct
    /// invocation in tests without waiting for the timer interval.
    /// </summary>
    internal async Task PruneAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        var manager = scope.ServiceProvider.GetRequiredService<IOpenIddictApplicationManager>();
        var opts = optionsMonitor.CurrentValue;
        var utcNow = DateTime.UtcNow;

        var unactivated = await PruneUnactivatedAsync(db, manager, opts, utcNow, cancellationToken);
        var inactive = await PruneInactiveAsync(db, manager, opts, utcNow, cancellationToken);

        if (unactivated + inactive > 0)
        {
            logger.LogInformation(
                "Pruned {Unactivated} unactivated and {Inactive} inactive dynamic MCP client registrations.",
                unactivated,
                inactive);
        }
    }

    // Removes clients registered but never activated (no authorization row at all).
    // Uses the OpenIddict Application navigation property on Authorization to avoid touching
    // the EF Core shadow property "ApplicationId" directly.
    private static async Task<int> PruneUnactivatedAsync(
        VirituraDbContext db,
        IOpenIddictApplicationManager manager,
        McpDynamicClientOptions opts,
        DateTime utcNow,
        CancellationToken ct)
    {
        var cutoff = utcNow - opts.UnactivatedClientLifetime;

        var clientIds = await (
            from mc in db.McpDynamicClients
            where mc.CreatedAt < cutoff
            join app in db.Set<OpenIddictEntityFrameworkCoreApplication>()
                on mc.ClientId equals app.ClientId into apps
            from app in apps.DefaultIfEmpty()
            where app == null
                || !db.Set<OpenIddictEntityFrameworkCoreAuthorization>()
                    .Any(a => a.Application!.ClientId == mc.ClientId)
            select mc.ClientId)
            .Take(BatchSize)
            .ToListAsync(ct);

        return await DeleteClientBatchAsync(db, manager, clientIds, ct);
    }

    // Removes clients that have only terminal authorizations (no valid auth, no live token).
    private static async Task<int> PruneInactiveAsync(
        VirituraDbContext db,
        IOpenIddictApplicationManager manager,
        McpDynamicClientOptions opts,
        DateTime utcNow,
        CancellationToken ct)
    {
        var cutoff = utcNow - opts.InactiveClientLifetime;

        var clientIds = await (
            from mc in db.McpDynamicClients
            where mc.CreatedAt < cutoff
            join app in db.Set<OpenIddictEntityFrameworkCoreApplication>()
                on mc.ClientId equals app.ClientId
            where !db.Set<OpenIddictEntityFrameworkCoreAuthorization>()
                      .Any(a => a.Application!.ClientId == mc.ClientId
                             && a.Status == OpenIddictConstants.Statuses.Valid)
               && !db.Set<OpenIddictEntityFrameworkCoreToken>()
                      .Any(t => t.Application!.ClientId == mc.ClientId
                             && t.Status == OpenIddictConstants.Statuses.Valid
                             && t.ExpirationDate > utcNow)
            select mc.ClientId)
            .Take(BatchSize)
            .ToListAsync(ct);

        return await DeleteClientBatchAsync(db, manager, clientIds, ct);
    }

    private static async Task<int> DeleteClientBatchAsync(
        VirituraDbContext db,
        IOpenIddictApplicationManager manager,
        IReadOnlyList<string> clientIds,
        CancellationToken ct)
    {
        var deleted = 0;
        foreach (var clientId in clientIds)
        {
            var app = await manager.FindByClientIdAsync(clientId, ct);
            if (app is not null)
            {
                // DeleteAsync nulls ApplicationId on related authorizations/tokens (EF Core
                // ClientSetNull behavior) before deleting the application row.
                await manager.DeleteAsync(app, ct);
            }

            var mc = await db.McpDynamicClients.FindAsync([clientId], ct);
            if (mc is not null)
            {
                db.McpDynamicClients.Remove(mc);
                await db.SaveChangesAsync(ct);
            }

            deleted++;
        }
        return deleted;
    }
}