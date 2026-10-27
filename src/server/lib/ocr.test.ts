import { describe, expect, it } from "vitest";
import { buildOcrPrompt, OCR_KNOWN_PAYEES_MAX, OCR_PROMPT } from "../../shared/ocr";
import { parseDateText, parseFields } from "./ocr";

describe("buildOcrPrompt", () => {
  it("過去の支払先を重複なく上限まで添える", () => {
    const many = Array.from({ length: 50 }, (_, i) => `支払先${i}`);
    const prompt = buildOcrPrompt(["ロハル", " ロハル ", 1, ...many]);
    expect(prompt).toContain('"ロハル"');
    expect(prompt.match(/"ロハル"/g)).toHaveLength(1);
    expect(prompt).toContain(`"支払先${OCR_KNOWN_PAYEES_MAX - 2}"`);
    expect(prompt).not.toContain(`"支払先${OCR_KNOWN_PAYEES_MAX - 1}"`);
  });

  it("過去の支払先が無ければ基本の指示のまま", () => {
    expect(buildOcrPrompt(undefined)).toBe(OCR_PROMPT);
    expect(buildOcrPrompt([])).toBe(OCR_PROMPT);
  });
});

describe("parseDateText", () => {
  it("和暦を西暦にする", () => {
    expect(parseDateText("令和8年2月3日")).toBe("2026-02-03");
    expect(parseDateText("R8.2.3")).toBe("2026-02-03");
    expect(parseDateText("令和 ８年 ２月 ３日")).toBe("2026-02-03");
    expect(parseDateText("令和元年5月1日")).toBe("2019-05-01");
    expect(parseDateText("平成31年4月30日")).toBe("2019-04-30");
  });

  it("西暦はそのまま", () => {
    expect(parseDateText("2026/02/03")).toBe("2026-02-03");
    expect(parseDateText("2026年2月3日")).toBe("2026-02-03");
  });

  it("読めなければ null", () => {
    expect(parseDateText("2月3日")).toBeNull();
    expect(parseDateText(null)).toBeNull();
    expect(parseDateText("令和8年13月1日")).toBeNull();
  });
});

describe("parseFields", () => {
  it("JSON だけの応答を読み取る", () => {
    expect(
      parseFields('{"date":"2026-01-15","payee":"〇〇クリニック","amount":3450,"category":"診療・治療","confidence":"high"}'),
    ).toEqual({
      date: "2026-01-15",
      payee: "〇〇クリニック",
      payeeCandidates: ["〇〇クリニック"],
      amount: 3450,
      category: "診療・治療",
      confidence: "high",
      uncertain: [],
      patient: null,
    });
  });

  it("患者名は「様」を除いて取り出す", () => {
    expect(parseFields('{"patient":"小段 あゆみ 様"}')?.patient).toBe("小段 あゆみ");
  });

  it("支払先の候補を重複なく最大3つにし、自信のない項目を取り出す", () => {
    const text = JSON.stringify({
      payee: "日本調剤 新浦安薬局",
      payee_candidates: ["日本調剤 新浦安薬局", "順天堂大学医学部附属浦安病院", "A", "B", 1],
      uncertain: ["payee", "unknown"],
    });
    expect(parseFields(text)).toMatchObject({
      payee: "日本調剤 新浦安薬局",
      payeeCandidates: ["日本調剤 新浦安薬局", "順天堂大学医学部附属浦安病院", "A"],
      uncertain: ["payee"],
    });
  });

  it("和暦の date_text はプログラムで西暦に換算する（AI の date より優先）", () => {
    const now = new Date(2026, 9, 25);
    expect(parseFields('{"date_text":"令和8年2月3日","date":"2022-02-03"}', now)).toMatchObject({
      date: "2026-02-03",
      uncertain: [],
    });
  });

  it("あり得ない年の日付は自信のない項目にする", () => {
    const now = new Date(2026, 9, 25);
    expect(parseFields('{"date":"2019-02-03"}', now)?.uncertain).toEqual(["date"]);
    expect(parseFields('{"date":"2027-02-03"}', now)?.uncertain).toEqual(["date"]);
  });

  it("payee が無ければ候補の先頭を使う", () => {
    expect(parseFields('{"payee":null,"payee_candidates":["△△薬局"]}')).toMatchObject({
      payee: "△△薬局",
      payeeCandidates: ["△△薬局"],
    });
  });

  it("前後の説明文やコードブロックを無視する", () => {
    const text = '読み取り結果です。\n```json\n{"date":"2026/2/3","payee":"△△薬局","amount":"¥2,980","category":"医薬品購入"}\n```';
    expect(parseFields(text)).toMatchObject({ date: "2026-02-03", payee: "△△薬局", amount: 2980 });
  });

  it("読み取れない項目は null にする", () => {
    expect(parseFields('{"date":null,"payee":"","amount":"不明"}')).toMatchObject({
      date: null,
      payee: null,
      amount: null,
    });
  });

  it("JSON が無ければ null", () => {
    expect(parseFields("読み取れませんでした")).toBeNull();
    expect(parseFields("{壊れた")).toBeNull();
  });
});
