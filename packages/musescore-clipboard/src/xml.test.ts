import { describe, expect, it } from "vitest";
import {
  MUSESCORE_STAFF_LIST_MIME,
  MUSESCORE_SYMBOL_MIME,
  MUSESCORE_SYMBOL_LIST_MIME,
  MuseScoreConversionError,
  looksLikeMuseScoreXml,
  readMuseScoreClipboard,
  writeMuseScoreStaffList,
  type MuseScoreErrorCode,
} from ".";

const SYMBOL = "<EngravingItem><Note><pitch>60</pitch><tpc>14</tpc></Note></EngravingItem>";

function expectCode(xml: string, code: MuseScoreErrorCode): void {
  expect(() => readMuseScoreClipboard(xml)).toThrow(MuseScoreConversionError);
  expect(() => readMuseScoreClipboard(xml)).toThrow(expect.objectContaining({ code }));
}

describe("isomorphic public XML boundary", () => {
  it("reads and writes in Node.js without a global DOMParser", () => {
    expect(globalThis).not.toHaveProperty("DOMParser");
    const read = readMuseScoreClipboard(SYMBOL, MUSESCORE_SYMBOL_MIME);
    const written = writeMuseScoreStaffList({ events: read.content });
    expect(written.warning).toBeUndefined();
    expect(looksLikeMuseScoreXml(written.xml!)).toBe(true);
    expect(readMuseScoreClipboard(written.xml!, MUSESCORE_STAFF_LIST_MIME).content).toMatchObject(
      read.content.map(({ type, ...event }) => ({
        ...event,
        id: expect.any(String),
        type,
        notes: [{ pitch: { step: "C", octave: 4 } }],
      })),
    );
  });

  it.each([
    SYMBOL,
    '<StaffList version="4.70"/>',
    '<?xml version="1.0"?>\n<SymbolList version="4.70"/>',
    "<!DOCTYPE StaffList><StaffList/>",
  ])("recognizes clipboard XML without parsing it", (xml) => {
    expect(looksLikeMuseScoreXml(xml)).toBe(true);
  });

  it.each(['{"type":"viritura/fragment"}', "<score-partwise/>", "<StaffListOther/>"])(
    "does not claim other formats",
    (xml) => expect(looksLikeMuseScoreXml(xml)).toBe(false),
  );

  it("checks MIME/root agreement and diagnoses unsupported SymbolList", () => {
    expect(() => readMuseScoreClipboard(SYMBOL, MUSESCORE_STAFF_LIST_MIME)).toThrow(
      expect.objectContaining({ code: "invalid-structure" }),
    );
    expect(() => readMuseScoreClipboard('<SymbolList version="4.70"/>', MUSESCORE_SYMBOL_LIST_MIME)).toThrow(
      expect.objectContaining({ code: "unsupported-content" }),
    );
  });

  it.each([
    "",
    "<StaffList",
    "<a><b></a>",
    "<a/><b/>",
    "<a>&undefined;</a>",
    "<a attr='one' attr='two'/>",
    "<a attribute=unquoted/>",
  ])("does not recover malformed XML silently: %s", (xml) => {
    expectCode(xml, "malformed-xml");
  });

  it.each([
    ...[0, 8, 11, 12, 14, 31, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xfffe, 0xffff, 0x110000, 0x100000000].flatMap(
      (value) => [`&#${value};`, `&#x${value.toString(16)};`],
    ),
    "&#00011;",
    "&#x000B;",
    "&#xD800;&#xDC00;",
    "&#55296;&#56320;",
    `&#${"9".repeat(400)};`,
    `&#x${"F".repeat(400)};`,
  ])("rejects illegal XML 1.0 character reference %s in pitch and attributes", (reference) => {
    expectCode(SYMBOL.replace("<pitch>60", `<pitch>${reference}60`), "malformed-xml");
    expectCode(SYMBOL.replace("<EngravingItem>", `<EngravingItem version="${reference}">`), "malformed-xml");
    expectCode(SYMBOL.replace("<EngravingItem>", `<EngravingItem version='${reference}'>`), "malformed-xml");
  });

  it.each(["&#;", "&#x;", "&#-1;", "&#x-1;", "&#X42;", "&#12x;", "&#xGG;", "&#11", "&#xB", "&# 11;"])(
    "rejects malformed numeric reference %s in pitch and attributes",
    (reference) => {
      expectCode(SYMBOL.replace("<pitch>60", `<pitch>${reference}60`), "malformed-xml");
      expectCode(SYMBOL.replace("<EngravingItem>", `<EngravingItem version="${reference}">`), "malformed-xml");
    },
  );

  it.each([
    ...Array.from({ length: 32 }, (_, value) => value).filter((value) => ![9, 10, 13].includes(value)),
    0xd800,
    0xdbff,
    0xdc00,
    0xdfff,
    0xfffe,
    0xffff,
  ])("rejects raw illegal XML character U+%s, even in literal regions", (value) => {
    const character = String.fromCodePoint(value);
    expectCode(SYMBOL.replace("<pitch>60", `<pitch>${character}60`), "malformed-xml");
    expectCode(SYMBOL.replace("<EngravingItem>", `<EngravingItem version="${character}">`), "malformed-xml");
    for (const literal of [`<![CDATA[${character}]]>`, `<!--${character}-->`, `<?literal ${character}?>`]) {
      expectCode(SYMBOL.replace("<Note>", `${literal}<Note>`), "malformed-xml");
    }
    expectCode(`${character}${SYMBOL}`, "malformed-xml");
    expectCode(`${SYMBOL}${character}`, "malformed-xml");
  });

  it.each([
    "\t60\n\r",
    "&#9;60&#10;&#13;",
    "&#x9;60&#xA;&#xD;",
    "&#54;&#x30;",
    "&#00054;&#x00030;",
    "<![CDATA[60]]>",
    "<!--&#11;-->60<?literal &#xB;?>",
  ])("still decodes legal pitch text %s", (pitch) => {
    expect(
      readMuseScoreClipboard(SYMBOL.replace("<pitch>60</pitch>", `<pitch>${pitch}</pitch>`)).content,
    ).toMatchObject([{ notes: [{ pitch: { step: "C", octave: 4 } }] }]);
  });

  it.each([9, 10, 13, 0x20, 0x7f, 0x85, 0xd7ff, 0xe000, 0xfffc, 0x10000, 0x1fffe, 0x10ffff])(
    "accepts legal XML 1.0 character U+%s as literal text and decimal/hex references",
    (value) => {
      for (const text of [String.fromCodePoint(value), `&#${value};`, `&#x${value.toString(16)};`]) {
        const xml = SYMBOL.replace("<EngravingItem>", `<EngravingItem version="${text}">${text}`);
        expect(readMuseScoreClipboard(xml).content).toMatchObject([{ notes: [{ pitch: { step: "C", octave: 4 } }] }]);
      }
    },
  );

  it.each(["&amp;&lt;&gt;&quot;&apos;", "&#65533;&#xFFFD;", "&amp;#11; &amp;#xD800;", "&#38;#11; &#x26;#x110000;"])(
    "accepts legal escapes without decoding them twice: %s",
    (text) => {
      const xml = SYMBOL.replace("<EngravingItem>", `<EngravingItem version="${text}">${text}`);
      expect(readMuseScoreClipboard(xml).content).toMatchObject([{ notes: [{ pitch: { step: "C", octave: 4 } }] }]);
    },
  );

  it.each([
    "<![CDATA[&#11; &#xB; &#xD800; &#x110000; &#; &#x; &undefined; <!-- <?]]>",
    "<!--&#11; &#xB; &#xD800; &#x110000; &#; &#x; &undefined; <![CDATA[ <?-->",
    "<?literal &#11; &#xB; &#xD800; &#x110000; &#; &#x; &undefined; <![CDATA[ <!--?>",
    "<![CDATA[&]]>#11;",
  ])("does not interpret entity-like text in literal regions: %s", (literal) => {
    const xml = SYMBOL.replace("<Note>", `${literal}<Note>`);
    expect(readMuseScoreClipboard(xml).content).toMatchObject([{ notes: [{ pitch: { step: "C", octave: 4 } }] }]);
    expectCode(xml.replace("<pitch>60", "<pitch>&#11;60"), "malformed-xml");
    expectCode(xml.replace("<pitch>", '<pitch label="&#xB;">'), "malformed-xml");
  });

  it.each(["<![CDATA[&#11;]]>60", "&amp;#11;60", "&#38;#11;60"])(
    "leaves literal entity-like pitch text to semantic validation: %s",
    (pitch) => {
      expectCode(SYMBOL.replace("<pitch>60</pitch>", `<pitch>${pitch}</pitch>`), "invalid-structure");
    },
  );

  it.each([
    ["<!--", "-->"],
    ["<![CDATA[", "]]>"],
    ["<?literal ", "?>"],
  ])("does not let %s hide references in attributes or excuse unterminated XML", (start, end) => {
    expectCode(SYMBOL.replace("<Note>", `${start}&#11;<Note>`), "malformed-xml");
    for (const opener of [start, start.replace("<", "&lt;")]) {
      const xml = SYMBOL.replace("<EngravingItem>", `<EngravingItem version="${opener}&#11;${end}">`);
      expectCode(xml, "malformed-xml");
    }
  });

  it.each([
    "<!DOCTYPE a><a/>",
    '<!DOCTYPE a SYSTEM "file:///not-read"><a/>',
    '<!ENTITY external SYSTEM "https://example.invalid/not-read"><a/>',
  ])("rejects DTD/entity input before parsing", (xml) => {
    expectCode(xml, "unsafe-xml");
  });

  it("enforces the UTF-8 byte budget", () => {
    expectCode(`<a>${"é".repeat(4 * 1024 * 1024)}</a>`, "unsafe-xml");
  });

  it("enforces nesting and element-count budgets", () => {
    expectCode("<a>".repeat(65) + "</a>".repeat(65), "unsafe-xml");
    expectCode(`<a>${"<b/>".repeat(100_000)}</a>`, "unsafe-xml");
  });
});
