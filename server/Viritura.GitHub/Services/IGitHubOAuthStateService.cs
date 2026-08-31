namespace Viritura.GitHub;

public interface IGitHubOAuthStateService
{
    GitHubOAuthStateChallenge CreateChallenge(string? returnTo);

    bool TryValidate(string state, string? cookieValue, out string returnTo);
}