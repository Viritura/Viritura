import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./RadialMenu.module.css";

function radialMenuContainerStyle(x: number, y: number, svgSize: number): CSSProperties {
  return { left: x - svgSize / 2, top: y - svgSize / 2 };
}
function radialMenuSizeStyle(svgSize: number): CSSProperties {
  return { width: svgSize, height: svgSize };
}
function radialMenuSearchBarStyle(x: number, y: number, radius: number): CSSProperties {
  return { left: x, top: y + radius + 20 };
}
import { clampPosition, defaultRadius, filterRadialMenuItems, type RadialMenuItem } from "./radialMenuHelpers";
import { RadialPaperPatterns, RadialPaperRim } from "./RadialPaper";
import { RadialMenuWedge } from "./RadialMenuWedge";
import { RadialMenuPageArrows } from "./RadialMenuPageArrows";
import { paginate, useRadialMenuKeyboard } from "./useRadialMenu";

// Re-export item type so existing consumers keep importing from
// "@viritura/ui/RadialMenu" without any path changes. The non-component
// `filterRadialMenuItems` lives in ./radialMenuHelpers and is exported
// from @viritura/ui/index.ts (keeping this file component-only for
// react-refresh).
export type { RadialMenuItem } from "./radialMenuHelpers";

export interface RadialMenuProps {
  /** Whether the menu is open */
  open: boolean;
  /** Called when the menu should close (Escape, click outside) */
  onClose: () => void;
  /** Called when a menu item is selected */
  onSelect: (id: string) => void;
  /** Menu item definitions */
  items: RadialMenuItem[];
  /** Position to render at (screen coordinates) */
  position: { x: number; y: number };
  /** Title shown in the center hub */
  title?: string | undefined;
  /** Max items per page before paginating. Default: 8 */
  maxItemsPerPage?: number | undefined;
  /** Override item count for the first page only (e.g. 5 high-priority items).
   *  Subsequent pages use maxItemsPerPage. */
  firstPageMaxItems?: number | undefined;
  /** How the first item aligns at 12 o'clock.
   *  - "center" (default): first wedge centered at 12
   *  - "start": first wedge starts at 12 (edge at top) */
  startAlign?: "center" | "start" | undefined;
  /** Expression builder mode: given the current search text, return a ReactNode
   *  preview if the text is a valid expression, or null otherwise.
   *  When non-null, the preview is shown in the center hub and Enter submits
   *  the raw expression via onSubmitExpression. */
  renderExpression?: ((input: string) => ReactNode | null) | undefined;
  /** Called when an expression is submitted (Enter while renderExpression returns non-null). */
  onSubmitExpression?: ((expression: string) => void) | undefined;
  /** Context-specific prompt for filtering or expression entry. */
  searchPlaceholder?: string | undefined;
}

interface WedgeAngles {
  startAngle: number;
  totalWeight: number;
  cumulativeWeight: number[];
}

function computeWedgeAngles(pageItems: RadialMenuItem[], startAlign: "center" | "start"): WedgeAngles {
  const count = pageItems.length;
  const totalWeight = pageItems.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  // 1 item → center at 3 o'clock so label is horizontal
  // 2 items → top/bottom split so dividing lines are horizontal
  // 3+ → "center": first item centered at 12; "start": first edge at 12
  const firstHalfAngle =
    count >= 3 && startAlign === "center" ? ((pageItems[0]!.weight ?? 1) / totalWeight) * Math.PI : 0;
  const startAngle = count === 1 ? -Math.PI : count === 2 ? 0 : -Math.PI / 2 - firstHalfAngle;

  // Pre-compute cumulative weight offsets for angle lookup
  const cumulativeWeight: number[] = [0];
  for (let i = 0; i < count; i++) {
    cumulativeWeight.push(cumulativeWeight[i]! + (pageItems[i]!.weight ?? 1));
  }
  return { startAngle, totalWeight, cumulativeWeight };
}

