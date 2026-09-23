import { describe, expect, it, vi } from "vitest";
import { connectAndPublishRemote } from "../connectAndPublishRemote";
import { InMemoryFs } from "../fs/inMemoryFs";
import { initRepo } from "../GitProjectAdapter";

const SCORE = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [{ name: "Flute", measures: [{}] }],
});

describe("connectAndPublishRemote", () => {
  it("publishes an empty remote after configuring it", async () => {
    const adapter = await initRepo({
      fs: new InMemoryFs(),
      name: "p",
      scorePath: "score.mnx",
      initialJson: SCORE,
    });
    const push = vi.spyOn(adapter, "push").mockResolvedValue();

    await connectAndPublishRemote(adapter, {
      remote: "origin",
      url: "https://github.com/peter/quartet.git",
      compatibility: { kind: "empty", branch: "main", localAhead: 1, remoteAhead: 0 },
      corsProxy: "https://api.example.test/github/git",
    });

    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ remoteRef: "main" }));
    expect((await adapter.status()).remoteUrl).toBe("https://github.com/peter/quartet.git");
  });

  it("runs the same publication operation when histories already match", async () => {
    const adapter = await initRepo({
      fs: new InMemoryFs(),
      name: "p",
      scorePath: "score.mnx",
      initialJson: SCORE,
    });
    const push = vi.spyOn(adapter, "push").mockResolvedValue();

    await connectAndPublishRemote(adapter, {
      remote: "origin",
      url: "https://github.com/peter/quartet.git",
      compatibility: { kind: "up-to-date", branch: "main", localAhead: 0, remoteAhead: 0 },
      corsProxy: "https://api.example.test/github/git",
    });

    expect(push).toHaveBeenCalledOnce();
  });

  it("removes the remote when publication fails", async () => {
    const adapter = await initRepo({
      fs: new InMemoryFs(),
      name: "p",
      scorePath: "score.mnx",
      initialJson: SCORE,
    });
    vi.spyOn(adapter, "push").mockRejectedValue(new Error("Push rejected"));

    await expect(
      connectAndPublishRemote(adapter, {
        remote: "origin",
        url: "https://github.com/peter/quartet.git",
        compatibility: { kind: "empty", branch: "main", localAhead: 1, remoteAhead: 0 },
        corsProxy: "https://api.example.test/github/git",
      }),
    ).rejects.toThrow("Push rejected");
    expect((await adapter.status()).remoteUrl).toBeNull();
  });
});
