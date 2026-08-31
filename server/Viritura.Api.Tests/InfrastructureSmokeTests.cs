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