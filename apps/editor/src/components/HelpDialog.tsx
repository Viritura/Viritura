import { type CSSProperties, useMemo } from "react";
import { X, ClipboardList, BookOpen } from "lucide-react";
import { Dialog, DialogHeader, DialogBody } from "@viritura/ui";
import shortcutsMd from "../../../../docs/spec/keyboard-shortcuts.md?raw";

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Help dialog. The keyboard-shortcut tables are sourced from
 * `docs/spec/keyboard-shortcuts.md` so the same document renders on GitHub
 * *and* drives the in-app help. The "Getting Started" intro at the top
 * of the dialog is hand-written here.
 */
const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

const WEBSITE_BASE_URL =
  (import.meta.env.VITE_VIRITURA_WEBSITE_URL as string | undefined)?.replace(/\/+$/, "") ??
  (import.meta.env.DEV ? "http://localhost:5180" : "https://viritura.com");
const DOCS_URL = `${WEBSITE_BASE_URL}/docs`;

const QUICK_GUIDES = [
  { slug: "getting-started", label: "Getting started" },
  { slug: "instruments-and-scores", label: "Scores, parts, and layouts" },
  { slug: "percussion-maps", label: "Edit percussion maps" },
  { slug: "note-entry", label: "Enter notes" },
  { slug: "notation-and-editing", label: "Edit notation" },
  { slug: "engraving-and-layout", label: "Engrave and lay out" },
  { slug: "playback-and-piano-roll", label: "Playback and mixer" },
  { slug: "collaboration", label: "Collaborate live" },
  { slug: "mcp", label: "Connect MCP" },
  { slug: "publishing-and-export", label: "Publish PDFs" },
] as const;

interface ParsedSection {
  title: string;
  rows: Array<[string, string]>;
}

interface ParsedContext {
  id: string;
  title: string;
  sections: ParsedSection[];
}

/**
 * Parse the shortcuts markdown into contexts → sections → rows.
 *
 * Format expected:
 *   ## Context Title {#contextId}
 *   ### Section Title           (optional, otherwise rows go into a default section)
 *   | Key | Action |
 *   |-----|--------|
 *   | F1  | Open help |
 *
 * Tables outside any `## {#id}` block are ignored.
 */
