namespace Viritura.GitHub;

public sealed record GitHubViewer(
    long Id,
    string Login,
    string? Name,
    string? AvatarUrl,
    string? Email = null
);