export function RadialMenu({
  open,
  onClose,
  onSelect,
  items,
  position,
  title: _title,
  maxItemsPerPage = 8,
  firstPageMaxItems,
  startAlign = "center",
  renderExpression,
  onSubmitExpression,
  searchPlaceholder,
}: RadialMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  // Reset state on open
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setSearchQuery("");
      setHoveredId(null);
      setCurrentPage(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Expression mode: check if current search text is a compound expression
  const expressionPreview = useMemo(() => renderExpression?.(searchQuery) ?? null, [renderExpression, searchQuery]);
  const isExpressionMode = expressionPreview !== null;

  // Filter items by search query
  const filteredItems = useMemo(
    () => (isExpressionMode ? [] : filterRadialMenuItems(items, searchQuery)),
    [items, searchQuery, isExpressionMode],
  );

  const { pageItems, totalPages } = paginate(filteredItems, currentPage, maxItemsPerPage, firstPageMaxItems);

  // Reset page when search changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    setCurrentPage(0);
  }, [searchQuery]);

  const handleItemSelect = useCallback(
    (id: string): boolean => {
      const expressionSeed = items.find((item) => item.id === id)?.expressionSeed;
      if (expressionSeed !== undefined && renderExpression) {
        setSearchQuery(expressionSeed);
        requestAnimationFrame(() => inputRef.current?.select());
        return false;
      }
      onSelect(id);
      return true;
    },
    [items, renderExpression, onSelect],
  );

  useRadialMenuKeyboard({
    open,
    totalPages,
    isExpressionMode,
    onClose,
    onSelect: handleItemSelect,
    onSubmitExpression,
    pageItems,
    searchQuery,
    setCurrentPage,
  });

  const handleItemClick = useCallback(
    (id: string) => {
      if (handleItemSelect(id)) onClose();
    },
    [handleItemSelect, onClose],
  );

  if (!open || items.length === 0) return null;

  // Use full item count for stable radius — don't resize during filtering
  const radius = defaultRadius(items.length);
  const innerRadius = radius * 0.32;
  const pos = clampPosition(position.x, position.y, radius);
  const svgSize = (radius + 8) * 2;
  const cx = svgSize / 2;
  const cy = svgSize / 2;

  const count = pageItems.length;
  const { startAngle, totalWeight, cumulativeWeight } = computeWedgeAngles(pageItems, startAlign);
  // No gap — wedges share radial edges so the pie reads as one
  // continuous paper donut, not as discrete slices. Hover/active
  // states are conveyed through fill changes, not radial dividers.
  const gap = 0;

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} />

      {/* Pie container */}
      <div className={styles.container} style={radialMenuContainerStyle(pos.x, pos.y, svgSize)}>
        <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`} className={styles.pie}>
          <RadialPaperPatterns />
          {!isExpressionMode &&
            pageItems.map((item, i) => {
              const a1 = startAngle + (cumulativeWeight[i]! / totalWeight) * 2 * Math.PI + gap / 2;
              const a2 = startAngle + (cumulativeWeight[i + 1]! / totalWeight) * 2 * Math.PI - gap / 2;
              return (
                <RadialMenuWedge
                  key={item.id}
                  item={item}
                  cx={cx}
                  cy={cy}
                  radius={radius}
                  innerRadius={innerRadius}
                  a1={a1}
                  a2={a2}
                  isHovered={hoveredId === item.id}
                  onClick={handleItemClick}
                  onHover={setHoveredId}
                />
              );
            })}

          {/* Suppress the rim chrome in expression mode — only the centered
           *  preview pill should be visible while the user is typing an
           *  expression, otherwise the empty paper wheel reads as broken UI. */}
          {!isExpressionMode && (
            <RadialPaperRim
              cx={cx}
              cy={cy}
              radius={radius}
              innerRadius={innerRadius}
              startAngle={startAngle}
              totalWeight={totalWeight}
              cumulativeWeight={cumulativeWeight}
              count={count}
              litEdgeClassName={styles.litEdge!}
              dividerClassName={styles.divider!}
            />
          )}

          {/* Expression mode: pill preview in center */}
          {isExpressionMode && (
            <foreignObject x={0} y={0} width={svgSize} height={svgSize}>
              <div className={styles.expressionPillWrapper} style={radialMenuSizeStyle(svgSize)}>
                <div className={styles.expressionPill}>{expressionPreview}</div>
              </div>
            </foreignObject>
          )}
        </svg>
      </div>

      <RadialMenuPageArrows
        posX={pos.x}
        posY={pos.y}
        radius={radius}
        totalPages={totalPages}
        currentPage={Math.min(currentPage, Math.max(0, totalPages - 1))}
        onPrev={() => setCurrentPage((p) => (p - 1 + totalPages) % totalPages)}
        onNext={() => setCurrentPage((p) => (p + 1) % totalPages)}
      />

      {/* Search input below */}
      <div className={styles.searchBar} style={radialMenuSearchBarStyle(pos.x, pos.y, radius)}>
        <input
          ref={inputRef}
          className={`${styles.searchInput} ${isExpressionMode ? styles.searchInputWide : ""}`}
          type="text"
          placeholder={searchPlaceholder ?? (renderExpression ? "Filter or build expression…" : "Filter…")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </>,
    document.body,
  );
}
