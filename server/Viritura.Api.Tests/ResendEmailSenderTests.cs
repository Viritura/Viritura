using System.Net;
using System.Text.Json;

using Viritura.Infrastructure;
using Viritura.Infrastructure.Email;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class ResendEmailSenderTests
{
    [Fact]
    public async Task SendConfirmationLinkAsync_PostsExpectedResendPayload()
    {
        using var handler = new CapturingHandler(HttpStatusCode.OK);
        using var client = new HttpClient(handler) { BaseAddress = new Uri("https://api.resend.com/") };
        var sender = new ResendEmailSender(client, new ResendEmailOptions
        {
            ApiKey = "re_test_key",
            From = "Viritura <accounts@mail.viritura.com>",
            ReplyTo = "support@viritura.com"
        });

        await sender.SendConfirmationLinkAsync(
            new AppUser(),
            "alpha@example.com",
            "https://viritura.com/auth/verify?token=secret");

        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal("https://api.resend.com/emails", handler.RequestUri?.ToString());
        Assert.Equal("Bearer", handler.AuthorizationScheme);
        Assert.Equal("re_test_key", handler.AuthorizationParameter);

        using var payload = JsonDocument.Parse(Assert.IsType<string>(handler.Body));
        var root = payload.RootElement;
        Assert.Equal("Viritura <accounts@mail.viritura.com>", root.GetProperty("from").GetString());
        Assert.Equal("alpha@example.com", root.GetProperty("to")[0].GetString());
        Assert.Equal("Confirm your Viritura email", root.GetProperty("subject").GetString());
        Assert.Contains(
            "https://viritura.com/auth/verify?token=secret",
            root.GetProperty("text").GetString(),
            StringComparison.Ordinal);
        Assert.Equal("support@viritura.com", root.GetProperty("reply_to").GetString());
    }

    [Fact]
    public async Task SendConfirmationLinkAsync_WhenResendRejectsRequest_ThrowsWithoutResponseBody()
    {
        const string sensitiveResponse = "provider details that must not enter exception logs";
        using var handler = new CapturingHandler(HttpStatusCode.BadRequest, sensitiveResponse);
        using var client = new HttpClient(handler) { BaseAddress = new Uri("https://api.resend.com/") };
        var sender = new ResendEmailSender(client, new ResendEmailOptions
        {
            ApiKey = "re_test_key",
            From = "Viritura <accounts@mail.viritura.com>"
        });

        var error = await Assert.ThrowsAsync<HttpRequestException>(() => sender.SendConfirmationLinkAsync(
            new AppUser(),
            "alpha@example.com",
            "https://viritura.com/auth/verify?token=secret"));

        Assert.Equal(HttpStatusCode.BadRequest, error.StatusCode);
        Assert.DoesNotContain(sensitiveResponse, error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("re_test_key", error.Message, StringComparison.Ordinal);
    }

    private sealed class CapturingHandler(HttpStatusCode statusCode, string responseBody = "{}") : HttpMessageHandler
    {
        public HttpMethod? Method { get; private set; }

        public Uri? RequestUri { get; private set; }

        public string? AuthorizationScheme { get; private set; }

        public string? AuthorizationParameter { get; private set; }

        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Method = request.Method;
            RequestUri = request.RequestUri;
            AuthorizationScheme = request.Headers.Authorization?.Scheme;
            AuthorizationParameter = request.Headers.Authorization?.Parameter;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(statusCode) { Content = new StringContent(responseBody) };
        }
    }
}