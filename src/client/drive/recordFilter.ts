import { normalizePayee } from "./ocrCorrections";
import { parseAmount, type MedicalRecord } from "./records";

/** 記録一覧の絞り込み（design.md 6.4）。条件は URL のクエリに持たせる */

export type RecordSort = "new" | "old" | "amount";

export interface RecordFilter {
  /** 支払先・メモのキーワード（表記ゆれは無視） */
  q: string;
  personId: string;
  category: string;
  /** 期間の開始月・終了月（"1"〜"12"、空欄なら指定なし） */
  fromMonth: string;
  toMonth: string;
  /** 支払額の範囲（入力のまま。空欄なら指定なし） */
  min: string;
  max: string;
  noReceipt: boolean;
  sort: RecordSort;
}

export const EMPTY_FILTER: RecordFilter = {
  q: "",
  personId: "",
  category: "",
  fromMonth: "",
  toMonth: "",
  min: "",
  max: "",
  noReceipt: false,
  sort: "new",
};

const SORTS: RecordSort[] = ["new", "old", "amount"];

export function filterFromParams(p: URLSearchParams): RecordFilter {
  const sort = p.get("sort") as RecordSort | null;
  return {
    q: p.get("q") ?? "",
    personId: p.get("person") ?? "",
    category: p.get("cat") ?? "",
    fromMonth: p.get("from") ?? "",
    toMonth: p.get("to") ?? "",
    min: p.get("min") ?? "",
    max: p.get("max") ?? "",
    noReceipt: p.get("noReceipt") === "1",
    sort: sort && SORTS.includes(sort) ? sort : "new",
  };
}

export function filterToParams(f: RecordFilter): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v: string) => v && p.set(k, v);
  set("q", f.q);
  set("person", f.personId);
  set("cat", f.category);
  set("from", f.fromMonth);
  set("to", f.toMonth);
  set("min", f.min);
  set("max", f.max);
  if (f.noReceipt) p.set("noReceipt", "1");
  if (f.sort !== "new") p.set("sort", f.sort);
  return p;
}

/** 並び順以外の条件が入っているか */
export function hasCondition(f: RecordFilter): boolean {
  return filterToParams({ ...f, sort: "new" }).toString() !== "";
}

export function applyFilter(records: MedicalRecord[], f: RecordFilter): MedicalRecord[] {
  const q = normalizePayee(f.q);
  const from = Number(f.fromMonth) || 1;
  const to = Number(f.toMonth) || 12;
  const min = f.min.trim() ? parseAmount(f.min) : null;
  const max = f.max.trim() ? parseAmount(f.max) : null;
  const matched = records.filter((r) => {
    if (q && !normalizePayee(`${r.payee} ${r.memo}`).includes(q)) return false;
    if (f.personId && r.personId !== f.personId) return false;
    if (f.category && r.category !== f.category) return false;
    const month = Number(r.date.slice(5, 7));
    if ((f.fromMonth || f.toMonth) && !(month >= Math.min(from, to) && month <= Math.max(from, to))) return false;
    if (min !== null && r.amount < min) return false;
    if (max !== null && r.amount > max) return false;
    if (f.noReceipt && r.receiptFileIds.length > 0) return false;
    return true;
  });
  return sortBy(matched, f.sort);
}

function sortBy(records: MedicalRecord[], sort: RecordSort): MedicalRecord[] {
  const byNew = (a: MedicalRecord, b: MedicalRecord) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
  const sorted = [...records];
  if (sort === "old") sorted.sort((a, b) => -byNew(a, b));
  else if (sort === "amount") sorted.sort((a, b) => b.amount - a.amount || byNew(a, b));
  else sorted.sort(byNew);
  return sorted;
}

export interface MonthGroup {
  /** YYYY-MM */
  month: string;
  records: MedicalRecord[];
}

/** 日付順に並んだ記録を月ごとにまとめる（並び順は保つ） */
export function groupByMonth(records: MedicalRecord[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const r of records) {
    const month = r.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.records.push(r);
    else groups.push({ month, records: [r] });
  }
  return groups;
}

// 記録画面から一覧に戻るときに条件を残すため、最後に開いた一覧の条件を覚えておく（アプリを開き直したら消える）
let lastSearch = "";

export function rememberRecordsSearch(search: string): void {
  lastSearch = search;
}

export function recordsPath(): string {
  return lastSearch ? `/records?${lastSearch}` : "/records";
}
