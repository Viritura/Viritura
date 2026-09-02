import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Pencil, Plus, Minus, Circle, ChevronDown, ChevronRight } from "lucide-react";
import { DiffEditor, Editor } from "@viritura/monaco-react";
import type { DiffNode, DiffType } from "../diff/semanticDiff";

// ─── Style constants ─────────────────────────────────────────────

const TYPE_COLORS: Record<DiffType, string> = {
  modified: "var(--accent)",
  added: "var(--accent)",
  removed: "var(--error)",
  unchanged: "var(--text-muted)",
};

const _TYPE_BG: Record<DiffType, string> = {
  modified: "var(--diff-modified-bg)",
  added: "var(--diff-added-bg)",
  removed: "var(--diff-removed-bg)",
  unchanged: "var(--surface)",
};

const TYPE_ICONS: Record<DiffType, ReactNode> = {
  modified: <Pencil size={12} />,
  added: <Plus size={12} />,
  removed: <Minus size={12} />,
  unchanged: <Circle size={12} />,
};

// ─── DiffTreeNode ────────────────────────────────────────────────

const EXPAND_INDICATOR_STYLE: CSSProperties = {
  width: "1rem",
  textAlign: "center",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  flexShrink: 0,
  marginTop: "0.15rem",
};
const TYPE_ICON_STYLE: CSSProperties = { flexShrink: 0, fontSize: "var(--type-eyebrow-size)", marginTop: "0.05rem" };
const LABEL_STACK_STYLE: CSSProperties = { flex: 1, minWidth: 0 };
const SUMMARY_STYLE: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  lineHeight: "1.3",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function treeRowStyle(depth: number, isSelected: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.4rem",
    padding: "0.35rem 0.5rem",
    paddingLeft: `${depth * 1.2 + 0.5}rem`,
    cursor: "pointer",
    background: isSelected ? "rgba(var(--accent-rgb, 33, 94, 78), 0.14)" : "transparent",
    borderLeft: isSelected ? "3px solid rgba(var(--accent-rgb, 33, 94, 78), 0.65)" : "3px solid transparent",
    fontSize: "var(--type-small-size)",
    lineHeight: "1.4",
    transition: "background-color 0.12s ease-out",
  };
}

function labelStyle(depth: number, type: DiffType): CSSProperties {
  return {
    fontWeight: depth === 0 ? 600 : 500,
    color: TYPE_COLORS[type],
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

interface DiffTreeNodeProps {
  node: DiffNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: DiffNode) => void;
}

function DiffTreeNode({ node, depth, selectedPath, onSelect }: DiffTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedPath === node.path;

  const handleClick = useCallback(() => {
    if (hasChildren) {
      setExpanded((prev) => !prev);
    }
    onSelect(node);
  }, [hasChildren, node, onSelect]);

  return (
    <div>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={handleClick}
        style={treeRowStyle(depth, isSelected)}
        onMouseEnter={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLDivElement).style.background = "rgba(var(--accent-rgb, 33, 94, 78), 0.07)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLDivElement).style.background = "transparent";
          }
        }}
      >
        {/* Expand/collapse indicator */}
        <span style={EXPAND_INDICATOR_STYLE}>
          {hasChildren ? expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : ""}
        </span>

        {/* Type icon */}
        <span style={TYPE_ICON_STYLE}>{TYPE_ICONS[node.type]}</span>

        {/* Label + Summary stacked */}
        <div style={LABEL_STACK_STYLE}>
          <div style={labelStyle(depth, node.type)}>{node.label}</div>
          <div style={SUMMARY_STYLE}>{node.summary}</div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div role="group">
          {node.children!.map((child, i) => (
            <DiffTreeNode
              key={child.path || `${node.path}-child-${i}`}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SnippetEditor (exported) ────────────────────────────────────

// Shared header treatment for snippet panes (added / removed / modified).
// A thin hairline divider plus a capsule "type" pill — matches the
// PanelHeader vocabulary used across the rest of the editor.
const snippetHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px 10px",
  borderBottom: "1px solid rgba(20, 20, 28, 0.06)",
  fontSize: "var(--type-small-size)",
  background: "transparent",
};
const snippetBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid",
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  flexShrink: 0,
};
const snippetLabelStyle: CSSProperties = {
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const snippetSummaryStyle: CSSProperties = {
  color: "#6a6a74",
  fontSize: "var(--type-eyebrow-size)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
  minWidth: 0,
};

const EMPTY_HINT_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "var(--text-muted)",
  fontSize: "var(--type-small-size)",
};
const UNCHANGED_HINT_STYLE: CSSProperties = { padding: "2rem", color: "var(--text-muted)", textAlign: "center" };
const SNIPPET_COL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: "100%" };
const SNIPPET_BODY_STYLE: CSSProperties = { flex: 1 };
const ADDED_HEADER_STYLE: CSSProperties = { ...snippetHeaderStyle, color: "#2e7d32" };
const ADDED_BADGE_STYLE: CSSProperties = {
  ...snippetBadgeStyle,
  background: "rgba(46,125,50,0.12)",
  borderColor: "rgba(46,125,50,0.30)",
  color: "#2e7d32",
};
const REMOVED_HEADER_STYLE: CSSProperties = { ...snippetHeaderStyle, color: "#c62828" };
const REMOVED_BADGE_STYLE: CSSProperties = {
  ...snippetBadgeStyle,
  background: "rgba(198,40,40,0.12)",
  borderColor: "rgba(198,40,40,0.30)",
  color: "#c62828",
};
const MODIFIED_HEADER_STYLE: CSSProperties = { ...snippetHeaderStyle, color: "#1565c0" };
const MODIFIED_BADGE_STYLE: CSSProperties = {
  ...snippetBadgeStyle,
  background: "rgba(21,101,192,0.12)",
  borderColor: "rgba(21,101,192,0.30)",
  color: "#1565c0",
};
const MOD_NO_SNIPPET_STYLE: CSSProperties = {
  padding: "2rem",
  color: "var(--text-muted)",
  textAlign: "center",
  fontSize: "var(--type-small-size)",
};
const MOD_NO_SNIPPET_P_STYLE: CSSProperties = { margin: "0 0 0.5rem" };
const MOD_NO_SNIPPET_HINT_STYLE: CSSProperties = { margin: 0, color: "var(--text-muted)" };

