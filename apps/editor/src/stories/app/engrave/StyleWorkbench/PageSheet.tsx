import { resolveLayout, type MockLayout, type Project } from "./styleModel";
import { pageGeometry, TITLE_BLOCK_MM } from "./pageGeometry";

const INK = "#222";
const PT_TO_MM = 0.3528;

function fontFamily(value: string): string {
  if (value === "Arial / sans-serif") return "Arial, sans-serif";
  if (value === "Monospace") return "monospace";
  return "'Libertinus Serif', Georgia, serif";
}

interface StaffProps {
  x: number;
  y: number;
  width: number;
  space: number;
  bars: number;
  seed: number;
}

function Staff({ x, y, width, space, bars, seed }: StaffProps) {
  const barWidth = width / bars;
  return (
    <g>
      {[0, 1, 2, 3, 4].map((line) => (
        <line
          key={line}
          x1={x}
          x2={x + width}
          y1={y + line * space}
          y2={y + line * space}
          stroke={INK}
          strokeWidth={space * 0.1}
        />
      ))}
      {Array.from({ length: bars + 1 }, (_, bar) => (
        <line
          key={bar}
          x1={x + bar * barWidth}
          x2={x + bar * barWidth}
          y1={y}
          y2={y + 4 * space}
          stroke={INK}
          strokeWidth={space * 0.13}
        />
      ))}
      {Array.from({ length: bars }, (_, bar) =>
        [0, 1, 2].map((note) => {
          const cx = x + bar * barWidth + barWidth * (0.25 + note * 0.25);
          const cy = y + space * (0.5 + ((bar + note + seed) % 5) * 0.5);
          return (
            <g key={`${bar}-${note}`}>
              <ellipse
                cx={cx}
                cy={cy}
                rx={space * 0.6}
                ry={space * 0.42}
                transform={`rotate(-20 ${cx} ${cy})`}
                fill={INK}
              />
              <line
                x1={cx + space * 0.55}
                x2={cx + space * 0.55}
                y1={cy}
                y2={cy - space * 3.3}
                stroke={INK}
                strokeWidth={space * 0.12}
              />
            </g>
          );
        }),
      )}
    </g>
  );
}

interface PageSheetProps {
  project: Project;
  layout: MockLayout;
  showMargins?: boolean;
  label?: string;
}

/** First page of a layout drawn in millimetre units, so page size, margins and staff size are to scale. */
export function PageSheet({ project, layout, showMargins = false, label }: PageSheetProps) {
  const geometry = pageGeometry(project, layout);
  const { width, height, margin, staffHeight, staffGap, systemHeight, systemGap, barsPerSystem } = geometry;
  const space = staffHeight / 4;
  const frequency = resolveLayout(project, layout, "frequency");
  const above = resolveLayout(project, layout, "placement") === "Above system";
  const enclosure = resolveLayout(project, layout, "enclosure");
  const numberSize = Number.parseFloat(resolveLayout(project, layout, "size")) * PT_TO_MM;
  const family = fontFamily(resolveLayout(project, layout, "family"));
  const left = margin.inner;
  const contentWidth = width - margin.inner - margin.outer;
  const firstSystemY = margin.top + TITLE_BLOCK_MM;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `${layout.name} first page`}>
      <rect width={width} height={height} fill="#fffdfa" />
      {showMargins && (
        <rect
          x={margin.inner}
          y={margin.top}
          width={contentWidth}
          height={height - margin.top - margin.bottom}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={0.4}
          strokeDasharray="2 1.5"
        />
      )}
      <text x={width / 2} y={margin.top + 9} textAnchor="middle" fontSize={8} fontFamily={family} fill={INK}>
        Evening Sketches
      </text>
      <text x={width / 2} y={margin.top + 16} textAnchor="middle" fontSize={3.6} fontFamily={family} fill={INK}>
        {layout.name}
      </text>
      {Array.from({ length: geometry.systemsOnFirstPage }, (_, system) => {
        const y = firstSystemY + system * (systemHeight + systemGap);
        const firstBar = 1 + system * barsPerSystem;
        const numberY = above ? y - space * 2.2 : y + systemHeight + space * 3.4;
        const numbered =
          frequency === "Hidden" ? [] : frequency === "Every bar" ? [...Array(barsPerSystem).keys()] : [0];
        return (
          <g key={system}>
            {layout.staves > 1 && (
              <line
                x1={left - space}
                x2={left - space}
                y1={y}
                y2={y + systemHeight}
                stroke={INK}
                strokeWidth={space * 0.5}
              />
            )}
            {Array.from({ length: layout.staves }, (_, staff) => (
              <Staff
                key={staff}
                x={left}
                y={y + staff * (staffHeight + staffGap)}
                width={contentWidth}
                space={space}
                bars={barsPerSystem}
                seed={system + staff}
              />
            ))}
            {numbered.map((bar) => {
              const x = left + (bar * contentWidth) / barsPerSystem + (bar === 0 ? 0 : space);
              return (
                <g key={bar}>
                  {enclosure === "Box" && (
                    <rect
                      x={x - numberSize * 0.3}
                      y={numberY - numberSize * 0.95}
                      width={numberSize * (String(firstBar + bar).length * 0.6 + 0.6)}
                      height={numberSize * 1.25}
                      fill="none"
                      stroke={INK}
                      strokeWidth={0.25}
                    />
                  )}
                  {enclosure === "Circle" && (
                    <circle
                      cx={x + numberSize * String(firstBar + bar).length * 0.3}
                      cy={numberY - numberSize * 0.35}
                      r={numberSize * 0.8}
                      fill="none"
                      stroke={INK}
                      strokeWidth={0.25}
                    />
                  )}
                  <text x={x} y={numberY} fontSize={numberSize} fontFamily={family} fill={INK}>
                    {firstBar + bar}
                  </text>
                </g>
              );
            })}
            {layout.bracket && frequency !== "Hidden" && layout.staves > 2 && (
              <text
                x={left}
                y={y + 2 * (staffHeight + staffGap) - space * 2}
                fontSize={numberSize}
                fontFamily={family}
                fill={INK}
              >
                {firstBar}
              </text>
            )}
          </g>
        );
      })}
      <text
        x={width / 2}
        y={height - margin.bottom / 2}
        textAnchor="middle"
        fontSize={3.2}
        fontFamily={family}
        fill={INK}
      >
        1
      </text>
    </svg>
  );
}
