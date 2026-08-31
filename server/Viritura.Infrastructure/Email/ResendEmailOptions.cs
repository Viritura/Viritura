namespace Viritura.Infrastructure.Email;

/// <summary>Configuration required by the Resend transactional-email transport.</summary>
public sealed class ResendEmailOptions
{
    public const string SectionName = "Email:Resend";

    public required string ApiKey { get; init; }

    /// <summary>A verified sender, for example <c>Viritura &lt;accounts@mail.viritura.com&gt;</c>.</summary>
    public required string From { get; init; }

    /// <summary>Optional monitored mailbox that receives user replies.</summary>
    public string? ReplyTo { get; init; }
}