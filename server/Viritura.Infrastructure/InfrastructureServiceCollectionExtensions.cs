using System.IO;

using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

using Viritura.Infrastructure.Email;

namespace Viritura.Infrastructure;

public static class InfrastructureServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="VirituraDbContext"/>, ASP.NET Core Identity, and a default cookie auth scheme.
    /// Database provider is selected from <c>Database:Provider</c> (Sqlite | Postgres; default Sqlite).
    /// Connection string read from <c>ConnectionStrings:VirituraDb</c>.
    /// </summary>
    public static IServiceCollection AddVirituraInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment? environment = null)
    {
        var provider = configuration["Database:Provider"] ?? "Sqlite";

        // Read the connection string inside the AddDbContext factory so WebApplicationFactory
        // config overrides (applied via ConfigureAppConfiguration after service registration)
        // are visible when the first DbContext is resolved, not at registration time.
        services.AddDbContext<VirituraDbContext>((serviceProvider, options) =>
        {
            var config = serviceProvider.GetRequiredService<IConfiguration>();
            var connectionString = config.GetConnectionString("VirituraDb")
                ?? throw new InvalidOperationException(
                    "ConnectionStrings:VirituraDb is not configured.");

            switch (provider)
            {
                case "Sqlite":
                    options.UseSqlite(connectionString, sqlite =>
                        sqlite.MigrationsAssembly(typeof(VirituraDbContext).Assembly.FullName));
                    break;
                case "Postgres":
                    throw new NotImplementedException(
                        "Postgres provider is reserved for production; add Npgsql package + migration when wiring prod.");
                default:
                    throw new InvalidOperationException(
                        $"Unsupported Database:Provider '{provider}'. Expected 'Sqlite' or 'Postgres'.");
            }
        });

        services
            .AddIdentityCore<AppUser>(options =>
            {
                options.User.RequireUniqueEmail = true;
                options.Password.RequiredLength = 12;
                // When Auth:RequireEmailVerification = true, PasswordSignInAsync returns
                // IsNotAllowed for users whose EmailConfirmed=false. Default to true in prod;
                // tests opt out via in-memory config to keep the existing fixtures simple.
                options.SignIn.RequireConfirmedEmail =
                    configuration.GetValue("Auth:RequireEmailVerification", defaultValue: true);
            })
            .AddRoles<IdentityRole>()
            .AddEntityFrameworkStores<VirituraDbContext>()
            .AddSignInManager()
            .AddDefaultTokenProviders();

        AddEmailSender(services, configuration, environment);
        AddDataProtectionPersistence(services, configuration, environment);
        services.AddHostedService<IdentityTokenProtectionMigrator>();

        return services;
    }

    /// <summary>
    /// Persists ASP.NET Core Data Protection keys to a stable location so that cookie auth,
    /// anti-forgery tokens, Identity-issued email-verification / password-reset / 2FA-recovery
    /// tokens, and at-rest column encryption (e.g. GitHub OAuth tokens) survive process restarts
    /// and remain consistent across instances.
    ///
    /// Behaviour:
    /// <list type="bullet">
    ///   <item>When <c>DataProtection:KeysDirectory</c> is set, keys are persisted there and the
    ///     <c>ApplicationName</c> (default <c>"Viritura"</c>) is set so multiple instances share
    ///     the ring.</item>
    ///   <item>When not set in <see cref="Environments.Development"/>, ASP.NET Core's built-in
    ///     per-user key location is used; sufficient for a single dev machine.</item>
    ///   <item>When not set outside Development, throws at startup — ephemeral keys in
    ///     production would invalidate every cookie / verification link / encrypted column on
    ///     every restart, which is far worse than failing fast at boot.</item>
    /// </list>
    /// </summary>
    private static void AddDataProtectionPersistence(
        IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment? environment)
    {
        var keysDirectory = configuration["DataProtection:KeysDirectory"];
        var applicationName = configuration["DataProtection:ApplicationName"] ?? "Viritura";

        var isDevelopment = environment?.IsDevelopment() ?? true;
        if (string.IsNullOrWhiteSpace(keysDirectory) && !isDevelopment)
        {
            throw new InvalidOperationException(
                "DataProtection:KeysDirectory is not configured. Production deployments must " +
                "persist Data Protection keys to a stable shared location (file share, blob " +
                "storage, secret manager); ephemeral keys invalidate every session and " +
                "verification link on every restart. Set DataProtection:KeysDirectory to a " +
                "writable directory.");
        }

        var builder = services.AddDataProtection().SetApplicationName(applicationName);

        if (!string.IsNullOrWhiteSpace(keysDirectory))
        {
            Directory.CreateDirectory(keysDirectory);
            builder.PersistKeysToFileSystem(new DirectoryInfo(keysDirectory));
        }
    }

    /// <summary>
    /// Binds ASP.NET Core Identity's <see cref="IEmailSender{TUser}"/> based on <c>Email:Provider</c>.
    /// Identity's built-in confirmation and password-reset flows call this automatically.
    /// <list type="bullet">
    ///   <item><c>Console</c> (default) — <see cref="ConsoleEmailSender"/>; writes every send to the logger.</item>
    ///   <item><c>Resend</c> — <see cref="ResendEmailSender"/>; sends through Resend's HTTPS API.</item>
    /// </list>
    /// </summary>
    private static void AddEmailSender(
        IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment? environment)
    {
        var configuredEmailProvider = configuration["Email:Provider"];
        var emailProvider = configuredEmailProvider ?? "Console";
        switch (emailProvider)
        {
            case "Console":
                if (environment is not null && !environment.IsDevelopment())
                {
                    throw new InvalidOperationException(
                        "Email:Provider=Console is allowed only in Development. " +
                        "Set Email:Provider=Resend and configure Email:Resend outside Development.");
                }
                // Register the same singleton against both interfaces so identity flows
                // (IEmailSender<AppUser>) and Viritura-specific flows (IVirituraEmailSender)
                // share one sender instance.
                services.AddSingleton<ConsoleEmailSender>();
                services.AddSingleton<IEmailSender<AppUser>>(sp => sp.GetRequiredService<ConsoleEmailSender>());
                services.AddSingleton<IVirituraEmailSender>(sp => sp.GetRequiredService<ConsoleEmailSender>());
                break;
            case "Resend":
                var apiKey = configuration[$"{ResendEmailOptions.SectionName}:ApiKey"];
                var from = configuration[$"{ResendEmailOptions.SectionName}:From"];
                var replyTo = configuration[$"{ResendEmailOptions.SectionName}:ReplyTo"];
                if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(from))
                {
                    throw new InvalidOperationException(
                        "Email:Provider is Resend, but Email:Resend:ApiKey and Email:Resend:From are not both configured.");
                }

                services.AddSingleton(new ResendEmailOptions
                {
                    ApiKey = apiKey,
                    From = from,
                    ReplyTo = replyTo
                });
                services.AddHttpClient<ResendEmailSender>(client =>
                {
                    client.BaseAddress = new Uri("https://api.resend.com/");
                    client.Timeout = TimeSpan.FromSeconds(15);
                });
                services.AddTransient<IEmailSender<AppUser>>(sp => sp.GetRequiredService<ResendEmailSender>());
                services.AddTransient<IVirituraEmailSender>(sp => sp.GetRequiredService<ResendEmailSender>());
                break;
            default:
                throw new InvalidOperationException(
                    $"Unsupported Email:Provider '{emailProvider}'. Expected 'Console' or 'Resend'.");
        }
    }
}