import type { ProjectAdapter, RemoteCompatibility } from "./ProjectAdapter";

export async function connectAndPublishRemote(
  adapter: ProjectAdapter,
  options: {
    remote: string;
    url: string;
    compatibility: RemoteCompatibility;
    corsProxy: string;
  },
): Promise<void> {
  if (!["empty", "up-to-date", "remote-behind"].includes(options.compatibility.kind)) {
    throw new Error("The remote history is not safe to publish.");
  }
  await adapter.setRemoteUrl(options.remote, options.url);
  try {
    await adapter.push({
      remote: options.remote,
      remoteRef: options.compatibility.branch,
      corsProxy: options.corsProxy,
    });
  } catch (error) {
    await adapter.removeRemote(options.remote);
    throw error;
  }
}
