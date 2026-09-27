import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { DOC_SECTION_LABELS, type DocSection } from "./docPageMeta";
import { docGroupsInSection, docPagesInSection, docSectionHome, findDocPage, type DocPage } from "./docsManifest";
import { getModifierKeyLabels, renderDoc, type TocEntry } from "./renderDoc";
import { useActiveTocHeading } from "./tocScrollSpy";
import { DocSnippetHost } from "./interactiveSnippets";
import { DocsCodeHost } from "./DocsCodeHost";

interface DocsPageProps {
  slug: string;
  /** Site section this route serves; pages from another section are not found. Default `guide`. */
  section?: DocSection;
}

/**
 * Multi-page documentation view: a left sidebar listing the pages of the
 * current section (`/docs` or `/developers`, grouped), the rendered markdown
 * in the centre, and an on-page table of contents on the right. All markdown
 * comes from `docs/` — see {@link ./docsManifest}.
 */
export function DocsPage({ slug, section = "guide" }: DocsPageProps) {
  const page = findDocPageForSection(slug, section);
  const modifierKeys = useMemo(() => getModifierKeyLabels(), []);
  const rendered = useMemo(() => {
    const source = findDocPageForSection(slug, section);
    return source ? renderDoc(source.raw, modifierKeys) : null;
  }, [modifierKeys, section, slug]);
  const sectionPages = docPagesInSection(section);
  const pageIndex = sectionPages.findIndex((candidate) => candidate.slug === slug);
  const previousPage = pageIndex > 0 ? sectionPages[pageIndex - 1] : undefined;
  const nextPage = pageIndex >= 0 ? sectionPages[pageIndex + 1] : undefined;

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
      <DocsSidebar activeSlug={slug} section={section} />
      <article className="docs-content">
        {page && rendered ? (
          <>
            <DocsProse html={rendered.html} />
            <DocsPager previousPage={previousPage} nextPage={nextPage} />
          </>
        ) : (
          <DocsNotFound section={section} />
        )}
      </article>
      {rendered && rendered.toc.length > 1 && <DocsToc toc={rendered.toc} />}
    </div>
  );
}

interface CodeMount {
  readonly key: string;
  readonly element: HTMLElement;
  readonly source: string;
  readonly fence: string;
}

function DocsProse({ html }: { html: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [mounts, setMounts] = useState<readonly { id: string; element: HTMLElement }[]>([]);
  const [codeMounts, setCodeMounts] = useState<readonly CodeMount[]>([]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const nextMounts = [...content.querySelectorAll<HTMLElement>("[data-doc-embed]")]
      .map((element) => ({ id: element.dataset.docEmbed, element }))
      .filter((mount): mount is { id: string; element: HTMLElement } => Boolean(mount.id));
    setMounts(nextMounts);
    setCodeMounts(
      [...content.querySelectorAll<HTMLElement>("[data-doc-code]")].map((element, index) => ({
        key: `code-${index}`,
        element,
        source: (element.querySelector("pre code")?.textContent ?? "").replace(/\n$/, ""),
        fence: element.dataset.docCode ?? "",
      })),
    );
  }, [html]);

  return (
    <>
      <div ref={contentRef} className="docs-prose" dangerouslySetInnerHTML={{ __html: html }} />
      {mounts.map(({ id, element }) => createPortal(<DocSnippetHost key={id} id={id} />, element, id))}
      {codeMounts.map(({ key, element, source, fence }) =>
        createPortal(<DocsCodeHost host={element} source={source} fence={fence} />, element, key),
      )}
    </>
  );
}

function DocsPager({ previousPage, nextPage }: { previousPage?: DocPage; nextPage?: DocPage }) {
  return (
    <nav className="docs-pager" aria-label="Documentation pages">
      {previousPage ? (
        <a className="docs-pager-link" href={previousPage.path}>
          <span>Previous</span>
          {previousPage.title}
        </a>
      ) : (
        <span />
      )}
      {nextPage && (
        <a className="docs-pager-link docs-pager-link--next" href={nextPage.path}>
          <span>Next</span>
          {nextPage.title}
        </a>
      )}
    </nav>
  );
}

function DocsSidebar({ activeSlug, section }: { activeSlug: string; section: DocSection }) {
  const activePage = findDocPageForSection(activeSlug, section) ?? docSectionHome(section);
  return (
    <>
      <nav className="docs-sidebar" aria-label={DOC_SECTION_LABELS[section]}>
        <DocsNavGroups activeSlug={activeSlug} section={section} />
      </nav>
      <details className="docs-mobile-index">
        <summary>
          <span>{DOC_SECTION_LABELS[section]}</span>
          {activePage.title}
        </summary>
        <nav aria-label={DOC_SECTION_LABELS[section]}>
          <DocsNavGroups activeSlug={activeSlug} section={section} />
        </nav>
      </details>
    </>
  );
}

function DocsNavGroups({ activeSlug, section }: { activeSlug: string; section: DocSection }) {
  return docGroupsInSection(section).map((group) => (
    <div key={group} className="docs-sidebar-group">
      <div className="docs-sidebar-heading">{group}</div>
      <ul className="docs-sidebar-list">
        {docPagesInSection(section)
          .filter((page) => page.group === group)
          .map((page) => (
            <li key={page.slug}>
              <a
                href={page.path}
                className="docs-sidebar-link"
                aria-current={page.slug === activeSlug ? "page" : undefined}
                onClick={closeMobileIndex}
              >
                {page.title}
              </a>
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

function DocsNotFound({ section }: { section: DocSection }) {
  const fallback: DocPage = docSectionHome(section);
  return (
    <div className="docs-prose">
      <h1>Page not found</h1>
      <p>There&rsquo;s no page at this address.</p>
      <p>
        <a href={fallback.path}>Go to {fallback.title} →</a>
      </p>
    </div>
  );
}

function findDocPageForSection(slug: string, section: DocSection): DocPage | undefined {
  const page = findDocPage(slug);
  return page?.section === section ? page : undefined;
}
