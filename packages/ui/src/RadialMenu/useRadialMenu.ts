/**
 * Hooks supporting `RadialMenu`: pagination math and keyboard handling.
 * Split out of RadialMenu.tsx to keep the main component function under
 * the lint max-lines-per-function threshold.
 */

import { useEffect } from "react";
import { isMac, type RadialMenuItem } from "./radialMenuHelpers";

export interface PaginationSlice {
  pageItems: RadialMenuItem[];
  totalPages: number;
  safePage: number;
}

/** Pure pagination math — first page can have a different size. */
export function paginate(
  filteredItems: RadialMenuItem[],
  currentPage: number,
  maxItemsPerPage: number,
  firstPageMaxItems: number | undefined,
): PaginationSlice {
  const fp = firstPageMaxItems ?? maxItemsPerPage;
  const totalPages = filteredItems.length <= fp ? 1 : 1 + Math.ceil((filteredItems.length - fp) / maxItemsPerPage);
  const safePage = Math.min(currentPage, totalPages - 1);
  const sliceStart = safePage === 0 ? 0 : fp + (safePage - 1) * maxItemsPerPage;
  const sliceEnd = safePage === 0 ? fp : sliceStart + maxItemsPerPage;
  return {
    pageItems: filteredItems.slice(sliceStart, sliceEnd),
    totalPages,
    safePage,
  };
}

export interface KeyboardDeps {
  open: boolean;
  totalPages: number;
  isExpressionMode: boolean;
  onClose: () => void;
  /** Return false to keep the menu open after handling the selection. */
  onSelect: (id: string) => boolean | void;
  onSubmitExpression: ((expression: string) => void) | undefined;
  pageItems: RadialMenuItem[];
  searchQuery: string;
  setCurrentPage: (updater: (p: number) => number) => void;
}

/**
 * Global keyboard handling for RadialMenu while it is open: Escape to
 * close, Ctrl/Alt to page (inverted on Mac), Enter/Tab to commit a
 * single selectable item or submit an expression.
 */
export function useRadialMenuKeyboard(deps: KeyboardDeps): void {
  const {
    open,
    totalPages,
    isExpressionMode,
    onClose,
    onSelect,
    onSubmitExpression,
    pageItems,
    searchQuery,
    setCurrentPage,
  } = deps;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Control" || e.key === "Alt") {
        if (totalPages <= 1) return;
        e.preventDefault();
        e.stopPropagation();
        const isPrev = isMac ? e.key === "Alt" : e.key === "Control";
        setCurrentPage((p) => (isPrev ? (p - 1 + totalPages) % totalPages : (p + 1) % totalPages));
        return;
      }

      if (e.key === "Enter" || e.key === "Tab") {
        if (isExpressionMode && onSubmitExpression) {
          e.preventDefault();
          e.stopPropagation();
          onSubmitExpression(searchQuery);
          onClose();
          return;
        }
        if (pageItems.length === 1) {
          e.preventDefault();
          e.stopPropagation();
          if (onSelect(pageItems[0]!.id) !== false) onClose();
        }
        return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    open,
    totalPages,
    isExpressionMode,
    onClose,
    onSelect,
    onSubmitExpression,
    pageItems,
    searchQuery,
    setCurrentPage,
  ]);
}