function parseShortcutsMarkdown(md: string): ParsedContext[] {
  const lines = md.split(/\r?\n/);
  const contexts: ParsedContext[] = [];
  let currentCtx: ParsedContext | null = null;
  let currentSection: ParsedSection | null = null;
  let inTable = false;

  const ensureSection = (): ParsedSection => {
    if (!currentCtx) throw new Error("table outside context");
    if (!currentSection) {
      currentSection = { title: "", rows: [] };
      currentCtx.sections.push(currentSection);
    }
    return currentSection;
  };

  for (const raw of lines) {
    const line = raw.trim();

    // Context heading: `## Title {#id}`
    const ctxMatch = line.match(/^##\s+(.+?)\s*\{#([\w-]+)\}\s*$/);
    if (ctxMatch) {
      currentCtx = { id: ctxMatch[2]!, title: ctxMatch[1]!, sections: [] };
      contexts.push(currentCtx);
      currentSection = null;
      inTable = false;
      continue;
    }

    // Other top-level heading ends current context capture.
    if (line.startsWith("## ")) {
      currentCtx = null;
      currentSection = null;
      inTable = false;
      continue;
    }

    if (!currentCtx) continue;

    // Section heading: `### Title`
    if (line.startsWith("### ")) {
      currentSection = { title: line.slice(4).trim(), rows: [] };
      currentCtx.sections.push(currentSection);
      inTable = false;
      continue;
    }

    // Table header: `| Key | Action |`
    if (/^\|\s*Key\s*\|/i.test(line)) {
      ensureSection();
      inTable = true;
      continue;
    }
    // Table separator: `|---|---|`
    if (inTable && /^\|\s*[:-]+\s*\|/.test(line)) continue;

    // Table row.
    if (inTable && line.startsWith("|")) {
      const cells = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
      if (cells.length >= 2) {
        const key = stripBackticks(cells[0]!);
        const action = cells.slice(1).join(" | ").trim();
        ensureSection().rows.push([key, action]);
      }
      continue;
    }

    if (line === "" || !line.startsWith("|")) {
      inTable = false;
    }
  }

  return contexts;
}

function stripBackticks(s: string): string {
  return s.replace(/`/g, "").trim();
}

/** Replace `Mod` with the platform-appropriate key name. */
function localizeKey(key: string): string {
  if (!IS_MAC) return key;
  return key
    .replace(/\bMod\b/g, "⌘")
    .replace(/\bCtrl\b/g, "⌃")
    .replace(/\bAlt\b/g, "⌥")
    .replace(/\bShift\b/g, "⇧");
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const contexts = useMemo(() => parseShortcutsMarkdown(shortcutsMd), []);

  return (
    <Dialog open={open} onClose={onClose} size="wide">
      <DialogHeader title="Viritura — Help" onClose={onClose} closeIcon={<X size={14} />} />

      <DialogBody>
        <Section title="Getting Started">
          <p>
            Viritura is an MNX-based music notation editor. Create scores, add notes by clicking the staff or via note
            input, and edit with keyboard shortcuts.
          </p>
          <ol style={HELP_OL_STYLE}>
            <li>
              Press <Kbd>N</Kbd> to enter <strong>Note Input Mode</strong>
            </li>
            <li>
              Pick a duration from the toolbar (or press <Kbd>1</Kbd>–<Kbd>8</Kbd>)
            </li>
            <li>
              Click the staff where you want the note, or type <Kbd>A</Kbd>–<Kbd>G</Kbd>
            </li>
            <li>
              Press <Kbd>N</Kbd> or <Kbd>Esc</Kbd> to exit note input
            </li>
            <li>Click any note to select and edit it</li>
          </ol>
          <p style={noteStyle}>
            Use the quick guides for step-by-step workflows, or browse the complete shortcut reference below.
          </p>
          <nav aria-label="Help guides">
            <ul style={GUIDE_LIST_STYLE}>
              {QUICK_GUIDES.map((guide) => (
                <li key={guide.slug}>
                  <a
                    href={`${DOCS_URL}/${guide.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={MORE_LINK_STYLE}
                  >
                    {guide.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <p style={MORE_P_STYLE}>
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" style={MORE_LINK_STYLE}>
              <BookOpen size={14} style={MORE_ICON_STYLE} /> Read the full documentation
            </a>
            {" — "}
            <span style={MORE_DESC_STYLE}>
              Step-by-step guides for note entry, scores and parts, viewing, and more.
            </span>
          </p>
        </Section>

        {contexts.map((ctx) => (
          <Section key={ctx.id} title={ctx.title}>
            <div data-testid={`shortcuts-${ctx.id}`}>
              {ctx.sections.map((sec, i) => (
                <ShortcutBlock key={`${ctx.id}-${i}`} title={sec.title} rows={sec.rows} />
              ))}
            </div>
            <p style={REFERENCE_LINK_STYLE}>
              <a
                href={`${DOCS_URL}/keyboard-shortcuts#${ctx.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={MORE_LINK_STYLE}
              >
                Open {ctx.title.toLowerCase()} reference
              </a>
            </p>
          </Section>
        ))}

        <Section title="More">
          <p style={MORE_P_STYLE}>
            <a href="#/examples" target="_blank" rel="noopener noreferrer" style={MORE_LINK_STYLE}>
              <ClipboardList size={14} style={MORE_ICON_STYLE} /> Score Examples &amp; Reference Images
            </a>
            {" — "}
            <span style={MORE_DESC_STYLE}>Browse all MNX example scores side-by-side with reference renderings.</span>
          </p>
        </Section>
      </DialogBody>
    </Dialog>
  );
}

function ShortcutBlock({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  if (rows.length === 0) return null;
  return (
    <div style={shortcutBlockWrapStyle(!!title)}>
      {title && <h4 style={SHORTCUT_SUBHEAD_STYLE}>{title}</h4>}
      <table style={SHORTCUT_TABLE_STYLE}>
        <tbody>
          {rows.map(([key, desc]) => (
            <tr key={`${key}-${desc}`} style={SHORTCUT_TR_STYLE}>
              <td style={SHORTCUT_KEY_CELL_STYLE}>{localizeKey(key)}</td>
              <td style={SHORTCUT_DESC_CELL_STYLE}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={SECTION_WRAP_STYLE}>
      <h3 style={SECTION_HEAD_STYLE}>{title}</h3>
      {children}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd style={KBD_STYLE}>{children}</kbd>;
}

const noteStyle: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  fontStyle: "italic",
  margin: "0.3rem 0 0",
};

const HELP_OL_STYLE: CSSProperties = { paddingLeft: "1.2rem", margin: "0.5rem 0" };
const GUIDE_LIST_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
  gap: "0.3rem 1rem",
  paddingLeft: "1.2rem",
  margin: "0.5rem 0 0.75rem",
  fontSize: "var(--type-small-size)",
};
const MORE_P_STYLE: CSSProperties = { fontSize: "var(--type-small-size)", margin: "0.3rem 0" };
const REFERENCE_LINK_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  margin: "0.45rem 0 0",
  textAlign: "right",
};
const MORE_LINK_STYLE: CSSProperties = {
  color: "var(--accent)",
  textDecoration: "none",
  fontWeight: "var(--type-heading-weight)",
};
const MORE_ICON_STYLE: CSSProperties = { verticalAlign: "middle", marginRight: 4 };
const MORE_DESC_STYLE: CSSProperties = { color: "var(--text-muted)" };
const SHORTCUT_TABLE_STYLE: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "var(--type-small-size)",
};
const SHORTCUT_TR_STYLE: CSSProperties = { borderBottom: "1px solid var(--border)" };
const SHORTCUT_KEY_CELL_STYLE: CSSProperties = {
  padding: "0.2rem 0.5rem 0.2rem 0",
  fontWeight: "var(--type-heading-weight)",
  whiteSpace: "nowrap",
  width: "40%",
  color: "var(--text)",
};
const SHORTCUT_DESC_CELL_STYLE: CSSProperties = { padding: "0.2rem 0", color: "var(--text-muted)" };
const SHORTCUT_SUBHEAD_STYLE: CSSProperties = {
  margin: "0 0 0.2rem",
  fontSize: "var(--type-small-size)",
  color: "var(--text)",
};
const SECTION_WRAP_STYLE: CSSProperties = { marginBottom: "1rem" };
const SECTION_HEAD_STYLE: CSSProperties = {
  margin: "0 0 0.4rem",
  fontSize: "var(--type-body-size)",
  color: "var(--accent)",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "0.2rem",
};
const KBD_STYLE: CSSProperties = {
  display: "inline-block",
  padding: "0.12rem 0.4rem",
  border: "none",
  borderRadius: "5px",
  background: "var(--surface-raised)",
  boxShadow: "var(--elevation-0)",
  fontFamily: "system-ui, sans-serif",
  fontSize: "var(--type-eyebrow-size)",
  lineHeight: 1.4,
  color: "var(--text)",
};
function shortcutBlockWrapStyle(hasTitle: boolean): CSSProperties {
  return { marginTop: hasTitle ? "0.75rem" : 0 };
}
