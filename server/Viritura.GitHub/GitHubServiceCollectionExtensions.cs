using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Viritura.GitHub;

public static class GitHubServiceCollectionExtensions
{
    public static IServiceCollection AddVirituraGitHub(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<GitHubAuthOptions>(configuration.GetSection(GitHubAuthOptions.SectionName));

        // Data Protection key persistence is owned by Viritura.Infrastructure
        // (AddDataProtectionPersistence). The historical second AddDataProtection() call here
        // produced overlapping configuration (different config key, second SetApplicationName)
        // and competed with Infrastructure for the same key ring.

        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<GitHubTokenProtector>();
        services.AddHttpClient<IGitHubOAuthClient, GitHubOAuthClient>();
        services.AddSingleton<IGitHubOAuthStateService, GitHubOAuthStateService>();
        services.AddScoped<IGitHubTokenService, GitHubTokenService>();
        services.AddScoped<IGitHubInstallationStore, GitHubInstallationStore>();
        services.AddScoped<GitHubInstallationRefresher>();

        return services;
    }
}