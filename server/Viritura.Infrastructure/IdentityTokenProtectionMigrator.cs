using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Viritura.Infrastructure;

internal sealed class IdentityTokenProtectionMigrator(
    IServiceScopeFactory scopeFactory,
    ILogger<IdentityTokenProtectionMigrator> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var database = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        var tokens = await database.Set<IdentityUserToken<string>>().ToListAsync(cancellationToken);
        if (tokens.Count == 0) return;

        foreach (var token in tokens)
        {
            // Force one write through the value converter. This transparently
            // upgrades legacy plaintext rows and rotates existing ciphertext.
            database.Entry(token).Property(entry => entry.Value).IsModified = true;
        }
        await database.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Protected {TokenCount} ASP.NET Identity token values at rest.", tokens.Count);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}