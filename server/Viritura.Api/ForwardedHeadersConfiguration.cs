using System.Net;

using Microsoft.AspNetCore.HttpOverrides;

namespace Viritura.Api;

internal static class ForwardedHeadersConfiguration
{
    internal static void Configure(ForwardedHeadersOptions options, IConfiguration configuration)
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();

        if (configuration.GetValue("ForwardedHeaders:TrustAll", defaultValue: false))
        {
            throw new InvalidOperationException(
                "ForwardedHeaders:TrustAll is not supported. Configure exact KnownProxies addresses " +
                "or KnownNetworks CIDR ranges for the reverse-proxy hop.");
        }

        options.KnownProxies.Add(IPAddress.Loopback);
        options.KnownProxies.Add(IPAddress.IPv6Loopback);

        foreach (var configuredProxy in configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
        {
            if (!IPAddress.TryParse(configuredProxy, out var proxy))
            {
                throw new InvalidOperationException(
                    $"ForwardedHeaders:KnownProxies contains invalid IP address '{configuredProxy}'.");
            }
            options.KnownProxies.Add(proxy);
        }

        foreach (var configuredNetwork in configuration.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>() ?? [])
        {
            if (!System.Net.IPNetwork.TryParse(configuredNetwork, out var network))
            {
                throw new InvalidOperationException(
                    $"ForwardedHeaders:KnownNetworks contains invalid CIDR range '{configuredNetwork}'.");
            }
            options.KnownIPNetworks.Add(network);
        }
    }
}