/**
 * ScoreRenderer — manages a canvas and renders a score.
 *
 * @deprecated Use the WASM engine with {@link paintDisplayList} instead.
 * This class uses the legacy {@link paintPage} path which renders clefs
 * and other elements as Unicode placeholders rather than proper SMuFL glyphs.
 */

import type { Score } from "@viritura/core";
import type { LayoutSettings } from "@viritura/core";
import { DEFAULT_LAYOUT } from "@viritura/core";
import { computeLayout, type LayoutPage } from "./layout";
import { paintPage } from "./painter";

export class ScoreRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private score: Score | null = null;
  private layout: LayoutPage | null = null;
  private settings: LayoutSettings;
  private partIndex: number = 0;
  private dpr: number;

  constructor(canvas: HTMLCanvasElement, settings?: Partial<LayoutSettings>) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D rendering context");
    this.ctx = ctx;
    this.settings = { ...DEFAULT_LAYOUT, ...settings };
    this.dpr = window.devicePixelRatio || 1;
  }

  /**
   * Set the score to render.
   */
  setScore(score: Score): void {
    this.score = score;
    this.reflow();
  }

  /**
   * Set which part to display (0-indexed).
   */
  setPartIndex(index: number): void {
    this.partIndex = index;
    this.reflow();
  }

  /**
   * Recompute layout and repaint.
   */
  reflow(): void {
    if (!this.score) return;

    this.layout = computeLayout(this.score, this.partIndex, this.settings);

    // Resize canvas to fit content
    this.canvas.width = this.layout.width * this.dpr;
    this.canvas.height = this.layout.height * this.dpr;
    this.canvas.style.width = `${this.layout.width}px`;
    this.canvas.style.height = `${this.layout.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.paint();
  }

  /**
   * Repaint without recomputing layout.
   */
  paint(): void {
    if (!this.layout) return;
    paintPage(this.ctx, this.layout, this.settings.spatiumPx);
  }

  /**
   * Get the current layout (for hit-testing, etc.).
   */
  getLayout(): LayoutPage | null {
    return this.layout;
  }

  /**
   * Update layout settings and reflow.
   */
  setSettings(settings: Partial<LayoutSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.reflow();
  }
}
