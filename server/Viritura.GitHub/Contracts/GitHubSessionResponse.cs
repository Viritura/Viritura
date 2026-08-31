namespace Viritura.GitHub;

public sealed record GitHubSessionResponse(
    bool Connected,
    GitHubViewer? Viewer,
    DateTimeOffset? AccessTokenExpiresAtUtc,
    GitHubInstallationStatus? Installation
);