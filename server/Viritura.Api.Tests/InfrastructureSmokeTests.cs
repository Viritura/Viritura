using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class InfrastructureSmokeTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public InfrastructureSmokeTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:Provider"] = "Sqlite",
                    ["ConnectionStrings:VirituraDb"] = $"Data Source=viritura.test.{Guid.NewGuid():N}.db",
                    ["Auth:RequireEmailVerification"] = "false"
                });
            });
        });
    }

    [Fact]
    public async Task ParallelDefaultFactories_DoNotShareDatabaseState()
    {
        using var first = new IsolatedApiFactory();
        using var second = new IsolatedApiFactory();
#pragma warning disable CA2025 // Both startup tasks finish before either factory is disposed.
        var firstStartup = Task.Run(() => first.CreateClient());
        var secondStartup = Task.Run(() => second.CreateClient());
#pragma warning restore CA2025
        await Task.WhenAll(firstStartup, secondStartup);
        using var firstClient = await firstStartup;
        using var secondClient = await secondStartup;
        using var firstScope = first.Services.CreateScope();
        using var secondScope = second.Services.CreateScope();
        var firstDb = firstScope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        var secondDb = secondScope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        Assert.NotEqual(
            firstDb.Database.GetDbConnection().DataSource,
            secondDb.Database.GetDbConnection().DataSource);

        var email = $"isolation.{Guid.NewGuid():N}@viritura.test";
        var firstUsers = firstScope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var created = await firstUsers.CreateAsync(new AppUser { UserName = email, Email = email });
        Assert.True(created.Succeeded, string.Join(", ", created.Errors.Select(error => error.Description)));
        var secondUsers = secondScope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        Assert.Null(await secondUsers.FindByEmailAsync(email));
    }

    [Fact]
    public async Task IdentityRoundTrip_CreateUser_ThenFindByEmail()
    {
        using var _ = _factory.CreateClient();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        await db.Database.MigrateAsync();

        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var email = $"smoke.{Guid.NewGuid():N}@viritura.test";

        var user = new AppUser
        {
            UserName = email,
            Email = email,
            DisplayName = "Smoke Test"
        };

        var create = await users.CreateAsync(user, "SmokePassw0rd!");
        Assert.True(create.Succeeded, string.Join(", ", create.Errors.Select(e => e.Description)));

        var fetched = await users.FindByEmailAsync(email);
        Assert.NotNull(fetched);
        Assert.Equal("Smoke Test", fetched!.DisplayName);
    }

    [Fact]
    public async Task IdentityAllowsMultipleOAuthUsersWithoutEmail()
    {
        using var _ = _factory.CreateClient();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        await db.Database.MigrateAsync();

        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var first = new AppUser
        {
            UserName = $"github-{Guid.NewGuid():N}",
            Email = null,
            EmailConfirmed = true,
            DisplayName = "GitHub User"
        };
        var second = new AppUser
        {
            UserName = $"github-{Guid.NewGuid():N}",
            Email = null,
            EmailConfirmed = true,
            DisplayName = "Another GitHub User"
        };

        var firstCreate = await users.CreateAsync(first);
        var secondCreate = await users.CreateAsync(second);

        Assert.True(firstCreate.Succeeded, string.Join(", ", firstCreate.Errors.Select(e => e.Description)));
        Assert.True(secondCreate.Succeeded, string.Join(", ", secondCreate.Errors.Select(e => e.Description)));
    }

    [Fact]
    public async Task IdentityRejectsDuplicateNonNullEmail()
    {
        using var _ = _factory.CreateClient();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<VirituraDbContext>();
        await db.Database.MigrateAsync();

        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var email = $"unique.{Guid.NewGuid():N}@viritura.test";
        var first = new AppUser { UserName = email, Email = email };
        var second = new AppUser { UserName = $"other-{Guid.NewGuid():N}", Email = email };

        var firstCreate = await users.CreateAsync(first);
        var secondCreate = await users.CreateAsync(second);

        Assert.True(firstCreate.Succeeded, string.Join(", ", firstCreate.Errors.Select(e => e.Description)));
        Assert.False(secondCreate.Succeeded);
        Assert.Contains(secondCreate.Errors, error => error.Code == "DuplicateEmail");
    }

    [Fact]
    public void Infrastructure_RejectsConsoleEmailOutsideDevelopment()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:VirituraDb"] = "Data Source=unused.db",
                ["Email:Provider"] = "Console"
            })
            .Build();
        var environment = new TestHostEnvironment { EnvironmentName = Environments.Production };

        var error = Assert.Throws<InvalidOperationException>(() =>
            new ServiceCollection().AddVirituraInfrastructure(configuration, environment));

        Assert.Contains("allowed only in Development", error.Message, StringComparison.Ordinal);
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "Viritura.Api.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}