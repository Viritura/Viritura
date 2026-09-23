import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatedGitHubRepository } from "../github/api";
import type { RemoteCompatibility } from "../git/ProjectAdapter";
import { useGitHubRepositoryConnection } from "./useGitHubRepositoryConnection";

const findGitHubRepository = vi.hoisted(() => vi.fn());
const listGitHubRepositories = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("../github/api", () => ({
  findGitHubRepository,
  listGitHubRepositories,
}));

function repository(name: string): CreatedGitHubRepository {
  return {
    id: name === "first" ? 1 : 2,
    name,
    fullName: `viritura/${name}`,
    htmlUrl: `https://github.com/viritura/${name}`,
    cloneUrl: `https://github.com/viritura/${name}.git`,
    private: true,
    defaultBranch: "main",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("useGitHubRepositoryConnection", () => {
  beforeEach(() => {
    findGitHubRepository.mockReset();
    listGitHubRepositories.mockClear();
  });

  it("ignores an older compatibility result after a newer repository check", async () => {
    const firstInspection = deferred<RemoteCompatibility>();
    const secondInspection = deferred<RemoteCompatibility>();
    findGitHubRepository.mockImplementation(async (_owner: string, name: string) => repository(name));
    const onInspect = vi.fn((candidate: CreatedGitHubRepository) =>
      candidate.name === "first" ? firstInspection.promise : secondInspection.promise,
    );
    const { result } = renderHook(() =>
      useGitHubRepositoryConnection({
        open: true,
        ownerLogin: "viritura",
        defaultRepositoryName: "score",
        onInspect,
      }),
    );

    act(() => result.current.setStep("link"));
    act(() => result.current.setRepositoryInput("viritura/first"));
    act(() => void result.current.checkExisting());
    await waitFor(() => expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ name: "first" })));

    act(() => result.current.setRepositoryInput("viritura/second"));
    act(() => void result.current.checkExisting());
    await waitFor(() => expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ name: "second" })));

    act(() => secondInspection.resolve({ kind: "empty", branch: "main", localAhead: 1, remoteAhead: 0 }));
    await waitFor(() => expect(result.current.detectedRepository?.name).toBe("second"));

    act(() => firstInspection.resolve({ kind: "unrelated", branch: "main", localAhead: 0, remoteAhead: 0 }));
    await waitFor(() => expect(result.current.compatibility?.kind).toBe("empty"));
    expect(result.current.detectedRepository?.name).toBe("second");
  });
});
