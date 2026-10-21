import { describe, expect, it } from "vitest";
import { parseFields } from "./ocr";

describe("parseFields", () => {
  it("JSON だけの応答を読み取る", () => {
    expect(
      parseFields('{"date":"2026-01-15","payee":"〇〇クリニック","amount":3450,"category":"診療・治療","confidence":"high"}'),
    ).toEqual({ date: "2026-01-15", payee: "〇〇クリニック", amount: 3450, category: "診療・治療", confidence: "high" });
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
