import type { CSSProperties } from "react";
import { Badge } from "@viritura/ui";
import { resolveField, type MockLayout, type Project } from "./styleModel";
import styles from "./StyleWorkbench.module.css";

export function ScorePreview({ project, layout }: { project: Project; layout: MockLayout }) {
  const value = (field: Parameters<typeof resolveField>[3]) => resolveField(project, "layout", layout, field).value;
  const everyBar = value("frequency") === "Every bar";
  const hidden = value("frequency") === "Hidden";
  const above = value("placement") === "Above system";
  const enclosure = value("enclosure");
  const fontSize = Number.parseInt(value("size"), 10);
  const staffSize = Number.parseInt(value("staff"), 10);
  const paper = value("paper");
  const titleFamily = value("family");
  const paperStyle: CSSProperties = {
    aspectRatio: paper === "Letter" ? "8.5 / 11" : paper === "A4" ? "210 / 297" : "9 / 12",
    paddingInline: `${Number.parseInt(value("margin"), 10) * 0.6}%`,
  };
  const titleStyle: CSSProperties = {
    fontFamily:
      titleFamily === "Arial / sans-serif" ? "sans-serif" : titleFamily === "Monospace" ? "monospace" : "serif",
  };
  return (
    <section className={styles.preview} aria-label="Illustrative score preview">
      <div className={styles.previewHeading}>
        <div>
          <strong>{layout.name}</strong>
          <p>
            {paper} / {value("staff")} staff
          </p>
        </div>
        <Badge variant="muted">Illustrative preview</Badge>
      </div>
      <div className={styles.paperWell}>
        <div className={styles.paper} style={paperStyle}>
          <h2 style={titleStyle}>Evening Sketches</h2>
          <p className={styles.paperSubtitle}>{layout.name} / Andante</p>
          <svg viewBox="0 0 400 430" role="img" aria-label="Mock notation showing bar-number appearance">
            {[0, 1, 2].map((system) => {
              const y = 38 + system * 132;
              const step = staffSize + 1;
              return (
                <g key={system}>
                  {[0, 1].map((staff) => (
                    <g key={staff}>
                      {[0, 1, 2, 3, 4].map((line) => (
                        <line
                          key={line}
                          x1="8"
                          x2="392"
                          y1={y + staff * 50 + line * step}
                          y2={y + staff * 50 + line * step}
                          stroke="#333"
                          strokeWidth="0.7"
                        />
                      ))}
                      {[0, 1, 2, 3].map((bar) => (
                        <g key={bar}>
                          <line
                            x1={8 + bar * 96}
                            x2={8 + bar * 96}
                            y1={y + staff * 50}
                            y2={y + staff * 50 + 4 * step}
                            stroke="#333"
                          />
                          {[0, 1, 2].map((note) => (
                            <g key={note}>
                              <ellipse
                                cx={32 + bar * 96 + note * 22}
                                cy={y + staff * 50 + step * (1 + ((bar + note) % 3))}
                                rx="4.5"
                                ry="3.2"
                                transform={`rotate(-15 ${32 + bar * 96 + note * 22} ${y + staff * 50 + step * (1 + ((bar + note) % 3))})`}
                                fill="#222"
                              />
                              <line
                                x1={36 + bar * 96 + note * 22}
                                x2={36 + bar * 96 + note * 22}
                                y1={y + staff * 50 + step * (1 + ((bar + note) % 3))}
                                y2={y + staff * 50 - 8}
                                stroke="#222"
                              />
                            </g>
                          ))}
                        </g>
                      ))}
                    </g>
                  ))}
                  {!hidden &&
                    [0, 1, 2, 3]
                      .filter((bar) => everyBar || bar === 0)
                      .map((bar) => {
                        const x = 12 + bar * 96;
                        const numberY = above ? y - 13 : y + 50 + step * 4 + 17;
                        return (
                          <g key={bar}>
                            {enclosure === "Box" && (
                              <rect x={x - 9} y={numberY - 12} width="22" height="18" fill="none" stroke="#333" />
                            )}
                            {enclosure === "Circle" && (
                              <circle cx={x + 2} cy={numberY - 3} r="11" fill="none" stroke="#333" />
                            )}
                            <text x={x} y={numberY} fontSize={fontSize} fill="#222">
                              {1 + system * 4 + bar}
                            </text>
                          </g>
                        );
                      })}
                  {layout.bracket && !hidden && (
                    <text x="170" y={y - 13} fontSize={fontSize} fill="#222">
                      {1 + system * 4}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <span className={styles.pageNumber}>1</span>
        </div>
      </div>
      <p className={styles.previewNote}>
        Mock notation, not the engraving engine. Page size, staff size, margin, numbering and title font respond to
        edits. Turn policy does not reflow this sample.
      </p>
    </section>
  );
}
