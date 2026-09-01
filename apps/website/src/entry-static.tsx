import { prerenderToNodeStream } from "react-dom/static";
import { createRequestHandler, RouterServer } from "@tanstack/react-router/ssr/server";
import { AppProviders } from "./App";
import { createWebsiteRouter } from "./router";
import { SITE_ORIGIN } from "./seo";
export { sitemapRoutes, staticRoutes } from "./seo";

export interface StaticRouteRender {
  html: string;
  injectedHtml: string;
}

export async function renderRoute(url: string): Promise<StaticRouteRender> {
  const request = new Request(new URL(url, SITE_ORIGIN));
  const handler = createRequestHandler({ request, createRouter: createWebsiteRouter });

  const response = await handler(async ({ router }) => {
    try {
      const { prelude, postponed } = await prerenderToNodeStream(
        <AppProviders>
          <RouterServer router={router} />
        </AppProviders>,
      );
      if (postponed) throw new Error(`Static render for ${url} was postponed.`);

      let html = "";
      for await (const chunk of prelude) html += chunk.toString();
      if (!html) {
        const matches = router.state.matches.map((match) => ({ id: match.routeId, status: match.status }));
        throw new Error(`Static render for ${url} was empty: ${JSON.stringify(matches)}`);
      }

      const serverSsr = router.serverSsr;
      serverSsr?.setRenderFinished();
      if (serverSsr && !serverSsr.isSerializationFinished()) {
        await new Promise<void>((resolve) => serverSsr.onSerializationFinished(resolve));
      }
      const injectedHtml = serverSsr?.takeBufferedHtml() ?? "";
      return Response.json({ html, injectedHtml } satisfies StaticRouteRender);
    } finally {
      router.serverSsr?.cleanup();
    }
  });

  return (await response.json()) as StaticRouteRender;
}
