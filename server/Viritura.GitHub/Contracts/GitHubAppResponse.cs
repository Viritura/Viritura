namespace Viritura.GitHub;

public sealed record GitHubAppResponse(
    bool Configured,
    string? AppSlug,
    string? ClientId,
    string? InstallUrl
);