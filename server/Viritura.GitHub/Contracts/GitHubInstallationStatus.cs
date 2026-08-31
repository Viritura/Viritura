namespace Viritura.GitHub;

public sealed record GitHubInstallationStatus(
    bool Installed,
    bool CanCreateRepositories,
    long? InstallationId,
    string? AccountLogin,
    string? AccountType,
    string? RepositorySelection,
    string? HtmlUrl,
    bool AdministrationWrite,
    bool Suspended
)
{
    public static GitHubInstallationStatus NotInstalled { get; } = new(
        false,
        false,
        null,
        null,
        null,
        null,
        null,
        false,
        false);
}