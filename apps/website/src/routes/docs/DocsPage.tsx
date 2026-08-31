import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { DOC_GROUPS, DOC_PAGES, findDocPage, type DocPage } from "./docsManifest";
import { getModifierKeyLabels, renderDoc, type TocEntry } from "./renderDoc";
import { useActiveTocHeading } from "./tocScrollSpy";
import { DocSnippetHost } from "./interactiveSnippets";

interface DocsPageProps {
  slug: string;
}

/**
 * Multi-page documentation view: a left sidebar listing every doc (grouped),
 * the rendered markdown in the centre, and an on-page table of contents on the
 * right. All markdown comes from `docs/` — see {@link ./docsManifest}.
 */
export function DocsPage({ slug }: DocsPageProps) {
  const page = findDocPage(slug);
  const modifierKeys = useMemo(() => getModifierKeyLabels(), []);
  const rendered = useMemo(() => (page ? renderDoc(page.raw, modifierKeys) : null), [modifierKeys, page]);
  const pageIndex = page ? DOC_PAGES.indexOf(page) : -1;
  const previousPage = pageIndex > 0 ? DOC_PAGES[pageIndex - 1] : undefined;
  const nextPage = pageIndex >= 0 ? DOC_PAGES[pageIndex + 1] : undefined;

  // Resolve `#heading` deep links once the content is in the DOM, and on title
  // change (client-side navigation between docs keeps the component mounted).
  useEffect(() => {
    if (!rendered) return;
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView({ behavior: "auto", block: "start" });
    else window.scrollTo({ top: 0 });
  }, [rendered, slug]);

  return (
    <div className="docs">
      <DocsSidebar activeSlug={slug} />
      <article className="docs-content">
        {page && rendered ? (
          <>
            <DocsProse html={rendered.html} />
            <DocsPager previousPage={previousPage} nextPage={nextPage} />
          </>
        ) : (
          <DocsNotFound slug={slug} />
        )}
      </article>
      {rendered && rendered.toc.length > 1 && <DocsToc toc={rendered.toc} />}
    </div>
  );
}

function DocsProse({ html }: { html: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [mounts, setMounts] = useState<readonly { id: string; element: HTMLElement }[]>([]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const nextMounts = [...content.querySelectorAll<HTMLElement>("[data-doc-embed]")]
      .map((element) => ({ id: element.dataset.docEmbed, element }))
      .filter((mount): mount is { id: string; element: HTMLElement } => Boolean(mount.id));
    setMounts(nextMounts);
  }, [html]);

  return (
    <>
      <div ref={contentRef} className="docs-prose" dangerouslySetInnerHTML={{ __html: html }} />
      {mounts.map(({ id, element }) => createPortal(<DocSnippetHost key={id} id={id} />, element, id))}
    </>
  );
}

function DocsPager({ previousPage, nextPage }: { previousPage?: DocPage; nextPage?: DocPage }) {
  return (
    <nav className="docs-pager" aria-label="Documentation pages">
      {previousPage ? (
        <Link className="docs-pager-link" to="/docs/$slug" params={{ slug: previousPage.slug }}>
          <span>Previous</span>
          {previousPage.title}
        </Link>
      ) : (
        <span />
      )}
      {nextPage && (
        <Link className="docs-pager-link docs-pager-link--next" to="/docs/$slug" params={{ slug: nextPage.slug }}>
          <span>Next</span>
          {nextPage.title}
        </Link>
      )}
    </nav>
  );
}

function DocsSidebar({ activeSlug }: { activeSlug: string }) {
  const activePage = findDocPage(activeSlug) ?? DOC_PAGES[0]!;
  return (
    <>
      <nav className="docs-sidebar" aria-label="Documentation">
        <DocsNavGroups activeSlug={activeSlug} />
      </nav>
      <details className="docs-mobile-index">
        <summary>
          <span>Documentation</span>
          {activePage.title}
        </summary>
        <nav aria-label="Documentation">
          <DocsNavGroups activeSlug={activeSlug} />
        </nav>
      </details>
    </>
  );
}

function DocsNavGroups({ activeSlug }: { activeSlug: string }) {
  return DOC_GROUPS.map((group) => (
    <div key={group} className="docs-sidebar-group">
      <div className="docs-sidebar-heading">{group}</div>
      <ul className="docs-sidebar-list">
        {DOC_PAGES.filter((page) => page.group === group).map((page) => (
          <li key={page.slug}>
            <Link
              to="/docs/$slug"
              params={{ slug: page.slug }}
              className="docs-sidebar-link"
              aria-current={page.slug === activeSlug ? "page" : undefined}
              onClick={closeMobileIndex}
            >
              {page.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ));
}

function closeMobileIndex(event: MouseEvent<HTMLAnchorElement>) {
  event.currentTarget.closest("details")?.removeAttribute("open");
}

function DocsToc({ toc }: { toc: TocEntry[] }) {
  const activeId = useActiveTocHeading(toc);

  return (
    <aside className="docs-toc" aria-label="On this page">
      <div className="docs-toc-heading">On this page</div>
      <ul className="docs-toc-list">
        {toc.map((entry) => (
          <li key={entry.id} data-level={entry.level}>
            <a href={`#${entry.id}`} aria-current={entry.id === activeId ? "location" : undefined}>
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function DocsNotFound({ slug }: { slug: string }) {
  const fallback: DocPage = DOC_PAGES[0]!;
  return (
    <div className="docs-prose">
      <h1>Page not found</h1>
      <p>
        There&rsquo;s no documentation page at <code>/docs/{slug}</code>.
      </p>
      <p>
        <Link to="/docs/$slug" params={{ slug: fallback.slug }}>
          Go to {fallback.title} →
        </Link>
      </p>
    </div>
  );
}
