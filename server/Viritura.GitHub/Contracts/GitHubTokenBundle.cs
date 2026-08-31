namespace Viritura.GitHub;

public sealed record GitHubTokenBundle(
    string AccessToken,
    string? RefreshToken,
    DateTimeOffset? ExpiresAtUtc,
    DateTimeOffset? RefreshTokenExpiresAtUtc,
    string TokenType,
    string Scope
);