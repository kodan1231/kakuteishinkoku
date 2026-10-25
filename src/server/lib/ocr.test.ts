import { describe, expect, it } from "vitest";
import { parseFields } from "./ocr";

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
    });
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
