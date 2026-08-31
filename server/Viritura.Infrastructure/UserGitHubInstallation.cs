using System.ComponentModel.DataAnnotations;

namespace Viritura.Infrastructure;

/// <summary>
/// Per-user GitHub user-to-server token + installation metadata.
/// One row per (UserId, LoginProvider, ProviderKey).
/// </summary>
public sealed class UserGitHubInstallation
{
    public int Id { get; set; }

    [Required, MaxLength(450)]
    public string UserId { get; set; } = string.Empty;

    public AppUser? User { get; set; }

    [Required, MaxLength(64)]
    public string LoginProvider { get; set; } = "GitHub";

    [Required, MaxLength(128)]
    public string ProviderKey { get; set; } = string.Empty;

    [MaxLength(128)]
    public string? Login { get; set; }

    public long? GitHubUserId { get; set; }

    [MaxLength(2048)]
    public string? AvatarUrl { get; set; }

    [Required]
    public string AccessToken { get; set; } = string.Empty;

    public string? RefreshToken { get; set; }

    public DateTimeOffset? AccessTokenExpiresAtUtc { get; set; }

    public DateTimeOffset? RefreshTokenExpiresAtUtc { get; set; }

    [MaxLength(64)]
    public string TokenType { get; set; } = "bearer";

    [MaxLength(512)]
    public string? Scope { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}