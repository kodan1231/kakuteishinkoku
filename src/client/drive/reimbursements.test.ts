import { describe, expect, it } from "vitest";
import { REIMBURSEMENT_HEADERS } from "./ledger";
import type { MedicalRecord } from "./records";
import {
  adjustedAmount,
  allocate,
  parseReimbursements,
  reimbursementRow,
  totalReimbursed,
  type MonthlyReimbursement,
} from "./reimbursements";

const record = (over: Partial<MedicalRecord>): MedicalRecord => ({
  id: "r",
  date: "2026-01-15",
  personId: "p1",
  personName: "本人",
  payee: "順天堂",
  category: "診療・治療",
  amount: 10000,
  reimbursed: 0,
  memo: "",
  receiptFileIds: [],
  source: "manual",
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
  status: "final",
  ...over,
});

const entry = (over: Partial<MonthlyReimbursement>): MonthlyReimbursement => ({
  id: "e",
  month: "2026-01",
  personId: "",
  amount: 3000,
  kind: "健保給付",
  memo: "",
  createdAt: "2026-02-25T00:00:00.000Z",
  updatedAt: "2026-02-25T00:00:00.000Z",
  ...over,
});

describe("allocate", () => {
  it("支払額に比例して配分する", () => {
    const records = [record({ id: "a", amount: 10000 }), record({ id: "b", amount: 5000, category: "医薬品購入" })];
    const a = allocate(records, [entry({ amount: 3000 })]);
    expect(a.byRecord.get("a")).toBe(2000);
    expect(a.byRecord.get("b")).toBe(1000);
    expect(a.entries[0]).toMatchObject({ eligible: 15000, allocated: 3000, excess: 0 });
    expect(adjustedAmount(records[0], a)).toBe(8000);
  });

  it("端数は金額の大きい記録から1円ずつ割り当て、合計が補填額と一致する", () => {
    const records = [record({ id: "a", amount: 100 }), record({ id: "b", amount: 100 }), record({ id: "c", amount: 101 })];
    const a = allocate(records, [entry({ amount: 100 })]);
    const values = ["a", "b", "c"].map((id) => a.byRecord.get(id) ?? 0);
    expect(values.reduce((s, x) => s + x, 0)).toBe(100);
    expect(a.byRecord.get("c")).toBe(34);
  });

  it("交通費・一時保存・別の月・別の人は対象外", () => {
    const records = [
      record({ id: "a" }),
      record({ id: "t", category: "その他の医療費" }),
      record({ id: "d", status: "draft" }),
      record({ id: "f", date: "2026-02-01" }),
      record({ id: "p", personId: "p2" }),
    ];
    const a = allocate(records, [entry({ personId: "p1", amount: 1000 })]);
    expect([...a.byRecord.keys()]).toEqual(["a"]);
  });

  it("記録ごとの補填額を除いた残りに配分し、対象を超える分は配分しない", () => {
    const records = [record({ id: "a", amount: 10000, reimbursed: 8000 })];
    const a = allocate(records, [entry({ amount: 5000 })]);
    expect(a.byRecord.get("a")).toBe(2000);
    expect(a.entries[0]).toMatchObject({ eligible: 2000, allocated: 2000, excess: 3000 });
    expect(totalReimbursed(records[0], a)).toBe(10000);
    expect(adjustedAmount(records[0], a)).toBe(0);
  });

  it("同じ月の2つ目の補填は、1つ目の配分の残りに配分する", () => {
    const records = [record({ id: "a", amount: 10000 })];
    const a = allocate(records, [entry({ id: "1", amount: 6000 }), entry({ id: "2", amount: 6000, createdAt: "2026-03-01" })]);
    expect(a.byRecord.get("a")).toBe(10000);
    expect(a.entries[1]).toMatchObject({ eligible: 4000, allocated: 4000, excess: 2000 });
  });

  it("対象の記録が無ければ全額が超過", () => {
    expect(allocate([], [entry({ amount: 1000 })]).entries[0]).toMatchObject({ eligible: 0, allocated: 0, excess: 1000 });
  });
});

describe("parseReimbursements", () => {
  it("書き込んだ行を読み戻せる。削除済みは除く", () => {
    const e = entry({ id: "x", personId: "p1", memo: "1月分" });
    const deleted = reimbursementRow(entry({ id: "y" }));
    deleted[8] = true;
    const { entries, problems } = parseReimbursements([REIMBURSEMENT_HEADERS, reimbursementRow(e), deleted]);
    expect(problems).toEqual([]);
    expect(entries).toEqual([e]);
  });
});
