import { describe, expect, it } from "vitest";
import { MEDICAL_HEADERS } from "./ledger";
import {
  lastCategoryFor,
  medicalRow,
  normalizeDate,
  parseAmount,
  parseMedical,
  payeeSuggestions,
  receiptFileName,
  validateRecord,
  type MedicalRecord,
  type RecordInput,
} from "./records";

const record = (over: Partial<MedicalRecord>): MedicalRecord => ({
  id: "abcdef12-3456",
  date: "2026-01-15",
  personId: "p1",
  personName: "国税　太郎",
  payee: "財務総合病院",
  category: "診療・治療",
  amount: 12340,
  reimbursed: 0,
  memo: "",
  receiptFileIds: [],
  source: "manual",
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
  ...over,
});

const input = (over: Partial<RecordInput> = {}): RecordInput => ({
  date: "2026-01-15",
  personId: "p1",
  payee: "財務総合病院",
  category: "診療・治療",
  amount: "12340",
  reimbursed: "",
  memo: "",
  ...over,
});

describe("parseMedical", () => {
  it("書き込んだ行を読み戻せる。削除済みは除き新しい順", () => {
    const a = record({ id: "a", date: "2026-01-15", receiptFileIds: ["f1", "f2"] });
    const b = record({ id: "b", date: "2026-03-01", source: "ocr" });
    const deleted = medicalRow(record({ id: "c" }));
    deleted[13] = true;
    const { records, problems } = parseMedical([MEDICAL_HEADERS, medicalRow(a), medicalRow(b), deleted]);
    expect(problems).toEqual([]);
    expect(records).toEqual([b, a]);
  });

  it("id の重複を検知する", () => {
    const row = medicalRow(record({ id: "a" }));
    expect(parseMedical([MEDICAL_HEADERS, row, row]).problems).toHaveLength(1);
  });
});

describe("normalizeDate", () => {
  it("シリアル値やスラッシュ区切りを YYYY-MM-DD にする", () => {
    expect(normalizeDate(46037)).toBe("2026-01-15");
    expect(normalizeDate("2026/1/5")).toBe("2026-01-05");
    expect(normalizeDate("2026-01-15")).toBe("2026-01-15");
  });
});

describe("parseAmount", () => {
  it("全角数字・カンマ・円を許す", () => {
    expect(parseAmount("１２,３４０円")).toBe(12340);
    expect(parseAmount("¥ 500")).toBe(500);
  });

  it("小数や文字は null", () => {
    expect(parseAmount("12.5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("validateRecord", () => {
  it("正しい入力はエラーなし", () => {
    expect(validateRecord(input(), 2026)).toEqual({});
  });

  it("対象年度以外の日付はエラー", () => {
    expect(validateRecord(input({ date: "2025-12-31" }), 2026).date).toBeDefined();
  });

  it("支払先は20文字まで", () => {
    expect(validateRecord(input({ payee: "あ".repeat(20) }), 2026).payee).toBeUndefined();
    expect(validateRecord(input({ payee: "あ".repeat(21) }), 2026).payee).toBeDefined();
  });

  it("支払額は1円以上、補填額は支払額以下", () => {
    expect(validateRecord(input({ amount: "0" }), 2026).amount).toBeDefined();
    expect(validateRecord(input({ reimbursed: "20000" }), 2026).reimbursed).toBeDefined();
    expect(validateRecord(input({ reimbursed: "12340" }), 2026).reimbursed).toBeUndefined();
  });
});

describe("支払先の候補", () => {
  const records = [
    record({ id: "1", date: "2026-01-10", payee: "霞が関薬局", category: "医薬品購入" }),
    record({ id: "2", date: "2026-02-10", payee: "財務総合病院", category: "診療・治療" }),
    record({ id: "3", date: "2026-03-10", payee: "霞が関薬局", category: "その他の医療費" }),
  ];

  it("新しい記録の支払先から順に重複なく返す", () => {
    expect(payeeSuggestions(records)).toEqual(["霞が関薬局", "財務総合病院"]);
  });

  it("同じ支払先の直近の区分を返す", () => {
    expect(lastCategoryFor(records, " 霞が関薬局 ")).toBe("その他の医療費");
    expect(lastCategoryFor(records, "未登録")).toBeNull();
  });
});

describe("receiptFileName", () => {
  it("日付_支払先_金額_id を付け、2枚目以降は連番", () => {
    const r = record({ payee: "JR / 東京駅" });
    expect(receiptFileName(r, 0, "image/jpeg")).toBe("20260115_JR_東京駅_12340_abcdef12.jpg");
    expect(receiptFileName(r, 1, "application/pdf")).toBe("20260115_JR_東京駅_12340_abcdef12-2.pdf");
  });
});
