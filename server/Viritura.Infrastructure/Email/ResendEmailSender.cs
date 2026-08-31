using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Viritura.Infrastructure.Email;

/// <summary>Sends Viritura account email through Resend's HTTPS API.</summary>
public sealed class ResendEmailSender(HttpClient httpClient, ResendEmailOptions options) : VirituraEmailSenderBase
{
    protected override async Task SendAsync(string recipient, string subject, string body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "emails")
        {
            Content = JsonContent.Create(new ResendRequest(
                options.From,
                [recipient],
                subject,
                body,
                string.IsNullOrWhiteSpace(options.ReplyTo) ? null : options.ReplyTo))
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);

        using var response = await httpClient.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Resend rejected the email request with HTTP {(int)response.StatusCode} ({response.StatusCode}).",
                inner: null,
                response.StatusCode);
        }
    }

    private sealed record ResendRequest(
        [property: JsonPropertyName("from")] string From,
        [property: JsonPropertyName("to")] string[] To,
        [property: JsonPropertyName("subject")] string Subject,
        [property: JsonPropertyName("text")] string Text,
        [property: JsonPropertyName("reply_to"),
         JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ReplyTo);
}