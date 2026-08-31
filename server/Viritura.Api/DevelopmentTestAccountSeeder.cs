using Microsoft.AspNetCore.Identity;

using Viritura.Infrastructure;

namespace Viritura.Api;

public static class DevelopmentTestAccountSeeder
{
    public const string Email = "test@example.com";
    public const string Password = "letmein123";

    public static async Task SeedAsync(IServiceProvider services)
    {
        var environment = services.GetRequiredService<IHostEnvironment>();
        var configuration = services.GetRequiredService<IConfiguration>();
        if (!environment.IsDevelopment() ||
            !configuration.GetValue("Development:SeedTestAccount", defaultValue: false))
        {
            return;
        }
        var userManager = services.GetRequiredService<UserManager<AppUser>>();
        var user = await userManager.FindByEmailAsync(Email);
        if (user is null)
        {
            user = new AppUser
            {
                UserName = Email,
                Email = Email,
                EmailConfirmed = true,
                DisplayName = "Test User"
            };
            EnsureSucceeded(await userManager.CreateAsync(user, Password), "create development test account");
            return;
        }

        if (!user.EmailConfirmed)
        {
            user.EmailConfirmed = true;
            EnsureSucceeded(await userManager.UpdateAsync(user), "confirm development test account");
        }

        if (!await userManager.CheckPasswordAsync(user, Password))
        {
            var token = await userManager.GeneratePasswordResetTokenAsync(user);
            EnsureSucceeded(await userManager.ResetPasswordAsync(user, token, Password), "reset development test password");
        }
    }

    private static void EnsureSucceeded(IdentityResult result, string action)
    {
        if (result.Succeeded)
        {
            return;
        }

        var errors = string.Join("; ", result.Errors.Select(error => $"{error.Code}: {error.Description}"));
        throw new InvalidOperationException($"Failed to {action}: {errors}");
    }
}