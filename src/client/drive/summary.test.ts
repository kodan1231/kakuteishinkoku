import { describe, expect, it } from "vitest";
import type { MedicalRecord } from "./records";
import { allocate } from "./reimbursements";
import { estimateDeduction, incomeRow, parseIncome, summarize } from "./summary";

const record = (over: Partial<MedicalRecord>): MedicalRecord => ({
  id: "r",
  date: "2026-01-15",
  personId: "p1",
  personName: "小段圭司",
  payee: "順天堂医院",
  category: "診療・治療",
  amount: 1000,
  reimbursed: 0,
  memo: "",
  receiptFileIds: [],
  source: "manual",
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
  status: "final",
  ...over,
});

describe("summarize", () => {
  const family = [
    { id: "p1", name: "小段圭司" },
    { id: "p2", name: "小段あゆみ" },
  ];
  const records = [
    record({ id: "a", amount: 10000, reimbursed: 1000 }),
    record({ id: "b", date: "2026-07-03", personId: "p2", personName: "小段あゆみ", amount: 20000 }),
    record({ id: "c", date: "2026-07-04", personId: "gone", personName: "削除した人", category: "医薬品購入", amount: 500 }),
    record({ id: "d", amount: 99999, status: "draft" }),
  ];
  const allocation = allocate(records, [
    { id: "m", month: "2026-07", personId: "p2", amount: 14600, kind: "健保給付", memo: "", createdAt: "", updatedAt: "" },
  ]);
  const s = summarize(records, allocation, 2026, family);

  it("確定した記録だけを合計し、補填には健保給付の配分を含める", () => {
    expect(s.total).toMatchObject({ count: 3, paid: 30500, reimbursed: 15600, adjusted: 14900 });
  });

  it("人別は家族の順、削除した人は後ろ", () => {
    expect(s.byPerson.map((p) => [p.label, p.count, p.adjusted])).toEqual([
      ["小段圭司", 1, 9000],
      ["小段あゆみ", 1, 5400],
      ["削除した人", 1, 500],
    ]);
  });

  it("区分別・月別は全区分・12か月", () => {
    expect(s.byCategory.map((c) => c.paid)).toEqual([30000, 500, 0, 0]);
    expect(s.byMonth).toHaveLength(12);
    expect(s.byMonth[6]).toMatchObject({ label: "7月", count: 2, paid: 20500 });
  });
});

describe("estimateDeduction", () => {
  it("総所得金額等が未入力なら10万円を差し引く", () => {
    expect(estimateDeduction(150000, null)).toEqual({ threshold: 100000, deduction: 50000 });
    expect(estimateDeduction(80000, null)).toEqual({ threshold: 100000, deduction: 0 });
  });

  it("総所得金額等の5%が10万円より少なければそちら", () => {
    expect(estimateDeduction(150000, 1_500_000)).toEqual({ threshold: 75000, deduction: 75000 });
    expect(estimateDeduction(150000, 4_000_000)).toEqual({ threshold: 100000, deduction: 50000 });
    expect(estimateDeduction(150000, 1_234_567)).toEqual({ threshold: 61728, deduction: 88272 });
  });

  it("上限は200万円", () => {
    expect(estimateDeduction(3_000_000, null).deduction).toBe(2_000_000);
  });
});

describe("設定シート", () => {
  it("総所得金額等を読む", () => {
    expect(parseIncome([["key", "value"], ["総所得金額等", 4500000]])).toBe(4500000);
    expect(parseIncome([["key", "value"], ["総所得金額等", ""]])).toBeNull();
    expect(parseIncome([["key", "value"], ["総所得金額等"]])).toBeNull();
    expect(parseIncome([["key", "value"], ["総所得金額等", "abc"]])).toBeNull();
    expect(parseIncome([["key", "value"]])).toBeNull();
    expect(incomeRow([["key", "value"], ["総所得金額等", 1]])).toBe(2);
    expect(incomeRow([["key", "value"]])).toBeNull();
  });
});
