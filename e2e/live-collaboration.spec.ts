/**
 * Two-peer live-collaboration awareness E2E.
 *
 * Asserts that when two pages open the same <c>?live=ROOMID</c> URL, each
 * one sees a remote-cursor chip for the other peer rendered by
 * <c>CollaboratorPresence</c>. This proves the full Phase 5a wire is hot:
 * Y.Doc lifecycle, transport, awareness publishing, and the editor-side
 * rendering pipeline.
 *
 * **Transport choice.** This test uses
 * <c>?live-transport=broadcast-channel</c> so it depends on zero network —
 * two pages in the same browser context share a <c>BroadcastChannel</c>.
 * That has two consequences:
 *
 *   1. **Hermetic & deterministic.** No reliance on
 *      <c>wss://signaling.yjs.dev</c> (which can be DNS-blocked, behind a
 *      strict firewall, or simply down).
 *   2. **Same-origin only.** Real cross-machine collaboration uses
 *      <c>?live-transport=webrtc</c> (the default). That path is smoke
 *      tested manually; this CI test focuses on proving the
 *      awareness/bridge wire is correct.
 *
 * Both peers must run in the SAME <c>browser.newContext()</c> for
 * <c>BroadcastChannel</c> to cross between them.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const ROOM_ID_CHARSET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Generate a room id matching <c>@viritura/crdt</c>'s <c>isValidRoomId</c>. */
function freshRoomId(): string {
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += ROOM_ID_CHARSET[Math.floor(Math.random() * ROOM_ID_CHARSET.length)];
  }
  return id;
}

async function openPeer(context: BrowserContext, roomId: string, guestName: string): Promise<Page> {
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`[${guestName} ${msg.type()}]`, msg.text());
    }
  });
  page.on("pageerror", (err) => console.log(`[${guestName} pageerror]`, err.message));
  // Per-page init script: set the guest display name + suppress the
  // Start Center modal. Tabs in the same context share localStorage, so
  // each call clobbers the previous name — but each peer reads the
  // value on first render before the next peer opens, so it sticks
  // for the lifetime of its identity hook.
  await page.addInitScript(
    ({ name }: { name: string }) => {
      window.localStorage.setItem("viritura.live.guestName", name);
      window.localStorage.setItem("viritura.startCenter.suppress", "1");
    },
    { name: guestName },
  );
  await page.goto(`/?live=${roomId}&live-transport=broadcast-channel`);
  // Wait for the editor to boot and the local presence chip to mount.
  // The participant list only appears after a session is active, which
  // requires the default score to have loaded.
  await expect(page.getByRole("listitem").filter({ hasText: new RegExp(`^${guestName} \\(you\\)`) })).toBeVisible({
    timeout: 45_000,
  });
  return page;
}

test.describe("live collaboration: two peers awareness", () => {
  test("each peer sees the other's collaborator chip", async ({ browser }) => {
    const roomId = freshRoomId();

    // Single context so BroadcastChannel crosses between the two pages.
    const context = await browser.newContext();

    try {
      const pageA = await openPeer(context, roomId, "Alice");
      const pageB = await openPeer(context, roomId, "Bob");

      // Each side should see exactly one participant listitem carrying the
      // other peer's display name (and NOT the "(you)" suffix, which marks
      // the local chip).
      const aliceSeesBob = pageA.getByRole("listitem").filter({ hasText: "Bob" }).filter({ hasNotText: "(you)" });
      const bobSeesAlice = pageB.getByRole("listitem").filter({ hasText: "Alice" }).filter({ hasNotText: "(you)" });

      await expect(aliceSeesBob).toBeVisible({ timeout: 20_000 });
      await expect(bobSeesAlice).toBeVisible({ timeout: 20_000 });

      // Sanity: each peer's chip carries the deterministic color from
      // CRDT's colorForUserId — verify it's a usable CSS color, not blank.
      const aliceChipColor = await pageB
        .getByRole("listitem")
        .filter({ hasText: "Alice" })
        .filter({ hasNotText: "(you)" })
        .evaluate((el) => window.getComputedStyle(el).color);
      expect(aliceChipColor).not.toBe("");
      expect(aliceChipColor).not.toBe("rgba(0, 0, 0, 0)");
    } finally {
      await context.close();
    }
  });

  /**
   * When the host (the peer who seeded the doc and recorded their
   * clientID in <c>_meta.hostClientId</c>) leaves the room, every
   * remaining guest must be evicted from the live session within the
   * grace period. Guests own no canonical state, so silently promoting
   * one would be wrong.
   */
  test("guests are kicked when the host disconnects", async ({ browser }) => {
    const roomId = freshRoomId();
    const context = await browser.newContext();

    try {
      const pageA = await openPeer(context, roomId, "Alice");
      const pageB = await openPeer(context, roomId, "Bob");

      // Wait for both peers to see each other — proves session is fully
      // established and the host claim has settled.
      await expect(pageA.getByRole("listitem").filter({ hasText: "Bob" }).filter({ hasNotText: "(you)" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        pageB.getByRole("listitem").filter({ hasText: "Alice" }).filter({ hasNotText: "(you)" }),
      ).toBeVisible({ timeout: 20_000 });

      // Both peers join via `?live=` URLs, and useBootSequence
      // intentionally skips the default-score load on those URLs (so a
      // guest doesn't stomp the host's content). That means neither peer
      // ever has anything to seed, so neither claims host. Use the test
      // seam on the diag handle to make Alice the host explicitly.
      await pageA.evaluate(() => {
        const live = (
          window as unknown as {
            __virituraLive?: { seed: (mnxJson: string) => void };
          }
        ).__virituraLive;
        live?.seed('{"mnx":{"version":1}}');
      });

      // Discover which peer the bridge crowned as host by reading the
      // diagnostics handle that LiveSessionProvider attaches to window.
      // The handle is installed by an effect that runs after the live
      // session boots, and `hostClientId` only becomes non-null once the
      // bridge's host-claim has settled — both lag presence visibility
      // by a tick or two. Poll until both pages report a host.
      const readDiag = (p: Page) =>
        p.evaluate(
          () =>
            (
              window as unknown as {
                __virituraLive?: { clientID: number; hostClientId: number | null };
              }
            ).__virituraLive ?? null,
        );
      await expect.poll(async () => (await readDiag(pageA))?.hostClientId ?? null, { timeout: 10_000 }).not.toBeNull();
      await expect.poll(async () => (await readDiag(pageB))?.hostClientId ?? null, { timeout: 10_000 }).not.toBeNull();
      const diagA = await readDiag(pageA);
      const diagB = await readDiag(pageB);
      expect(diagA).not.toBeNull();
      expect(diagB).not.toBeNull();
      const hostClientId = diagA?.hostClientId ?? diagB?.hostClientId ?? null;
      expect(hostClientId).not.toBeNull();
      const hostPage = hostClientId === diagA?.clientID ? pageA : pageB;
      const guestPage = hostPage === pageA ? pageB : pageA;
      const hostName = hostPage === pageA ? "Alice" : "Bob";

      // Close the host's page → guest should be kicked.
      // <c>page.close()</c> in Playwright does not fire <c>pagehide</c>
      // by default, so we dispatch the cleanup synchronously from the
      // host page before tearing it down. This mirrors what a real
      // browser does on tab close.
      await hostPage.evaluate(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      await hostPage.close();

      await expect(guestPage.getByText("Live session ended")).toBeVisible({
        timeout: 5_000,
      });
      await expect(
        guestPage.getByRole("listitem").filter({ hasText: hostName }).filter({ hasNotText: "(you)" }),
      ).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await context.close();
    }
  });
});
