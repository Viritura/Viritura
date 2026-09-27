import { useCallback, useState, type CSSProperties } from "react";
import { Editor, type BeforeMount, type OnMount, type editor } from "@viritura/monaco-react";
import { monacoLanguageForFence } from "./docsCodeLanguage";

interface DocsCodeBlockProps {
  readonly source: string;
  readonly fence: string;
  /** The server-rendered `<pre>` wrapper; marked ready once Monaco has painted. */
  readonly host: HTMLElement;
}

const THEME = "viritura-docs";
const LINE_HEIGHT = 20;
const PADDING = 16;
const SCROLLBAR = 10;

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  domReadOnly: true,
  // Monaco requires numeric sizes; these match the docs' 0.85em monospace.
  fontSize: 13,
  lineHeight: LINE_HEIGHT,
  fontFamily: '"SFMono-Regular", ui-monospace, "Cascadia Code", monospace',
  padding: { top: PADDING, bottom: PADDING },
  lineNumbers: "off",
  folding: false,
  glyphMargin: false,
  lineDecorationsWidth: 16,
  lineNumbersMinChars: 0,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  scrollbar: {
    vertical: "hidden",
    horizontal: "auto",
    horizontalScrollbarSize: SCROLLBAR,
    alwaysConsumeMouseWheel: false,
  },
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  renderLineHighlight: "none",
  occurrencesHighlight: "off",
  selectionHighlight: false,
  matchBrackets: "never",
  guides: { indentation: false },
  stickyScroll: { enabled: false },
  contextmenu: false,
  links: false,
  renderValidationDecorations: "off",
  automaticLayout: true,
  wordWrap: "off",
};

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      // --site-paper-raised, so samples sit on the same paper as the prose.
      "editor.background": "#fbfaf6",
      "editor.lineHighlightBackground": "#00000000",
    },
  });
};

function initialHeight(source: string): number {
  return source.split("\n").length * LINE_HEIGHT + PADDING * 2;
}

/** Read-only Monaco view of one fenced code sample, sized to its content. */
export default function DocsCodeBlock({ source, fence, host }: DocsCodeBlockProps) {
  const [height, setHeight] = useState(() => initialHeight(source));
  const [copied, setCopied] = useState(false);
  const style: CSSProperties = { height };

  const handleMount = useCallback<OnMount>(
    (codeEditor) => {
      const fit = () => {
        const scrollbar = codeEditor.getScrollWidth() > codeEditor.getLayoutInfo().contentWidth ? SCROLLBAR : 0;
        setHeight(codeEditor.getContentHeight() + scrollbar);
      };
      codeEditor.onDidContentSizeChange(fit);
      codeEditor.onDidLayoutChange(fit);
      fit();
      host.setAttribute("data-ready", "true");
    },
    [host],
  );

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [source]);

  return (
    <div className="docs-code-editor">
      <div className="docs-code-editor-surface" style={style}>
        <Editor
          value={source}
          language={monacoLanguageForFence(fence)}
          theme={THEME}
          options={EDITOR_OPTIONS}
          beforeMount={defineTheme}
          onMount={handleMount}
        />
      </div>
      <button type="button" className="docs-code-copy" onClick={copy} aria-label="Copy code">
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {copied ? "Code copied to clipboard" : ""}
      </span>
    </div>
  );
}
