using Viritura.Api;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class ProviderEmailPolicyTests
{
    [Theory]
    [InlineData("me@example.com", true)]
    [InlineData("me+tag@example.com", true)]
    [InlineData("ME@EXAMPLE.COM", true)]
    // Synthetic / provider-internal: must not be used as an auto-link key.
    [InlineData("12345+peteryangio@users.noreply.github.com", false)]
    [InlineData("peteryangio@users.noreply.github.com", false)]
    [InlineData("Anything@USERS.NOREPLY.GITHUB.COM", false)]
    [InlineData("foo@users.noreply.gitlab.com", false)]
    [InlineData("abc123@privaterelay.appleid.com", false)]
    // Malformed / empty: not auto-linkable, but must not throw.
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("no-at-sign", false)]
    [InlineData("trailing@", false)]
    public void IsAutoLinkable_Classifies(string? email, bool expected)
    {
        Assert.Equal(expected, ProviderEmailPolicy.IsAutoLinkable(email));
    }
}