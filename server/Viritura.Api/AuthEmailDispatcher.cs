using System.Threading.Channels;

using Microsoft.AspNetCore.Identity;

using Viritura.Infrastructure;
using Viritura.Infrastructure.Email;

namespace Viritura.Api;

public interface IAuthEmailDispatcher
{
    Task QueueVerificationAsync(AppUser user);

    Task QueuePasswordResetAsync(AppUser user);

    Task QueueTwoFactorRecoveryAsync(AppUser user);
}

public sealed class InlineAuthEmailDispatcher(
    UserManager<AppUser> userManager,
    IEmailSender<AppUser> emailSender,
    IVirituraEmailSender virituraEmailSender,
    IConfiguration configuration,
    ILogger<InlineAuthEmailDispatcher> logger) : IAuthEmailDispatcher
{
    public Task QueueVerificationAsync(AppUser user) => DeliverAsync(
        user,
        () => AuthEmailDelivery.SendVerificationAsync(userManager, emailSender, configuration, user));

    public Task QueuePasswordResetAsync(AppUser user) => DeliverAsync(
        user,
        () => AuthEmailDelivery.SendPasswordResetAsync(userManager, emailSender, configuration, user));

    public Task QueueTwoFactorRecoveryAsync(AppUser user) => DeliverAsync(
        user,
        () => AuthEmailDelivery.SendTwoFactorRecoveryAsync(userManager, virituraEmailSender, configuration, user));

    private async Task DeliverAsync(AppUser user, Func<Task> delivery)
    {
        try
        {
            await delivery();
        }
        catch (HttpRequestException exception)
        {
            logger.LogError(exception, "Account email delivery failed for user {UserId}.", user.Id);
        }
    }
}

public sealed class QueuedAuthEmailDispatcher(
    IServiceScopeFactory scopeFactory,
    ILogger<QueuedAuthEmailDispatcher> logger) : BackgroundService, IAuthEmailDispatcher
{
    private readonly Channel<AuthEmailCommand> _channel = Channel.CreateBounded<AuthEmailCommand>(
        new BoundedChannelOptions(1_000)
        {
            // TryWrite must report false at capacity so overload is observable.
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false
        });

    public Task QueueVerificationAsync(AppUser user)
    {
        Enqueue(new AuthEmailCommand(user.Id, AuthEmailKind.Verification));
        return Task.CompletedTask;
    }

    public Task QueuePasswordResetAsync(AppUser user)
    {
        Enqueue(new AuthEmailCommand(user.Id, AuthEmailKind.PasswordReset));
        return Task.CompletedTask;
    }

    public Task QueueTwoFactorRecoveryAsync(AppUser user)
    {
        Enqueue(new AuthEmailCommand(user.Id, AuthEmailKind.TwoFactorRecovery));
        return Task.CompletedTask;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var command in _channel.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
                var user = await userManager.FindByIdAsync(command.UserId);
                if (user is null) continue;
                var sender = scope.ServiceProvider.GetRequiredService<IEmailSender<AppUser>>();
                var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
                switch (command.Kind)
                {
                    case AuthEmailKind.Verification:
                        await AuthEmailDelivery.SendVerificationAsync(userManager, sender, configuration, user);
                        break;
                    case AuthEmailKind.PasswordReset:
                        await AuthEmailDelivery.SendPasswordResetAsync(userManager, sender, configuration, user);
                        break;
                    case AuthEmailKind.TwoFactorRecovery:
                        var virituraEmailSender = scope.ServiceProvider.GetRequiredService<IVirituraEmailSender>();
                        await AuthEmailDelivery.SendTwoFactorRecoveryAsync(userManager, virituraEmailSender, configuration, user);
                        break;
                }
            }
#pragma warning disable CA1031 // resilience boundary: one provider failure must not stop the queue
            catch (Exception exception)
#pragma warning restore CA1031
            {
                logger.LogError(exception, "Queued account email delivery failed for user {UserId}.", command.UserId);
            }
        }
    }

    private void Enqueue(AuthEmailCommand command)
    {
        if (!_channel.Writer.TryWrite(command))
        {
            logger.LogWarning("Account email queue is full; dropping {Kind} for user {UserId}.", command.Kind, command.UserId);
        }
    }

    private sealed record AuthEmailCommand(string UserId, AuthEmailKind Kind);

    private enum AuthEmailKind
    {
        Verification,
        PasswordReset,
        TwoFactorRecovery
    }
}

internal static class AuthEmailDelivery
{
    /// <summary>
    /// Token purpose string shared between token generation (delivery) and token verification
    /// (<c>POST /auth/2fa/disable-by-recovery-token</c>). Must never change; existing tokens
    /// are invalidated if it does.
    /// </summary>
    internal const string TwoFactorRecoveryTokenPurpose = "TwoFactorRecovery";

    public static async Task SendVerificationAsync(
        UserManager<AppUser> userManager,
        IEmailSender<AppUser> emailSender,
        IConfiguration configuration,
        AppUser user)
    {
        var token = await userManager.GenerateEmailConfirmationTokenAsync(user);
        var url = BuildUrl(configuration, "/auth/verify", user.Id, token);
        await emailSender.SendConfirmationLinkAsync(user, user.Email!, url);
    }

    public static async Task SendPasswordResetAsync(
        UserManager<AppUser> userManager,
        IEmailSender<AppUser> emailSender,
        IConfiguration configuration,
        AppUser user)
    {
        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var url = BuildUrl(configuration, "/auth/reset-password", user.Id, token);
        await emailSender.SendPasswordResetLinkAsync(user, user.Email!, url);
    }

    public static async Task SendTwoFactorRecoveryAsync(
        UserManager<AppUser> userManager,
        IVirituraEmailSender virituraEmailSender,
        IConfiguration configuration,
        AppUser user)
    {
        var token = await userManager.GenerateUserTokenAsync(
            user,
            TokenOptions.DefaultProvider,
            TwoFactorRecoveryTokenPurpose);
        var url = BuildUrl(configuration, "/auth/2fa-recovery", user.Id, token);
        await virituraEmailSender.SendTwoFactorRecoveryLinkAsync(user, user.Email!, url);
    }

    private static string BuildUrl(IConfiguration configuration, string path, string userId, string token)
    {
        var websiteBaseUrl = configuration["Auth:WebsiteBaseUrl"]?.TrimEnd('/') ?? "http://localhost:5180";
        return string.Concat(
            websiteBaseUrl,
            path,
            "#uid=",
            Uri.EscapeDataString(userId),
            "&token=",
            Uri.EscapeDataString(token));
    }
}