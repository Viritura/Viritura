import { describe, expect, it, vi } from "vitest";
import { decodeXmlText, renderSvgToPdf } from "../pdfPainter";
import { PDFDocument, StandardFonts } from "pdf-lib";

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
});
