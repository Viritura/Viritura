import { describe, expect, it, vi } from "vitest";
import { decodeXmlText, renderSvgToPdf } from "../pdfPainter";
import { PDFDocument, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";

describe("decodeXmlText", () => {
  it("does not decode an entity exposed by decoding an ampersand", () => {
    expect(decodeXmlText("&amp;lt;")).toBe("&lt;");
  });

  describe("PDF ink knockout", () => {
    it("clips nested ink groups without drawing clip definitions or a white fill", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([100, 100]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const push = vi.spyOn(page, "pushOperators");
      const rect = vi.spyOn(page, "drawRectangle");
      const svg = `<svg>
        <rect width="100%" height="100%" fill="white"/>
        <defs><clipPath id="erase-p0-0"><path clip-rule="evenodd" d="M0 0 L30 0 L30 30 L0 30 Z M10 10 L20 10 L20 20 L10 20 Z"/></clipPath></defs>
        <g clip-path="url(#erase-p0-0)"><rect x="1" y="1" width="20" height="20" fill="#000000"/></g>
        <rect x="12" y="12" width="1" height="1" fill="#ff0000"/>
      </svg>`;
      renderSvgToPdf(page, svg, 100, {
        serifFont: font,
        serifBoldFont: font,
        serifItalicFont: font,
        serifBoldItalicFont: font,
      });
      expect(rect).toHaveBeenCalledTimes(2);
      const operations = push.mock.calls
        .flat()
        .map((op) => op.toString())
        .join("\n");
      expect(operations).toContain("W*");
      expect(operations).toContain("q");
      expect(operations).toContain("Q");
      expect((await doc.save()).length).toBeGreaterThan(0);
    });

    it("fails explicitly if an ink clip cannot be resolved", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([100, 100]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      expect(() =>
        renderSvgToPdf(page, '<svg><g clip-path="url(#missing)"></g></svg>', 100, {
          serifFont: font,
          serifBoldFont: font,
          serifItalicFont: font,
          serifBoldItalicFont: font,
        }),
      ).toThrow(/missing SVG clip/);
    });
  });

  it("decodes supported XML entities", () => {
    expect(decodeXmlText("&amp; &lt; &gt; &quot; &apos;")).toBe("& < > \" '");
  });

  it("preserves distinct SVG outline geometry in PDF paths", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const draw = vi.spyOn(page, "drawSvgPath");
    renderSvgToPdf(page, '<svg><path d="M1 2L3 4Z" fill="#123456"/><path d="M1 2L5 6Z" fill="#123456"/></svg>', 200, {
      serifFont: font,
      serifBoldFont: font,
      serifItalicFont: font,
      serifBoldItalicFont: font,
    });
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.calls[0]![0]).not.toBe(draw.mock.calls[1]![0]);
  });

  it("uses explicit sans and monospace PDF fallback faces and selected-face alignment", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const serif = await doc.embedFont(StandardFonts.TimesRoman);
    const sans = await Promise.all(
      [
        StandardFonts.Helvetica,
        StandardFonts.HelveticaBold,
        StandardFonts.HelveticaOblique,
        StandardFonts.HelveticaBoldOblique,
      ].map((font) => doc.embedFont(font)),
    );
    const mono = await Promise.all(
      [
        StandardFonts.Courier,
        StandardFonts.CourierBold,
        StandardFonts.CourierOblique,
        StandardFonts.CourierBoldOblique,
      ].map((font) => doc.embedFont(font)),
    );
    const draw = vi.spyOn(page, "drawText");
    const fonts = {
      serifFont: serif,
      serifBoldFont: serif,
      serifItalicFont: serif,
      serifBoldItalicFont: serif,
      sans,
      mono,
    };
    renderSvgToPdf(
      page,
      `<svg>
      <text x="40" y="20" font-size="5" font-family="Arial, sans-serif" font-style="italic" font-weight="bold" text-anchor="end" dominant-baseline="alphabetic">Test</text>
      <text x="40" y="30" font-size="5" font-family="monospace" font-style="normal" font-weight="normal">Test</text>
    </svg>`,
      200,
      fonts,
    );
    expect(draw.mock.calls[0]![1]!.font).toBe(sans[3]);
    expect(draw.mock.calls[1]![1]!.font).toBe(mono[0]);
    const size = (5 * 72) / 25.4;
    expect(draw.mock.calls[0]![1]!.x).toBeCloseTo((40 * 72) / 25.4 - sans[3]!.widthOfTextAtSize("Test", size));
    expect(() =>
      renderSvgToPdf(page, '<svg><text font-family="Arial, sans-serif">漢</text></svg>', 200, fonts),
    ).toThrow(/no font supports U\+6F22/);
    expect(() => renderSvgToPdf(page, '<svg><text font-family="Unknown">Test</text></svg>', 200, fonts)).toThrow(
      /unsupported text font family/,
    );
  });

  it("falls back per glyph to bundled serif and aligns using the mixed run widths", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const serif = await doc.embedFont(
      readFileSync(new URL("../../../../assets/fonts/LibertinusSerif-Regular.otf", import.meta.url)),
    );
    const bold = await doc.embedFont(
      readFileSync(new URL("../../../../assets/fonts/LibertinusSerif-Bold.otf", import.meta.url)),
    );
    const helvetica = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([200, 200]);
    const draw = vi.spyOn(page, "drawText");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fonts = {
        serifFont: serif,
        serifBoldFont: bold,
        serifItalicFont: serif,
        serifBoldItalicFont: serif,
        sans: [helvetica, helvetica, helvetica, helvetica],
      };
      renderSvgToPdf(
        page,
        '<svg><text x="40" y="20" font-size="5" font-family="Arial, sans-serif" font-weight="bold" text-anchor="end">B♭Привет</text></svg>',
        200,
        fonts,
      );
      expect(draw.mock.calls.map(([text]) => text)).toEqual(["B", "♭", "Привет"]);
      expect(draw.mock.calls[0]![1]!.font).toBe(helvetica);
      expect(draw.mock.calls[1]![1]!.font).toBe(serif);
      expect(draw.mock.calls[2]![1]!.font).toBe(bold);
      const size = (5 * 72) / 25.4;
      const width =
        helvetica.widthOfTextAtSize("B", size) +
        serif.widthOfTextAtSize("♭", size) +
        bold.widthOfTextAtSize("Привет", size);
      expect(draw.mock.calls[0]![1]!.x).toBeCloseTo((40 * 72) / 25.4 - width);
      expect(draw.mock.calls[2]![1]!.x).toBeCloseTo((40 * 72) / 25.4 - bold.widthOfTextAtSize("Привет", size));
      expect(warning).toHaveBeenCalledOnce();
      draw.mockClear();
      renderSvgToPdf(
        page,
        '<svg><text x="40" y="20" font-size="5" font-family="Arial, sans-serif">A\nB</text></svg>',
        200,
        fonts,
      );
      expect(draw.mock.calls.map(([text]) => text)).toEqual(["A B"]);
      expect((await doc.save()).length).toBeGreaterThan(0);
    } finally {
      warning.mockRestore();
    }
  });
});
