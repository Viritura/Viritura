namespace Viritura.GitHub;

public sealed record GitHubOAuthStateChallenge(
    string State,
    string CookieValue
);