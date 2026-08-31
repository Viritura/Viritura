namespace Viritura.GitHub;

public sealed record GitHubProjectRef
{
    public GitHubProjectRef(string owner, string repo, string? branch, string? path)
    {
        Owner = NormalizeRequired(owner, nameof(owner));
        Repo = NormalizeRequired(repo, nameof(repo));
        Branch = string.IsNullOrWhiteSpace(branch) ? "main" : branch.Trim();
        Path = NormalizePath(path);
    }

    public string Owner { get; }

    public string Repo { get; }

    public string Branch { get; }

    public string Path { get; }

    public static string NormalizePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return string.Empty;
        }

        var normalized = path
            .Trim()
            .Replace('\\', '/')
            .Trim('/');

        if (string.IsNullOrWhiteSpace(normalized))
        {
            return string.Empty;
        }

        var segments = normalized
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToArray();

        if (segments.Any(static segment => segment is "." or ".."))
        {
            throw new ArgumentException("Project path cannot contain relative path segments.", nameof(path));
        }

        return string.Join('/', segments);
    }

    private static string NormalizeRequired(string value, string paramName)
    {
        var normalized = value?.Trim();

        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Value is required.", paramName);
        }

        return normalized;
    }
}