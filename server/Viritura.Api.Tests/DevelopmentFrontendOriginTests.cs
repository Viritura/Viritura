using Viritura.Api;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class DevelopmentFrontendOriginTests
{
    [Theory]
    [InlineData("http://editor.feature-auth-a1b2.viritura.localhost")]
    [InlineData("http://web.feature-auth-a1b2.viritura.localhost")]
    public void WorktreeFrontend_AcceptsRoutedDevelopmentOrigin(string origin)
    {
        Assert.True(DevelopmentFrontendOrigin.IsWorktreeFrontend(new Uri(origin)));
    }

    [Theory]
    [InlineData("https://editor.feature-auth-a1b2.viritura.localhost")]
    [InlineData("http://editor.feature-auth-a1b2.viritura.localhost:5173")]
    [InlineData("http://editor.localhost")]
    [InlineData("http://editor.feature-auth-a1b2.localhost")]
    [InlineData("http://attacker-editor.feature-auth-a1b2.viritura.localhost")]
    [InlineData("http://editor.feature-auth-a1b2.viritura.localhost.example.com")]
    public void WorktreeFrontend_RejectsOriginsOutsideExactDevelopmentPattern(string origin)
    {
        Assert.False(DevelopmentFrontendOrigin.IsWorktreeFrontend(new Uri(origin)));
    }

    [Fact]
    public void WorktreeEditor_RejectsWebsiteOrigin()
    {
        Assert.False(DevelopmentFrontendOrigin.IsWorktreeEditor(
            new Uri("http://web.feature-auth-a1b2.viritura.localhost")));
    }
}