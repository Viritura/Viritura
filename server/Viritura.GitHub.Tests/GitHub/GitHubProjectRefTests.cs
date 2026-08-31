using Viritura.GitHub;

using Xunit;

namespace Viritura.GitHub.Tests.GitHub;

public sealed class GitHubProjectRefTests
{
    [Fact]
    public void Ctor_NormalizesPathAndDefaultsBranch()
    {
        var projectRef = new GitHubProjectRef(" PeterYangIO ", " Viritura ", null, "\\scores//suite-1///draft.mnx/");

        Assert.Equal("PeterYangIO", projectRef.Owner);
        Assert.Equal("Viritura", projectRef.Repo);
        Assert.Equal("main", projectRef.Branch);
        Assert.Equal("scores/suite-1/draft.mnx", projectRef.Path);
    }

    [Fact]
    public void NormalizePath_RejectsRelativeTraversal()
    {
        Assert.Throws<ArgumentException>(() => GitHubProjectRef.NormalizePath("scores/../draft.mnx"));
    }
}