namespace Viritura.GitHub;

public sealed record GitHubCreateRepository(
    string Name,
    string? Description,
    bool Private,
    bool AutoInit);

public sealed record GitHubCreatedRepository(
    long Id,
    string Name,
    string FullName,
    string HtmlUrl,
    string CloneUrl,
    bool Private,
    string DefaultBranch);