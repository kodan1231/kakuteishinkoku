import { describe, expect, it } from "vitest";
import { applyFilter, EMPTY_FILTER, filterFromParams, filterToParams, groupByMonth, hasCondition } from "./recordFilter";
import type { MedicalRecord } from "./records";

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
  receiptFileIds: ["f"],
  source: "manual",
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
  status: "final",
  ...over,
});

const records = [
  record({ id: "a", date: "2026-01-10", payee: "順天堂医院", amount: 3000 }),
  record({ id: "b", date: "2026-03-05", payee: "ロハル薬局", category: "医薬品購入", amount: 800, personId: "p2" }),
  record({ id: "c", date: "2026-07-20", payee: "JR東日本", category: "その他の医療費", amount: 420, memo: "通院: 自宅→順天堂医院（往復）", receiptFileIds: [] }),
];
const ids = (rs: MedicalRecord[]) => rs.map((r) => r.id);

describe("applyFilter", () => {
  it("条件なしは日付の新しい順", () => {
    expect(ids(applyFilter(records, EMPTY_FILTER))).toEqual(["c", "b", "a"]);
  });

  it("キーワードは支払先・メモを表記ゆれを無視して探す", () => {
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, q: "じゅんてんどう" }))).toEqual([]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, q: "順天堂" }))).toEqual(["c", "a"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, q: "ろはる" }))).toEqual(["b"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, q: "ｊｒ" }))).toEqual(["c"]);
  });

  it("人・区分・期間・金額・領収書なしで絞り込む", () => {
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, personId: "p2" }))).toEqual(["b"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, category: "診療・治療" }))).toEqual(["a"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, fromMonth: "3", toMonth: "7" }))).toEqual(["c", "b"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, fromMonth: "7", toMonth: "3" }))).toEqual(["c", "b"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, toMonth: "2" }))).toEqual(["a"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, min: "５００", max: "3,000円" }))).toEqual(["b", "a"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, noReceipt: true }))).toEqual(["c"]);
  });

  it("並び順を変えられる", () => {
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, sort: "old" }))).toEqual(["a", "b", "c"]);
    expect(ids(applyFilter(records, { ...EMPTY_FILTER, sort: "amount" }))).toEqual(["a", "b", "c"]);
  });
});

describe("URL のクエリ", () => {
  it("条件を往復できる", () => {
    const f = { ...EMPTY_FILTER, q: "薬局", personId: "p2", fromMonth: "3", min: "100", noReceipt: true, sort: "old" as const };
    const p = filterToParams(f);
    expect(p.toString()).toBe("q=%E8%96%AC%E5%B1%80&person=p2&from=3&min=100&noReceipt=1&sort=old");
    expect(filterFromParams(p)).toEqual(f);
  });

  it("既定値はクエリに入れず、不明な並び順は既定にする", () => {
    expect(filterToParams(EMPTY_FILTER).toString()).toBe("");
    expect(filterFromParams(new URLSearchParams("sort=xxx")).sort).toBe("new");
  });

  it("並び順だけなら条件なし", () => {
    expect(hasCondition({ ...EMPTY_FILTER, sort: "amount" })).toBe(false);
    expect(hasCondition({ ...EMPTY_FILTER, category: "医薬品購入" })).toBe(true);
  });
});

describe("groupByMonth", () => {
  it("並び順を保って月ごとにまとめる", () => {
    const groups = groupByMonth(applyFilter([...records, record({ id: "d", date: "2026-07-01" })], EMPTY_FILTER));
    expect(groups.map((g) => [g.month, ids(g.records)])).toEqual([
      ["2026-07", ["c", "d"]],
      ["2026-03", ["b"]],
      ["2026-01", ["a"]],
    ]);
  });
});