export interface SnippetEditorProps {
  node: DiffNode | null;
}

export function SnippetEditor({ node }: SnippetEditorProps) {
  if (!node) {
    return <div style={EMPTY_HINT_STYLE}>Select a change from the tree to view details.</div>;
  }

  if (node.type === "unchanged") {
    return <div style={UNCHANGED_HINT_STYLE}>No changes in this section.</div>;
  }

  // For added nodes: show only the after JSON
  if (node.type === "added" && node.afterJson) {
    return (
      <div style={SNIPPET_COL_STYLE}>
        <div style={ADDED_HEADER_STYLE}>
          <span style={ADDED_BADGE_STYLE}>
            <Plus size={11} /> Added
          </span>
          <span style={snippetLabelStyle}>{node.label}</span>
        </div>
        <div style={SNIPPET_BODY_STYLE}>
          <Editor
            value={node.afterJson}
            language="json"
            theme="vs-light"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderLineHighlight: "none",
              folding: true,
            }}
          />
        </div>
      </div>
    );
  }

  // For removed nodes: show only the before JSON
  if (node.type === "removed" && node.beforeJson) {
    return (
      <div style={SNIPPET_COL_STYLE}>
        <div style={REMOVED_HEADER_STYLE}>
          <span style={REMOVED_BADGE_STYLE}>
            <Minus size={11} /> Removed
          </span>
          <span style={snippetLabelStyle}>{node.label}</span>
        </div>
        <div style={SNIPPET_BODY_STYLE}>
          <Editor
            value={node.beforeJson}
            language="json"
            theme="vs-light"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderLineHighlight: "none",
              folding: true,
            }}
          />
        </div>
      </div>
    );
  }

  // For modified nodes: show a diff editor with before/after
  if (node.type === "modified" && node.beforeJson && node.afterJson) {
    return (
      <div style={SNIPPET_COL_STYLE}>
        <div style={MODIFIED_HEADER_STYLE}>
          <span style={MODIFIED_BADGE_STYLE}>
            <Pencil size={11} /> Modified
          </span>
          <span style={snippetLabelStyle}>{node.label}</span>
          <span style={snippetSummaryStyle}>{node.summary}</span>
        </div>
        <div style={SNIPPET_BODY_STYLE}>
          <DiffEditor
            original={node.beforeJson}
            modified={node.afterJson}
            language="json"
            theme="vs-light"
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderIndicators: true,
              renderMarginRevertIcon: false,
              originalEditable: false,
            }}
          />
        </div>
      </div>
    );
  }

  // Modified node without snippets — show children hint
  return (
    <div style={MOD_NO_SNIPPET_STYLE}>
      <p style={MOD_NO_SNIPPET_P_STYLE}>
        <strong>{node.label}</strong> — {node.summary}
      </p>
      {node.children && node.children.length > 0 && (
        <p style={MOD_NO_SNIPPET_HINT_STYLE}>Select a child node to see the detailed diff.</p>
      )}
    </div>
  );
}

