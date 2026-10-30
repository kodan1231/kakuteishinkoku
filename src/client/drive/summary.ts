import { MEDICAL_CATEGORIES } from "../../shared/medical";
import { isFinal, type MedicalRecord } from "./records";
import { monthsOf, totalReimbursed, type Allocation } from "./reimbursements";

/** 集計画面の小計と控除見込額（design.md 7.1）。対象は確定した記録だけ */

export interface Subtotal {
  key: string;
  label: string;
  count: number;
  paid: number;
  reimbursed: number;
  adjusted: number;
}

export interface Summary {
  total: Subtotal;
  byPerson: Subtotal[];
  byCategory: Subtotal[];
  byMonth: Subtotal[];
}

function subtotal(key: string, label: string, records: MedicalRecord[], allocation: Allocation): Subtotal {
  const paid = records.reduce((s, r) => s + r.amount, 0);
  const reimbursed = records.reduce((s, r) => s + totalReimbursed(r, allocation), 0);
  return { key, label, count: records.length, paid, reimbursed, adjusted: paid - reimbursed };
}

export function summarize(
  records: MedicalRecord[],
  allocation: Allocation,
  year: number,
  family: { id: string; name: string }[],
): Summary {
  const finals = records.filter(isFinal);
  // 家族の並び順で、家族を削除した人の記録は後ろに
  const personIds = [...new Set([...family.map((f) => f.id), ...finals.map((r) => r.personId)])];
  return {
    total: subtotal("total", "合計", finals, allocation),
    byPerson: personIds.map((id) => {
      const rs = finals.filter((r) => r.personId === id);
      return subtotal(id, family.find((f) => f.id === id)?.name ?? rs[0]?.personName ?? "", rs, allocation);
    }),
    byCategory: MEDICAL_CATEGORIES.map((c) => subtotal(c, c, finals.filter((r) => r.category === c), allocation)),
    byMonth: monthsOf(year).map((m) => subtotal(m, `${Number(m.slice(5))}月`, finals.filter((r) => r.date.startsWith(`${m}-`)), allocation)),
  };
}

export const DEDUCTION_THRESHOLD = 100_000;
export const DEDUCTION_MAX = 2_000_000;

export interface Deduction {
  /** 差し引く額: min(10万円, 総所得金額等 × 5%) */
  threshold: number;
  deduction: number;
}

/** 控除見込額 = 支払額 − 補填 − min(10万円, 総所得金額等 × 5%)（0円〜200万円）。総所得金額等が未入力なら10万円で計算 */
export function estimateDeduction(adjusted: number, income: number | null): Deduction {
  const threshold = income === null ? DEDUCTION_THRESHOLD : Math.min(DEDUCTION_THRESHOLD, Math.floor(income * 0.05));
  return { threshold, deduction: Math.min(Math.max(adjusted - threshold, 0), DEDUCTION_MAX) };
}

export const INCOME_KEY = "総所得金額等";

/** 設定シートの値（見出し行を含む）から総所得金額等を読む。未入力・数値でなければ null */
export function parseIncome(settings: unknown[][]): number | null {
  const row = settings.find((r) => r[0] === INCOME_KEY);
  const v = row?.[1];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** 設定シートで総所得金額等の行（1始まり）。無ければ null */
export function incomeRow(settings: unknown[][]): number | null {
  const i = settings.findIndex((r) => r[0] === INCOME_KEY);
  return i < 0 ? null : i + 1;
}
