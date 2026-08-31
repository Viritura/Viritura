using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

using Viritura.GitHub;

namespace Viritura.Api.Controllers;

/// <summary>
/// Receives GitHub App webhooks. Currently handles <c>installation.deleted</c> /
/// <c>installation.suspend</c> so our local <c>UserGitHubInstallations</c> cache stays
/// in sync when users uninstall or suspend the app from github.com.
///
/// Configuration: set <c>Viritura:GitHub:WebhookSecret</c> and point the GitHub App's
/// webhook URL at <c>POST /github/webhooks</c>. Requests without a valid HMAC-SHA256
/// signature are rejected with 401.
/// </summary>
[ApiController]
[Route("github/webhooks")]
[AllowAnonymous]
[EnableRateLimiting("GitHubAuth")]
public sealed class GitHubWebhookController(
    IOptions<GitHubAuthOptions> options,
    IGitHubInstallationStore installationStore,
    WebhookDeliveryDeduplicator deliveries,
    ILogger<GitHubWebhookController> logger) : ControllerBase
{
    [HttpPost]
    [RequestSizeLimit(256 * 1024)]
    public async Task<IActionResult> Receive(CancellationToken cancellationToken)
    {
        var secret = options.Value.WebhookSecret;
        if (string.IsNullOrWhiteSpace(secret))
        {
            // Endpoint is implicitly disabled when no secret is configured.
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "GitHub webhook is not configured." });
        }

        Request.EnableBuffering();
        using var ms = new MemoryStream();
        await Request.Body.CopyToAsync(ms, cancellationToken);
        var body = ms.ToArray();
        Request.Body.Position = 0;

        if (!TryVerifySignature(body, secret, Request.Headers["X-Hub-Signature-256"].ToString()))
        {
            return Unauthorized();
        }

        var deliveryId = Request.Headers["X-GitHub-Delivery"].ToString();
        switch (deliveries.TryAcquireLease(deliveryId))
        {
            case LeaseAcquireResult.AlreadyCompleted:
                return Ok();
            case LeaseAcquireResult.ConcurrentDuplicate:
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    new { error = "Delivery in progress; please retry." });
            case LeaseAcquireResult.InvalidId:
                return BadRequest(new { error = "GitHub delivery id is required." });
        }

        // Lease acquired — must call Complete or Release before returning.
        try
        {
            var eventName = Request.Headers["X-GitHub-Event"].ToString();
            if (!string.Equals(eventName, "installation", StringComparison.OrdinalIgnoreCase))
            {
                // Acknowledge unknown events so GitHub doesn't retry; logging only.
                logger.LogDebug("Ignoring GitHub webhook event {Event}", eventName);
                deliveries.Complete(deliveryId);
                return Ok();
            }

            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(body);
            }
            catch (JsonException ex)
            {
                // Body is signed by GitHub — malformed JSON cannot be fixed by retrying.
                logger.LogWarning(ex, "GitHub webhook: malformed JSON in signed delivery {DeliveryId}", deliveryId);
                deliveries.Complete(deliveryId);
                return Ok();
            }

            using (document)
            {
                var root = document.RootElement;
                var action = root.TryGetProperty("action", out var actionElement) ? actionElement.GetString() : null;

                if (!string.Equals(action, "deleted", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(action, "suspend", StringComparison.OrdinalIgnoreCase))
                {
                    // installation.created / installation.new_permissions_accepted are no-ops here; we already
                    // upserted the row during the OAuth callback. Acknowledge so GitHub stops retrying.
                    deliveries.Complete(deliveryId);
                    return Ok();
                }

                if (!root.TryGetProperty("installation", out var installationElement) ||
                    !installationElement.TryGetProperty("account", out var accountElement) ||
                    !accountElement.TryGetProperty("id", out var accountIdElement) ||
                    !accountIdElement.TryGetInt64(out var accountId))
                {
                    logger.LogWarning("GitHub installation webhook missing installation.account.id");
                    // Missing required fields in a signed payload cannot be fixed by retrying.
                    deliveries.Complete(deliveryId);
                    return Ok();
                }

                var removed = await installationStore.DeleteByGitHubAccountIdAsync(accountId, cancellationToken);
                logger.LogInformation(
                    "GitHub installation webhook ({Action}) cleared {Removed} cached row(s) for account {AccountId}",
                    action, removed, accountId);

                deliveries.Complete(deliveryId);
                return Ok();
            }
        }
#pragma warning disable CA1031 // intentional resilience boundary: release lease on any transient failure so GitHub retries
        catch (Exception ex)
        {
            logger.LogError(ex, "GitHub webhook: transient failure processing delivery {DeliveryId}", deliveryId);
            deliveries.Release(deliveryId);
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { error = "Transient processing failure; please retry." });
        }
#pragma warning restore CA1031
    }

    private static bool TryVerifySignature(byte[] body, string secret, string? signatureHeader)
    {
        if (string.IsNullOrWhiteSpace(signatureHeader))
        {
            return false;
        }

        const string prefix = "sha256=";
        if (!signatureHeader.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var providedHex = signatureHeader.AsSpan(prefix.Length);

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var computed = hmac.ComputeHash(body);
        var computedHex = Convert.ToHexString(computed);

        // Case-insensitive constant-time compare.
        if (providedHex.Length != computedHex.Length)
        {
            return false;
        }

        var providedBytes = new byte[providedHex.Length];
        for (var i = 0; i < providedHex.Length; i++)
        {
            providedBytes[i] = (byte)char.ToUpperInvariant(providedHex[i]);
        }

        return CryptographicOperations.FixedTimeEquals(providedBytes, Encoding.ASCII.GetBytes(computedHex));
    }
}