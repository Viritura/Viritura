using System.Net;
using System.Net.Http.Headers;

using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

using Viritura.Api.Signaling;

using Xunit;

namespace Viritura.Api.Tests;

/// <summary>
/// Round-trips against the in-process snapshot endpoints. Validates the
/// HTTP contract that the client-side <c>snapshotClient.ts</c> relies on:
///   GET 404 before any PUT, GET 200 returning the exact bytes after a PUT,
///   ID validation, and the size cap.
/// </summary>
public sealed class SnapshotEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public SnapshotEndpointTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    private HttpClient CreateClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });

    // Each test mints a fresh id so the singleton in-memory store stays
    // partitioned even when xUnit runs the class's tests in parallel.
    private static string FreshRoomId()
    {
        const string charset = "abcdefghijkmnpqrstuvwxyz23456789";
        var bytes = new byte[16];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        return new string(bytes.Select(b => charset[b % charset.Length]).ToArray());
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNoSnapshotStored()
    {
        using var client = CreateClient();
        var response = await client.GetAsync($"/live/room/{FreshRoomId()}/snapshot");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PutThenGet_ReturnsExactBytes()
    {
        using var client = CreateClient();
        var roomId = FreshRoomId();
        var payload = new byte[] { 0x00, 0x01, 0x02, 0x7f, 0x80, 0xff };

        using var putContent = new ByteArrayContent(payload);
        putContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        var putResponse = await client.PutAsync($"/live/room/{roomId}/snapshot", putContent);
        Assert.Equal(HttpStatusCode.OK, putResponse.StatusCode);

        var getResponse = await client.GetAsync($"/live/room/{roomId}/snapshot");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        Assert.Equal("application/octet-stream", getResponse.Content.Headers.ContentType?.MediaType);
        var roundTripped = await getResponse.Content.ReadAsByteArrayAsync();
        Assert.Equal(payload, roundTripped);
    }

    [Fact]
    public async Task Put_OverwritesPreviousSnapshot()
    {
        using var client = CreateClient();
        var roomId = FreshRoomId();

        using var firstSnapshot = new ByteArrayContent([0xaa, 0xbb]);
        await client.PutAsync($"/live/room/{roomId}/snapshot", firstSnapshot);
        using var secondSnapshot = new ByteArrayContent([0xcc, 0xdd, 0xee]);
        await client.PutAsync($"/live/room/{roomId}/snapshot", secondSnapshot);

        var getResponse = await client.GetAsync($"/live/room/{roomId}/snapshot");
        var roundTripped = await getResponse.Content.ReadAsByteArrayAsync();
        Assert.Equal(new byte[] { 0xcc, 0xdd, 0xee }, roundTripped);
    }

    [Theory]
    [InlineData("CAPITALCAPITAL12")] // uppercase rejected ([a-z2-9])
    [InlineData("short")] // too short
    [InlineData("zzzz1zzzz1zzzz10")] // '0' is outside the 2-9 range
    [InlineData("zzzz1zzzz1zzzz11")] // '1' is outside the 2-9 range
    [InlineData("zzzz1zzzz1zzzz123")] // 17 chars (too long)
    public async Task Get_ReturnsBadRequest_ForInvalidRoomId(string roomId)
    {
        using var client = CreateClient();
        var response = await client.GetAsync($"/live/room/{Uri.EscapeDataString(roomId)}/snapshot");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_ReturnsBadRequest_ForInvalidRoomId()
    {
        using var client = CreateClient();
        using var content = new ByteArrayContent([0x01]);
        var response = await client.PutAsync("/live/room/CAPITALCAPITAL12/snapshot", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_ReturnsBadRequest_ForEmptyBody()
    {
        using var client = CreateClient();
        using var content = new ByteArrayContent([]);
        var response = await client.PutAsync(
            $"/live/room/{FreshRoomId()}/snapshot",
            content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_ReturnsPayloadTooLarge_WhenOverCap()
    {
        using var client = CreateClient();
        // Just past the 16 MB cap declared by SnapshotEndpoint.MaxSnapshotBytes.
        var oversized = new byte[SnapshotEndpoint.MaxSnapshotBytes + 1];
        using var content = new ByteArrayContent(oversized);
        var response = await client.PutAsync($"/live/room/{FreshRoomId()}/snapshot", content);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    // ── Adversarial: storage monopolisation ─────────────────────────────────

    /// <summary>
    /// Creates a factory with a tiny per-room limit and zero pressure-eviction
    /// min age so adversarial tests run fast and deterministically.
    /// </summary>
    private WebApplicationFactory<Program> TinyStoreFactory(int maxRooms, long maxBytes) =>
        _factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.Configure<RoomSnapshotStoreOptions>(opts =>
                {
                    opts.MaxTotalBytes = maxBytes;
                    opts.MaxRoomCount = maxRooms;
                    opts.PressureEvictionMinAge = TimeSpan.Zero; // any idle entry is evictable
                });
            }));

    [Fact]
    public async Task PressureEviction_LegitimateRoomSucceeds_WhenStoreFilledByArbitraryIds()
    {
        // Two-room store; one slot filled by an attack room that is idle
        // (no active signaling). A legitimate room must still be accepted
        // via pressure eviction of the idle room.
        using var factory = TinyStoreFactory(maxRooms: 2, maxBytes: 4);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });

        var attackRoom = FreshRoomId();
        var legitRoom = FreshRoomId();

        // Fill the store's byte quota with an attack room.
        using var attackBody = new ByteArrayContent([0xAA, 0xBB, 0xCC, 0xDD]);
        var attackPut = await client.PutAsync($"/live/room/{attackRoom}/snapshot", attackBody);
        Assert.Equal(HttpStatusCode.OK, attackPut.StatusCode);

        // Legitimate room must succeed by evicting the idle attack entry.
        using var legitBody = new ByteArrayContent([0x11, 0x22]);
        var legitPut = await client.PutAsync($"/live/room/{legitRoom}/snapshot", legitBody);
        Assert.Equal(HttpStatusCode.OK, legitPut.StatusCode);

        // The legitimate room is retrievable.
        var getResp = await client.GetAsync($"/live/room/{legitRoom}/snapshot");
        Assert.Equal(HttpStatusCode.OK, getResp.StatusCode);

        // The attack room has been evicted.
        var attackGet = await client.GetAsync($"/live/room/{attackRoom}/snapshot");
        Assert.Equal(HttpStatusCode.NotFound, attackGet.StatusCode);
    }

    [Fact]
    public async Task PerSourceRoomQuota_RejectsNewRoomsAtLimit_AllowsReupload()
    {
        // Override with a 1-room-per-source-per-day limit; all requests share
        // the same loopback IP in the in-process test host.
        using var factory = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
                services.Configure<RoomSnapshotStoreOptions>(opts =>
                    opts.MaxNewRoomsPerSourcePerDay = 1)));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });

        var allowedRoom = FreshRoomId();
        var blockedRoom = FreshRoomId();

        // First distinct room from this IP is accepted.
        using var firstBody = new ByteArrayContent([0x01]);
        var firstPut = await client.PutAsync($"/live/room/{allowedRoom}/snapshot", firstBody);
        Assert.Equal(HttpStatusCode.OK, firstPut.StatusCode);

        // Second distinct room hits the per-source daily quota.
        using var secondBody = new ByteArrayContent([0x02]);
        var secondPut = await client.PutAsync($"/live/room/{blockedRoom}/snapshot", secondBody);
        Assert.Equal(HttpStatusCode.TooManyRequests, secondPut.StatusCode);

        // Re-uploading to the already-seen room is still allowed.
        using var updateBody = new ByteArrayContent([0x03, 0x04]);
        var updatePut = await client.PutAsync($"/live/room/{allowedRoom}/snapshot", updateBody);
        Assert.Equal(HttpStatusCode.OK, updatePut.StatusCode);
    }
}