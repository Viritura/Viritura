import { resolveLayout, type Field, type MockLayout, type Project } from "./styleModel";

const PAPER_MM: Record<string, [number, number]> = {
  "9 x 12 in": [229, 305],
  Letter: [216, 279],
  A4: [210, 297],
  B4: [250, 353],
  Tabloid: [279, 432],
  A3: [297, 420],
};

export const TITLE_BLOCK_MM = 28;

export interface PageGeometry {
  width: number;
  height: number;
  margin: { top: number; bottom: number; inner: number; outer: number };
  staffHeight: number;
  staves: number;
  staffGap: number;
  systemHeight: number;
  systemGap: number;
  systemsOnFirstPage: number;
  barsPerSystem: number;
  pages: number;
}

function millimetres(value: string): number {
  return Number.parseFloat(value);
}

/**
 * Rough casting estimate for the mock. Standard engraving practice spaces staves within a system by
 * about two staff heights and separates systems by about three, with bar width scaling with staff size.
 */
export function pageGeometry(project: Project, layout: MockLayout): PageGeometry {
  const value = (field: Field) => resolveLayout(project, layout, field);
  const [portraitWidth, portraitHeight] = PAPER_MM[value("paper")] ?? PAPER_MM.A4!;
  const landscape = value("orientation") === "Landscape";
  const width = landscape ? portraitHeight : portraitWidth;
  const height = landscape ? portraitWidth : portraitHeight;
  const margin = {
    top: millimetres(value("marginTop")),
    bottom: millimetres(value("marginBottom")),
    inner: millimetres(value("marginInner")),
    outer: millimetres(value("marginOuter")),
  };
  const staffHeight = millimetres(value("staff"));
  const turns = value("turns");
  const density = turns === "Dense pages" ? 0.8 : turns === "Comfortable turns" ? 1.15 : 1;
  const staffGap = staffHeight * 2.2;
  const systemHeight = layout.staves * staffHeight + (layout.staves - 1) * staffGap;
  const systemGap = staffHeight * 3 * density;
  const usable = height - margin.top - margin.bottom;
  const systemsPerPage = Math.max(1, Math.floor((usable + systemGap) / (systemHeight + systemGap)));
  const systemsOnFirstPage = Math.max(
    1,
    Math.floor((usable - TITLE_BLOCK_MM + systemGap) / (systemHeight + systemGap)),
  );
  const contentWidth = width - margin.inner - margin.outer;
  const barsPerSystem = Math.min(8, Math.max(2, Math.floor(contentWidth / (staffHeight * 6.5))));
  const systems = Math.ceil(layout.bars / barsPerSystem);
  const pages = 1 + Math.max(0, Math.ceil((systems - systemsOnFirstPage) / systemsPerPage));
  return {
    width,
    height,
    margin,
    staffHeight,
    staves: layout.staves,
    staffGap,
    systemHeight,
    systemGap,
    systemsOnFirstPage,
    barsPerSystem,
    pages,
  };
}

export function paperLabel(project: Project, layout: MockLayout): string {
  const orientation = resolveLayout(project, layout, "orientation") === "Landscape" ? " landscape" : "";
  return `${resolveLayout(project, layout, "paper")}${orientation} / ${resolveLayout(project, layout, "staff")}`;
}
