using Microsoft.AspNetCore.Identity;

namespace Viritura.Infrastructure;

public sealed class AppUser : IdentityUser
{
    public string? DisplayName { get; set; }

    public string? AvatarUrl { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}