import { describe, expect, it } from "vitest";
import { decodeXmlText } from "../pdfPainter";

describe("decodeXmlText", () => {
  it("does not decode an entity exposed by decoding an ampersand", () => {
    expect(decodeXmlText("&amp;lt;")).toBe("&lt;");
  });

  it("decodes supported XML entities", () => {
    expect(decodeXmlText("&amp; &lt; &gt; &quot; &apos;")).toBe("& < > \" '");
  });
});
