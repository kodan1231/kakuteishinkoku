import type { CellValue } from "./google";
import { checkHeader, REIMBURSEMENT_HEADERS, SHEET } from "./ledger";
import { isFinal, type MedicalRecord } from "./records";

/**
 * 月ごとの補填額（健保給付など）と、医療費の記録への配分（design.md 7.3）。
 * 記録の支払額・補填額は書き換えず、表示・出力のたびにここで配分を計算する。
 */

export const DEFAULT_REIMBURSEMENT_KIND = "健保給付";
/** 高額療養費は保険診療の自己負担分が対象のため、交通費・介護保険サービスには配分しない */
export const ALLOCATION_CATEGORIES = ["診療・治療", "医薬品購入"];

export interface MonthlyReimbursement {
  id: string;
  /** YYYY-MM */
  month: string;
  /** 空なら家族全員 */
  personId: string;
  amount: number;
  kind: string;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

export function reimbursementRow(r: MonthlyReimbursement): CellValue[] {
  return [r.id, r.month, r.personId, r.amount, r.kind, r.memo, r.createdAt, r.updatedAt, false];
}

export function parseReimbursements(values: unknown[][]): { entries: MonthlyReimbursement[]; problems: string[] } {
  const [header = [], ...rows] = values;
  const problems: string[] = [];
  const headerProblem = checkHeader(SHEET.reimbursement, header, REIMBURSEMENT_HEADERS);
  if (headerProblem) problems.push(headerProblem);
  const seen = new Set<string>();
  const entries: MonthlyReimbursement[] = [];
  rows.forEach((r, i) => {
    const id = String(r[0] ?? "").trim();
    if (!id) return;
    if (seen.has(id)) {
      problems.push(`シート「${SHEET.reimbursement}」の id が重複しています（${i + 2}行目）`);
      return;
    }
    seen.add(id);
    if (r[8] === true || String(r[8]).toUpperCase() === "TRUE") return;
    entries.push({
      id,
      month: String(r[1] ?? ""),
      personId: String(r[2] ?? ""),
      amount: Number(r[3]) || 0,
      kind: String(r[4] ?? "") || DEFAULT_REIMBURSEMENT_KIND,
      memo: String(r[5] ?? ""),
      createdAt: String(r[6] ?? ""),
      updatedAt: String(r[7] ?? ""),
    });
  });
  return { entries, problems };
}

export interface EntrySummary {
  entry: MonthlyReimbursement;
  /** 配分前の対象の医療費（支払額 − 記録ごとの補填額） */
  eligible: number;
  allocated: number;
  /** 対象の医療費を超えて配分できなかった額 */
  excess: number;
}

export interface Allocation {
  /** 記録 id → 配分額 */
  byRecord: Map<string, number>;
  entries: EntrySummary[];
}

/** 配分の対象になる記録（確定・対象の区分・その月・対象の人） */
export function eligibleRecords(records: MedicalRecord[], month: string, personId: string): MedicalRecord[] {
  return records.filter(
    (r) =>
      isFinal(r) &&
      ALLOCATION_CATEGORIES.includes(r.category) &&
      r.date.startsWith(`${month}-`) &&
      (!personId || r.personId === personId),
  );
}

/**
 * 補填額を対象の記録に支払額（記録ごとの補填額を除いた残り）に比例して配分する。
 * 1円未満の端数は、残りの大きい記録から順に1円ずつ割り当てる。
 */
export function allocate(records: MedicalRecord[], entries: MonthlyReimbursement[]): Allocation {
  const byRecord = new Map<string, number>();
  const summaries: EntrySummary[] = [];
  const ordered = [...entries].sort((a, b) => a.month.localeCompare(b.month) || a.createdAt.localeCompare(b.createdAt));
  for (const entry of ordered) {
    const targets = eligibleRecords(records, entry.month, entry.personId)
      .map((r) => ({ r, room: Math.max(r.amount - r.reimbursed - (byRecord.get(r.id) ?? 0), 0) }))
      .filter((t) => t.room > 0)
      // 端数の割り当て順: 残りの大きい順 → 日付 → id（毎回同じ結果になるように）
      .sort((a, b) => b.room - a.room || a.r.date.localeCompare(b.r.date) || a.r.id.localeCompare(b.r.id));
    const eligible = targets.reduce((sum, t) => sum + t.room, 0);
    const total = Math.min(Math.max(entry.amount, 0), eligible);
    const shares = targets.map((t) => Math.floor((total * t.room) / eligible));
    let rest = total - shares.reduce((s, x) => s + x, 0);
    for (let i = 0; rest > 0; i = (i + 1) % targets.length) {
      if (shares[i] < targets[i].room) {
        shares[i]++;
        rest--;
      }
    }
    targets.forEach((t, i) => {
      if (shares[i] > 0) byRecord.set(t.r.id, (byRecord.get(t.r.id) ?? 0) + shares[i]);
    });
    summaries.push({ entry, eligible, allocated: total, excess: Math.max(entry.amount - total, 0) });
  }
  return { byRecord, entries: summaries };
}

/** 記録の調整後の金額（支払額 − 記録ごとの補填額 − 配分額） */
export function adjustedAmount(r: MedicalRecord, allocation: Allocation): number {
  return r.amount - r.reimbursed - (allocation.byRecord.get(r.id) ?? 0);
}

/** 集計フォームなどに出す補填額（記録ごとの補填額 + 配分額） */
export function totalReimbursed(r: MedicalRecord, allocation: Allocation): number {
  return r.reimbursed + (allocation.byRecord.get(r.id) ?? 0);
}

/** その年の月（YYYY-MM）の一覧 */
export function monthsOf(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}