// ─── DiffTreeView (public) ───────────────────────────────────────

export interface DiffTreeViewProps {
  diffTree: DiffNode;
  /** Called when a node is selected in the tree. */
  onNodeSelect?: (node: DiffNode) => void;
  /** When set, auto-selects the first tree node matching this measure index. */
  focusedMeasureIndex?: number | null;
}

/** Find a node in the original tree by path. */
function findNodeByPath(node: DiffNode, path: string): DiffNode | null {
  if (node.path === path) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeByPath(child, path);
      if (found) return found;
    }
  }
  return null;
}

import { findNodeByMeasure } from "./diffTreeFind";

/**
 * Flatten the diff tree to 2 levels: Part → Measure.
 * Everything below measure (voices, events, notes) is collapsed into the
 * measure node's summary. This keeps the tree readable for users.
 */
function flattenDiffTree(tree: DiffNode): DiffNode {
  if (!tree.children) return tree;

  // Check if this is the root — process its children (parts or globals)
  const flatChildren: DiffNode[] = [];

  for (const child of tree.children) {
    if (child.type === "unchanged") continue;

    // Is this a part-level or global-level node?
    const isPartOrGlobal = child.path.match(/^parts\[\d+\]$/) || child.path === "global";

    if (isPartOrGlobal && child.children) {
      // Flatten: keep only measure-level children, collapse deeper levels
      const flatMeasures: DiffNode[] = [];
      for (const measureNode of child.children) {
        if (measureNode.type === "unchanged") continue;
        // Remove children from measure nodes — they show in the snippet editor
        flatMeasures.push({
          ...measureNode,
          children: undefined,
        });
      }
      flatChildren.push({
        ...child,
        children: flatMeasures.length > 0 ? flatMeasures : undefined,
      });
    } else {
      // Non-part nodes (e.g. global measures at root level) — keep as leaf
      flatChildren.push({ ...child, children: undefined });
    }
  }

  return { ...tree, children: flatChildren.length > 0 ? flatChildren : undefined };
}

export function DiffTreeView({ diffTree, onNodeSelect, focusedMeasureIndex }: DiffTreeViewProps) {
  const [selectedNode, setSelectedNode] = useState<DiffNode | null>(null);
  const flatTree = useMemo(() => flattenDiffTree(diffTree), [diffTree]);

  const handleSelect = useCallback(
    (node: DiffNode) => {
      // Find the original (non-flattened) node to preserve children for event ID collection
      const origNode = findNodeByPath(diffTree, node.path);
      const nodeToSelect = origNode ?? node;
      setSelectedNode(nodeToSelect);
      onNodeSelect?.(nodeToSelect);
    },
    [onNodeSelect, diffTree],
  );

  // Auto-select node when focusedMeasureIndex changes (from canvas click)
  useEffect(() => {
    if (focusedMeasureIndex == null) return;
    const node = findNodeByMeasure(diffTree, focusedMeasureIndex);
    if (node && node.path !== selectedNode?.path) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setSelectedNode(node);
    }
  }, [focusedMeasureIndex, diffTree]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally exclude selectedNode

  if (diffTree.type === "unchanged") {
    return <div style={NO_DIFF_STYLE}>✅ No differences found — scores are identical.</div>;
  }

  return (
    <div role="tree" style={TREE_ROOT_STYLE}>
      {flatTree.children ? (
        flatTree.children.map((child, i) => (
          <DiffTreeNode
            key={child.path || `root-child-${i}`}
            node={child}
            depth={0}
            selectedPath={selectedNode?.path ?? null}
            onSelect={handleSelect}
          />
        ))
      ) : (
        <DiffTreeNode node={flatTree} depth={0} selectedPath={selectedNode?.path ?? null} onSelect={handleSelect} />
      )}
    </div>
  );
}

const NO_DIFF_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "var(--text-muted)",
  fontSize: "var(--type-body-size)",
};
const TREE_ROOT_STYLE: CSSProperties = { display: "flex", flexDirection: "column" };
