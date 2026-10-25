import { describe, expect, it } from "vitest";
import { MEDICAL_HEADERS } from "./ledger";
import {
  findLinkedTransport,
  isTransportRecord,
  lastCategoryFor,
  lastVisitTo,
  validateDraft,
  medicalRow,
  normalizeDate,
  parseAmount,
  parseMedical,
  payeeSuggestions,
  receiptFileName,
  transportAmount,
  transportFromRecord,
  transportMemo,
  validateRecord,
  validateTransport,
  type MedicalRecord,
  type RecordInput,
  type TransportInput,
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
  status: "final",
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

  it("一時保存の状態を読み戻せる。状態列が無い古い行は確定扱い", () => {
    const draft = record({ id: "d", status: "draft" });
    const old = medicalRow(record({ id: "o" })).slice(0, 14);
    const { records } = parseMedical([MEDICAL_HEADERS, medicalRow(draft), old]);
    expect(records.find((r) => r.id === "d")?.status).toBe("draft");
    expect(records.find((r) => r.id === "o")?.status).toBe("final");
  });
});

describe("validateDraft", () => {
  it("未入力の項目は許し、入力済みの項目は確認する", () => {
    const empty = input({ date: "", payee: "", amount: "" });
    expect(validateDraft(empty, 2026)).toEqual({});
    expect(validateDraft({ ...empty, amount: "abc", payee: "あ".repeat(21) }, 2026)).toEqual({
      amount: expect.any(String),
      payee: expect.any(String),
    });
  });
});

describe("一時保存の記録は候補・呼び出しに使わない", () => {
  it("確定した記録だけを使う", () => {
    const records = [
      record({ id: "1", date: "2026-01-10", payee: "△△薬局", status: "draft" }),
      record({ id: "2", date: "2026-01-05", payee: "財務総合病院" }),
    ];
    expect(payeeSuggestions(records)).toEqual(["財務総合病院"]);
    expect(lastVisitTo(records, "△△薬局")).toBeNull();
    expect(lastVisitTo(records, "財務総合病院")?.id).toBe("2");
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

describe("交通費", () => {
  const transport = (over: Partial<TransportInput> = {}): TransportInput => ({
    carrier: "JR",
    from: "自宅",
    to: "順天堂医院",
    fare: "220",
    roundTrip: true,
    ...over,
  });

  it("往復なら運賃の2倍、メモに区間を入れる", () => {
    expect(transportAmount(transport())).toBe(440);
    expect(transportAmount(transport({ roundTrip: false }))).toBe(220);
    expect(transportMemo(transport())).toBe("通院: 自宅→順天堂医院（往復）");
  });

  it("保存した記録から入力欄の値を復元できる", () => {
    const r = record({ payee: "JR", category: "その他の医療費", amount: 440, memo: transportMemo(transport()) });
    expect(isTransportRecord(r)).toBe(true);
    expect(transportFromRecord(r)).toEqual(transport());
  });

  it("交通費でない記録は対象外", () => {
    expect(isTransportRecord(record({ category: "その他の医療費", memo: "眼鏡" }))).toBe(false);
    expect(transportFromRecord(record({}))).toBeNull();
  });

  it("同じ日・同じ人の交通費を診療の記録にひも付ける", () => {
    const visit = record({ id: "v", date: "2026-01-15", personId: "p1" });
    const memo = transportMemo(transport());
    const t1 = record({ id: "t1", date: "2026-01-15", personId: "p1", category: "その他の医療費", memo });
    const t2 = record({ id: "t2", date: "2026-01-15", personId: "p2", category: "その他の医療費", memo });
    expect(findLinkedTransport([visit, t2, t1], visit)?.id).toBe("t1");
    expect(findLinkedTransport([visit, t2], visit)).toBeNull();
  });

  it("入力チェック", () => {
    expect(validateTransport(transport())).toEqual({});
    expect(validateTransport(transport({ carrier: "", to: "", fare: "0" }))).toEqual({
      carrier: expect.any(String),
      to: expect.any(String),
      fare: expect.any(String),
    });
  });
});

describe("receiptFileName", () => {
  it("日付_支払先_金額_id を付け、2枚目以降は連番", () => {
    const r = record({ payee: "JR / 東京駅" });
    expect(receiptFileName(r, 0, "image/jpeg")).toBe("20260115_JR_東京駅_12340_abcdef12.jpg");
    expect(receiptFileName(r, 1, "application/pdf")).toBe("20260115_JR_東京駅_12340_abcdef12-2.pdf");
  });
});
