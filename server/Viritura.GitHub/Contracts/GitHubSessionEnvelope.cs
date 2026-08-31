namespace Viritura.GitHub;

public sealed record GitHubSessionEnvelope(
    GitHubTokenBundle TokenBundle,
    GitHubViewer Viewer,
    DateTimeOffset UpdatedAtUtc
);