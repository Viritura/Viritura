// SnapshotEndpoint — HTTP handlers for live-collab room snapshots.
//
// Wire shape:
//   GET  /live/room/{roomId}/snapshot
//     200 application/octet-stream — the raw Y.Doc update bytes
//     404 — no snapshot has ever been pushed for this room id
//     400 — room id is malformed
//
//   PUT  /live/room/{roomId}/snapshot
//     Body: raw Y.Doc update bytes, up to <see cref="MaxSnapshotBytes"/>
//     200 — stored
//     400 — room id is malformed
//     413 — payload exceeds the cap
//
// Auth model. Anonymous, exactly like the signaling relay. The room id
// itself IS the capability — it's 80 bits of unguessable entropy
// generated client-side via <c>crypto.getRandomValues</c>, and anyone
// who knows it is by definition someone the host shared the link with.
// When per-room ACLs land (cloud-backend phase), gating moves to a
// short-lived per-room token issued by the API alongside the share URL.

using System.Text.RegularExpressions;

namespace Viritura.Api.Signaling;

public static partial class SnapshotEndpoint
{
    /// <summary>
    /// Upper bound on stored snapshot size. 16 MB comfortably covers a full
    /// symphonic part set (largest realistic MNX score today is ~10 MB) and
    /// caps server memory at a fixed cost per active room. Anything larger
    /// indicates either misuse or a real product question about whether
    /// this transport is the right shape.
    /// </summary>
    public const long MaxSnapshotBytes = 16 * 1024 * 1024;

    /// <summary>
    /// Mirror of <c>packages/crdt/src/roomId.ts</c>'s ROOM_ID_PATTERN.
    /// Keep these two in sync — if the client minting rule changes we
    /// must accept the new shape here, and rejecting an in-flight client's
    /// id silently breaks live collab.
    /// </summary>
    [GeneratedRegex("^[a-z2-9]{16}$")]
    private static partial Regex RoomIdRegex();

    public static IResult Get(
        string roomId,
        HttpContext context,
        IRoomSnapshotStore store,
        SnapshotTransferLimiter transfers)
    {
        if (!RoomIdRegex().IsMatch(roomId))
        {
            return Results.BadRequest();
        }

        var snapshot = store.TryGet(roomId);
        if (snapshot is null)
        {
            return Results.NotFound();
        }

        var sourceIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        if (!transfers.TryConsumeDownload(sourceIp, snapshot.LongLength))
        {
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        }

        context.Response.Headers.CacheControl = "no-store";
        return Results.File(snapshot, "application/octet-stream");
    }

    public static async Task<IResult> PutAsync(
        string roomId,
        HttpContext context,
        IRoomSnapshotStore store,
        SnapshotTransferLimiter transfers)
    {
        if (!RoomIdRegex().IsMatch(roomId))
        {
            return Results.BadRequest();
        }

        // Reject obviously-too-large uploads from the Content-Length header
        // before we allocate anything; the streaming check below catches
        // the chunked-encoding case where the declared length is missing
        // or lies.
        if (context.Request.ContentLength is { } declaredLength && declaredLength > MaxSnapshotBytes)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        using var uploadLease = transfers.TryAcquireUpload();
        if (uploadLease is null)
        {
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        }

        // Stream into a capped buffer. We deliberately don't reuse
        // ArrayPool here — the snapshot has to outlive this handler (it
        // sits in the store until overwritten), and renting a pool
        // buffer that we never return is worse than just allocating.
        using var buffer = new MemoryStream(capacity: 64 * 1024);
        var chunk = new byte[16 * 1024];
        while (true)
        {
            var read = await context.Request.Body.ReadAsync(chunk.AsMemory(), context.RequestAborted)
                .ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }
            if (buffer.Length + read > MaxSnapshotBytes)
            {
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            }
            await buffer.WriteAsync(chunk.AsMemory(0, read), context.RequestAborted).ConfigureAwait(false);
        }

        if (buffer.Length == 0)
        {
            // Empty body is ambiguous and almost certainly a bug — refuse
            // rather than silently wipe the room's snapshot.
            return Results.BadRequest();
        }

        var sourceIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        if (!transfers.TryConsumeNewRoom(sourceIp, roomId))
        {
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        }

        if (!transfers.TryConsumeUpload(sourceIp, buffer.Length))
        {
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        }

        var stored = store.TryPut(roomId, buffer.ToArray());
        if (stored == SnapshotPutResult.CapacityExceeded)
        {
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok();
    }
}