import type { Plugin } from "vite";

export function clickPagePlugin(): Plugin {
  return {
    name: "viritura-click-page",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === "/click" || url.pathname === "/click/") {
          request.url = `/click/index.html${url.search}`;
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (item) =>
          item.type === "chunk" &&
          item.isEntry &&
          item.facadeModuleId?.replaceAll("\\", "/").endsWith("/click/index.html"),
      );
      if (!entry || entry.type !== "chunk") this.error("The standalone click entry is missing");
      const pending = [entry.fileName];
      const visited = new Set<string>();
      while (pending.length) {
        const name = pending.pop()!;
        if (visited.has(name)) continue;
        visited.add(name);
        const chunk = bundle[name];
        if (!chunk || chunk.type !== "chunk") continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          const normalized = id.replaceAll("\\", "/");
          if (module.renderedLength === 0) continue;
          if (
            /\/packages\/(?:score-engine|renderer|crdt|video-sync)\//.test(normalized) ||
            /\/(?:spessasynth_core|spessasynth_lib)\//.test(normalized) ||
            /\/apps\/editor\/src\/(?:mcpSession|instrumentProfiles|store)\//.test(normalized) ||
            /\/packages\/playback\/src\/PlaybackContext\.tsx/.test(normalized)
          )
            this.error(`The standalone click page must not load ${id}`);
        }
        pending.push(...chunk.imports, ...chunk.dynamicImports);
      }
    },
  };
}
