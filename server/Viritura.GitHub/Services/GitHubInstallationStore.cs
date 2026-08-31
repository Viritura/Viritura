using System.Globalization;

using Microsoft.EntityFrameworkCore;

using Viritura.Infrastructure;

namespace Viritura.GitHub;

/// <summary>
/// Encapsulates all reads and writes against <see cref="UserGitHubInstallation"/>. Tokens
/// (<c>AccessToken</c>, <c>RefreshToken</c>) are encrypted at rest via
/// <see cref="GitHubTokenProtector"/>; callers that consume the returned entity see plaintext.
/// To preserve that invariant, reads use <c>AsNoTracking()</c> so the decrypted instance is
/// detached and won't accidentally write plaintext back through the change tracker. Writes
/// re-fetch a tracked entity by id and assign ciphertext.
/// </summary>
public sealed class GitHubInstallationStore(
    VirituraDbContext db,
    TimeProvider timeProvider,
    GitHubTokenProtector tokenProtector) : IGitHubInstallationStore
{
    public async Task<UserGitHubInstallation?> FindAsync(string userId, CancellationToken cancellationToken = default)
    {
        var row = await db.UserGitHubInstallations
            .AsNoTracking()
            .Where(x => x.UserId == userId && x.LoginProvider == "GitHub")
            .OrderByDescending(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        return Decrypt(row);
    }

    public async Task<UserGitHubInstallation?> FindByProviderKeyAsync(string providerKey, CancellationToken cancellationToken = default)
    {
        var row = await db.UserGitHubInstallations
            .AsNoTracking()
            .Where(x => x.LoginProvider == "GitHub" && x.ProviderKey == providerKey)
            .FirstOrDefaultAsync(cancellationToken);
        return Decrypt(row);
    }

    public async Task UpsertAsync(string userId, GitHubSessionEnvelope session, CancellationToken cancellationToken = default)
    {
        var providerKey = session.Viewer.Id.ToString(CultureInfo.InvariantCulture);
        var existing = await db.UserGitHubInstallations
            .FirstOrDefaultAsync(x => x.LoginProvider == "GitHub" && x.ProviderKey == providerKey, cancellationToken);

        var now = timeProvider.GetUtcNow();

        if (existing is null)
        {
            db.UserGitHubInstallations.Add(new UserGitHubInstallation
            {
                UserId = userId,
                LoginProvider = "GitHub",
                ProviderKey = providerKey,
                Login = session.Viewer.Login,
                GitHubUserId = session.Viewer.Id,
                AvatarUrl = session.Viewer.AvatarUrl,
                AccessToken = tokenProtector.Protect(session.TokenBundle.AccessToken),
                RefreshToken = tokenProtector.ProtectOrNull(session.TokenBundle.RefreshToken),
                AccessTokenExpiresAtUtc = session.TokenBundle.ExpiresAtUtc,
                RefreshTokenExpiresAtUtc = session.TokenBundle.RefreshTokenExpiresAtUtc,
                TokenType = session.TokenBundle.TokenType,
                Scope = session.TokenBundle.Scope,
                CreatedAtUtc = now,
                UpdatedAtUtc = now
            });
        }
        else
        {
            existing.UserId = userId;
            existing.Login = session.Viewer.Login;
            existing.GitHubUserId = session.Viewer.Id;
            existing.AvatarUrl = session.Viewer.AvatarUrl;
            existing.AccessToken = tokenProtector.Protect(session.TokenBundle.AccessToken);
            existing.RefreshToken = tokenProtector.ProtectOrNull(session.TokenBundle.RefreshToken);
            existing.AccessTokenExpiresAtUtc = session.TokenBundle.ExpiresAtUtc;
            existing.RefreshTokenExpiresAtUtc = session.TokenBundle.RefreshTokenExpiresAtUtc;
            existing.TokenType = session.TokenBundle.TokenType;
            existing.Scope = session.TokenBundle.Scope;
            existing.UpdatedAtUtc = now;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task UpdateTokensAsync(int installationId, GitHubTokenBundle tokens, CancellationToken cancellationToken = default)
    {
        var existing = await db.UserGitHubInstallations.FindAsync([installationId], cancellationToken);
        if (existing is null)
        {
            return;
        }

        existing.AccessToken = tokenProtector.Protect(tokens.AccessToken);
        existing.RefreshToken = string.IsNullOrWhiteSpace(tokens.RefreshToken)
            ? existing.RefreshToken
            : tokenProtector.Protect(tokens.RefreshToken);
        existing.AccessTokenExpiresAtUtc = tokens.ExpiresAtUtc;
        existing.RefreshTokenExpiresAtUtc = tokens.RefreshTokenExpiresAtUtc ?? existing.RefreshTokenExpiresAtUtc;
        existing.TokenType = string.IsNullOrWhiteSpace(tokens.TokenType) ? existing.TokenType : tokens.TokenType;
        existing.Scope = string.IsNullOrWhiteSpace(tokens.Scope) ? existing.Scope : tokens.Scope;
        existing.UpdatedAtUtc = timeProvider.GetUtcNow();

        await db.SaveChangesAsync(cancellationToken);
    }

    private UserGitHubInstallation? Decrypt(UserGitHubInstallation? row)
    {
        if (row is null)
        {
            return null;
        }
        row.AccessToken = tokenProtector.Unprotect(row.AccessToken);
        row.RefreshToken = tokenProtector.UnprotectOrNull(row.RefreshToken);
        return row;
    }

    public async Task DeleteAsync(string userId, CancellationToken cancellationToken = default)
    {
        var rows = await db.UserGitHubInstallations
            .Where(x => x.UserId == userId && x.LoginProvider == "GitHub")
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            return;
        }

        db.UserGitHubInstallations.RemoveRange(rows);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<int> DeleteByGitHubAccountIdAsync(long gitHubAccountId, CancellationToken cancellationToken = default)
    {
        var rows = await db.UserGitHubInstallations
            .Where(x => x.LoginProvider == "GitHub" && x.GitHubUserId == gitHubAccountId)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            return 0;
        }

        db.UserGitHubInstallations.RemoveRange(rows);
        await db.SaveChangesAsync(cancellationToken);
        return rows.Count;
    }
}