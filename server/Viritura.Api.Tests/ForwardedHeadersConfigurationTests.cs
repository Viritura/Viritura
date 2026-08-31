using System.Net;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;

using Viritura.Api;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class ForwardedHeadersConfigurationTests
{
    [Fact]
    public void Configure_RejectsTrustAll()
    {
        var configuration = Configuration(new Dictionary<string, string?>
        {
            ["ForwardedHeaders:TrustAll"] = "true"
        });

        var error = Assert.Throws<InvalidOperationException>(() =>
            ForwardedHeadersConfiguration.Configure(new ForwardedHeadersOptions(), configuration));

        Assert.Contains("KnownProxies", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Configure_AcceptsExactProxiesAndNetworks()
    {
        var configuration = Configuration(new Dictionary<string, string?>
        {
            ["ForwardedHeaders:KnownProxies:0"] = "192.0.2.10",
            ["ForwardedHeaders:KnownNetworks:0"] = "172.16.0.0/12"
        });
        var options = new ForwardedHeadersOptions();

        ForwardedHeadersConfiguration.Configure(options, configuration);

        Assert.Equal(1, options.ForwardLimit);
        Assert.Contains(IPAddress.Parse("192.0.2.10"), options.KnownProxies);
        Assert.Contains(options.KnownIPNetworks, network =>
            network.BaseAddress.Equals(IPAddress.Parse("172.16.0.0")) && network.PrefixLength == 12);
    }

    [Theory]
    [InlineData("ForwardedHeaders:KnownProxies:0", "not-an-ip")]
    [InlineData("ForwardedHeaders:KnownNetworks:0", "not-a-network")]
    public void Configure_RejectsInvalidTrustEntries(string key, string value)
    {
        var configuration = Configuration(new Dictionary<string, string?> { [key] = value });

        Assert.Throws<InvalidOperationException>(() =>
            ForwardedHeadersConfiguration.Configure(new ForwardedHeadersOptions(), configuration));
    }

    private static IConfiguration Configuration(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}