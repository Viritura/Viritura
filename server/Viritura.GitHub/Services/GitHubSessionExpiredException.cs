namespace Viritura.GitHub;

public sealed class GitHubSessionExpiredException : Exception
{
    public GitHubSessionExpiredException()
    {
    }

    public GitHubSessionExpiredException(string message) : base(message)
    {
    }

    public GitHubSessionExpiredException(string message, Exception innerException) : base(message, innerException)
    {
    }
}