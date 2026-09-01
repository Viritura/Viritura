import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { canonicalUrl, findSeoRoute } from "./routeCatalog";

function setNamedMeta(name: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.name = name;
    document.head.append(element);
  }
  element.content = content;
}

export function ClientMetadata() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    const route = findSeoRoute(pathname);
    document.title = route.title;
    setNamedMeta("description", route.description);
    setNamedMeta("robots", route.indexable ? "index, follow" : "noindex, nofollow");

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = canonicalUrl(route);
  }, [pathname]);

  return null;
}
