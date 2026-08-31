using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Viritura.Infrastructure;

public class VirituraDbContext(
    DbContextOptions<VirituraDbContext> options,
    IDataProtectionProvider dataProtectionProvider)
    : IdentityDbContext<AppUser>(options)
{
    private const string ProtectedTokenPrefix = "dp:v1:";
    private readonly IDataProtector _tokenProtector = dataProtectionProvider.CreateProtector(
        "Viritura.Infrastructure.IdentityUserToken.Value.v1");

    public DbSet<McpDynamicClientLifecycle> McpDynamicClients => Set<McpDynamicClientLifecycle>();
    public DbSet<UserGitHubInstallation> UserGitHubInstallations => Set<UserGitHubInstallation>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.UseOpenIddict();

        // Identity stores authenticator keys and recovery-code material in
        // AspNetUserTokens. Encrypt every token value so a database-only theft
        // does not also disclose the account's second factor.
        builder.Entity<IdentityUserToken<string>>()
            .Property(token => token.Value)
            .HasConversion(
                value => ProtectToken(value),
                value => UnprotectToken(value));

        builder.Entity<McpDynamicClientLifecycle>(entity =>
        {
            entity.HasKey(x => x.ClientId);
            entity.HasIndex(x => x.CreatedAt);
        });

        builder.Entity<UserGitHubInstallation>(entity =>
        {
            entity.HasIndex(x => new { x.LoginProvider, x.ProviderKey }).IsUnique();
            entity.HasIndex(x => x.UserId);
            entity.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private string? ProtectToken(string? value) =>
        value is null
            ? null
            : value.StartsWith(ProtectedTokenPrefix, StringComparison.Ordinal)
                ? value
                : ProtectedTokenPrefix + _tokenProtector.Protect(value);

    private string? UnprotectToken(string? value) =>
        value is null
            ? null
            : value.StartsWith(ProtectedTokenPrefix, StringComparison.Ordinal)
                ? _tokenProtector.Unprotect(value[ProtectedTokenPrefix.Length..])
                : value;
}