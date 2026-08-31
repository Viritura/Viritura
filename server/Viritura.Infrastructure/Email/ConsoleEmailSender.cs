using Microsoft.Extensions.Logging;

namespace Viritura.Infrastructure.Email;

/// <summary>
/// Dev / test implementation of <see cref="IEmailSender{TUser}"/> that writes
/// every message to the logger at <see cref="LogLevel.Information"/> instead
/// of dispatching over the wire. Identity's built-in confirmation and
/// password-reset flows call this automatically when wired via DI. Real
/// providers (e.g. Resend) implement the same interface and swap in behind
/// <c>Email:Provider</c>.
/// </summary>
public sealed class ConsoleEmailSender(ILogger<ConsoleEmailSender> logger) : VirituraEmailSenderBase
{
    protected override Task SendAsync(string recipient, string subject, string body)
    {
        logger.LogInformation(
            """

            ────────────────── EMAIL (console sender) ──────────────────
            To:      {To}
            Subject: {Subject}

            {Body}
            ────────────────────────────────────────────────────────────
            """,
            recipient, subject, body);
        return Task.CompletedTask;
    }
}