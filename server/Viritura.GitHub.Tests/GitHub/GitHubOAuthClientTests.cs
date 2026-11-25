using System.Net;
using System.Text.Json;

using Microsoft.Extensions.Options;

using Viritura.GitHub;

using Xunit;

namespace Viritura.GitHub.Tests.GitHub;

public sealed class GitHubOAuthClientTests
{
    [Fact]
    public async Task CreateGistAsync_CreatesSecretGistWithBearerTokenAndAllFiles()
    {
        HttpRequestMessage? capturedRequest = null;
        string? requestBody = null;
        using var handler = new CallbackHandler(async (request, cancellationToken) =>
        {
            capturedRequest = request;
            requestBody = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.Created)
            {
                Content = new StringContent(
                    """{"id":"gist-id","html_url":"https://gist.github.com/user/gist-id"}""")
            };
        });
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var client = new GitHubOAuthClient(
            httpClient,
            Options.Create(new GitHubAuthOptions()),
            TimeProvider.System);

        var gist = await client.CreateGistAsync(
            "access-token",
            "Viritura click setlist",
            new Dictionary<string, string> { ["01 - score.mnx"] = "{\"score\":1}" });

        Assert.Equal("gist-id", gist.Id);
        Assert.Equal("https://gist.github.com/user/gist-id", gist.HtmlUrl);
        Assert.NotNull(capturedRequest);
        Assert.Equal(HttpMethod.Post, capturedRequest.Method);
        Assert.Equal("https://api.github.com/gists", capturedRequest.RequestUri!.ToString());
        Assert.Equal("Bearer", capturedRequest.Headers.Authorization!.Scheme);
        Assert.Equal("access-token", capturedRequest.Headers.Authorization.Parameter);
        using var payload = JsonDocument.Parse(requestBody!);
        var root = payload.RootElement;
        Assert.Equal("Viritura click setlist", root.GetProperty("description").GetString());
        Assert.False(root.GetProperty("public").GetBoolean());
        Assert.Equal(
            "{\"score\":1}",
            root.GetProperty("files").GetProperty("01 - score.mnx").GetProperty("content").GetString());
    }

    private sealed class CallbackHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> callback) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            await callback(request, cancellationToken);
    }
}