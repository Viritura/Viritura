using System.Collections.Immutable;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

using OpenIddict.Abstractions;

namespace Viritura.Api.Mcp;

/// <summary>
/// Supplies validated OAuth data to the React server-UI bundle. The plain HTML
/// content remains as a functional fallback if scripts fail or are disabled.
/// </summary>
internal static class McpConsentPage
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    internal static string Build(
        HttpContext context,
        OpenIddictRequest request,
        string clientName,
        string antiforgeryField,
        string antiforgeryToken)
    {
        var fields = new List<ConsentField> { new(antiforgeryField, antiforgeryToken) };
        foreach (var parameter in context.Request.Query)
        {
            foreach (var value in parameter.Value)
            {
                fields.Add(new ConsentField(parameter.Key, value ?? string.Empty));
            }
        }

        var action = context.Request.Path + context.Request.QueryString;
        var payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
            new ConsentData(clientName, action, request.GetScopes(), fields),
            JsonOptions)));
        var encoder = HtmlEncoder.Default;
        var encodedClient = encoder.Encode(clientName);
        var encodedAction = encoder.Encode(action);
        var hiddenFields = string.Concat(fields.Select(field => Hidden(field.Name, field.Value)));
        var scopes = string.Concat(request.GetScopes().Select(scope => $"<li>{encoder.Encode(scope)}</li>"));

        return $$"""
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <meta name="color-scheme" content="light dark">
              <title>Authorize access · Viritura</title>
              <link rel="stylesheet" href="/server-ui/server-ui.css">
              <script type="module" src="/server-ui/server-ui.js"></script>
            </head>
            <body>
              <div id="root" data-page="oauth-consent" data-payload="{{payload}}">
                <main class="server-ui-fallback">
                  <h1>Allow access to Viritura?</h1>
                  <p><strong>{{encodedClient}}</strong> wants to connect to the score open in your editor.</p>
                  <p>Requested permissions:</p>
                  <ul>{{scopes}}</ul>
                  <div class="server-ui-fallback-actions">
                    <form method="post" action="{{encodedAction}}">{{hiddenFields}}<button type="submit" name="decision" value="deny">Deny</button></form>
                    <form method="post" action="{{encodedAction}}">{{hiddenFields}}<button type="submit" name="decision" value="allow">Allow access</button></form>
                  </div>
                </main>
              </div>
            </body>
            </html>
            """;

        string Hidden(string name, string value) =>
            $"<input type=\"hidden\" name=\"{encoder.Encode(name)}\" value=\"{encoder.Encode(value)}\">";
    }

    private sealed record ConsentData(
        string ClientName,
        string Action,
        ImmutableArray<string> Scopes,
        IReadOnlyList<ConsentField> Fields);

    private sealed record ConsentField(string Name, string Value);
}