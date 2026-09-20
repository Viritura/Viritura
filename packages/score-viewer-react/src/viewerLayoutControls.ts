import { useCallback, useState } from "react";
import type { ScoreViewerPageSizeOption, ScoreViewerStaffSizeOption } from "./ScoreViewerControls";

interface ViewerLayoutControlOptions {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly spatium: number;
  readonly pageSizeOptions?: readonly ScoreViewerPageSizeOption[];
  readonly defaultPageSizeId?: string;
  readonly controlledStaffSize?: number;
  readonly staffSizeOptions?: readonly ScoreViewerStaffSizeOption[];
  readonly defaultStaffSize?: number;
  readonly onPageSizeChange?: (pageSize: ScoreViewerPageSizeOption) => void;
  readonly onStaffSizeChange?: (spatium: number) => void;
}

export function useViewerLayoutControls(options: ViewerLayoutControlOptions) {
  const {
    pageWidth,
    pageHeight,
    spatium,
    pageSizeOptions,
    defaultPageSizeId,
    controlledStaffSize,
    defaultStaffSize,
    onPageSizeChange,
    onStaffSizeChange,
  } = options;
  const resolvedPageSizeOptions = pageSizeOptions ?? [];
  const [pageSizeId, setPageSizeId] = useState(defaultPageSizeId ?? resolvedPageSizeOptions[0]?.id);
  const [uncontrolledStaffSize, setUncontrolledStaffSize] = useState(defaultStaffSize ?? spatium);
  const staffSize = controlledStaffSize ?? uncontrolledStaffSize;
  const selectedPageSize = resolvedPageSizeOptions.find((option) => option.id === pageSizeId);

  const setPageSize = useCallback(
    (nextPageSizeId: string) => {
      const option = resolvedPageSizeOptions.find((candidate) => candidate.id === nextPageSizeId);
      if (!option) return;
      setPageSizeId(option.id);
      onPageSizeChange?.(option);
    },
    [onPageSizeChange, resolvedPageSizeOptions],
  );

  const setSpatium = useCallback(
    (nextSpatium: number) => {
      if (controlledStaffSize == null) setUncontrolledStaffSize(nextSpatium);
      onStaffSizeChange?.(nextSpatium);
    },
    [controlledStaffSize, onStaffSizeChange],
  );

  return {
    pageSizeId,
    staffSize,
    effectivePageWidth: selectedPageSize?.width ?? pageWidth,
    effectivePageHeight: selectedPageSize?.height ?? pageHeight,
    pageSizeOptions: resolvedPageSizeOptions,
    staffSizeOptions: options.staffSizeOptions ?? [],
    setPageSize,
    setSpatium,
  };
}
