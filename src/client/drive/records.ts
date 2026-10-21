import { MEDICAL_CATEGORIES } from "../../shared/medical";
import type { CellValue } from "./google";
import { checkHeader, MEDICAL_HEADERS, SHEET } from "./ledger";

/** 医療費シートの記録（design.md 5.3）。端末内で完結する純粋な処理だけを置く */

/** 医療費集計フォームの「病院・薬局などの名称」は全角20文字以内 */
export const PAYEE_MAX_LENGTH = 20;
/** 医療費集計フォームの金額は半角数字9桁以内 */
export const AMOUNT_MAX = 999_999_999;
export const MEMO_MAX_LENGTH = 200;
/** PDF はそのまま保存するため上限を設ける */
export const PDF_MAX_BYTES = 10 * 1024 * 1024;

export type RecordSource = "manual" | "ocr";

export interface MedicalRecord {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  personId: string;
  /** 記録時点の名前（家族を削除・改名しても記録の表示・出力に使う） */
  personName: string;
  payee: string;
  category: string;
  amount: number;
  reimbursed: number;
  memo: string;
  receiptFileIds: string[];
  source: RecordSource;
  createdAt: string;
  updatedAt: string;
}

/** 入力画面の値（金額は文字列のまま受け取る） */
export interface RecordInput {
  date: string;
  personId: string;
  payee: string;
  category: string;
  amount: string;
  reimbursed: string;
  memo: string;
}

export function medicalRow(r: MedicalRecord): CellValue[] {
  return [
    r.id,
    r.date,
    r.personId,
    r.personName,
    r.payee,
    r.category,
    r.amount,
    r.reimbursed,
    r.memo,
    r.receiptFileIds.join(","),
    r.source,
    r.createdAt,
    r.updatedAt,
    false,
  ];
}

/** 医療費シートの値（見出し行を含む）を読み取る。削除済みは除き、新しい順に並べる */
export function parseMedical(values: unknown[][]): { records: MedicalRecord[]; problems: string[] } {
  const [header = [], ...rows] = values;
  const problems: string[] = [];
  const headerProblem = checkHeader(SHEET.medical, header, MEDICAL_HEADERS);
  if (headerProblem) problems.push(headerProblem);

  const seen = new Set<string>();
  const records: MedicalRecord[] = [];
  rows.forEach((r, i) => {
    const id = String(r[0] ?? "").trim();
    if (!id) return;
    if (seen.has(id)) {
      problems.push(`シート「${SHEET.medical}」の id が重複しています（${i + 2}行目）`);
      return;
    }
    seen.add(id);
    if (r[13] === true || String(r[13]).toUpperCase() === "TRUE") return;
    records.push({
      id,
      date: normalizeDate(r[1]),
      personId: str(r[2]),
      personName: str(r[3]),
      payee: str(r[4]),
      category: str(r[5]),
      amount: Number(r[6]) || 0,
      reimbursed: Number(r[7]) || 0,
      memo: str(r[8]),
      receiptFileIds: str(r[9])
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      source: str(r[10]) === "ocr" ? "ocr" : "manual",
      createdAt: str(r[11]),
      updatedAt: str(r[12]),
    });
  });
  return { records: sortRecords(records), problems };
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

/** スプレッドシートで手入力された日付はシリアル値で返るため YYYY-MM-DD に直す */
export function normalizeDate(v: unknown): string {
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const m = str(v)
    .trim()
    .match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : str(v);
}

/** 支払日の新しい順。同じ日は後から登録した順 */
export function sortRecords(records: MedicalRecord[]): MedicalRecord[] {
  return [...records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** 全角数字・カンマ・円記号を許して整数にする。整数でなければ null */
export function parseAmount(s: string): number | null {
  const n = s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s¥￥円]/g, "");
  return /^\d+$/.test(n) ? Number(n) : null;
}

export type RecordErrors = Partial<Record<keyof RecordInput, string>>;

export function validateRecord(v: RecordInput, year: number): RecordErrors {
  const errors: RecordErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) errors.date = "支払日を入力してください";
  else if (!v.date.startsWith(`${year}-`)) errors.date = `${year}年の日付を入力してください（別の年の分は設定で年度を切り替えてください）`;
  if (!v.personId) errors.personId = "医療を受けた人を選んでください";
  const payee = v.payee.trim();
  if (!payee) errors.payee = "支払先を入力してください";
  else if ([...payee].length > PAYEE_MAX_LENGTH) errors.payee = `支払先は${PAYEE_MAX_LENGTH}文字以内で入力してください`;
  if (!(MEDICAL_CATEGORIES as readonly string[]).includes(v.category)) errors.category = "区分を選んでください";
  const amount = parseAmount(v.amount);
  if (amount === null || amount < 1 || amount > AMOUNT_MAX) errors.amount = "支払額を1円以上の整数で入力してください";
  const reimbursed = v.reimbursed.trim() ? parseAmount(v.reimbursed) : 0;
  if (reimbursed === null || reimbursed > AMOUNT_MAX) errors.reimbursed = "補填額を整数で入力してください";
  else if (amount !== null && reimbursed > amount) errors.reimbursed = "補填額は支払額以下にしてください";
  if ([...v.memo.trim()].length > MEMO_MAX_LENGTH) errors.memo = `メモは${MEMO_MAX_LENGTH}文字以内で入力してください`;
  return errors;
}

/** 入力済みの支払先（新しい記録のものから順に、重複なし） */
export function payeeSuggestions(records: MedicalRecord[]): string[] {
  return [...new Set(sortRecords(records).map((r) => r.payee))];
}

/** 同じ支払先の直近の記録の区分 */
export function lastCategoryFor(records: MedicalRecord[], payee: string): string | null {
  return sortRecords(records).find((r) => r.payee === payee.trim())?.category ?? null;
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/** 領収書のファイル名: 20260115_〇〇病院_12340_<記録idの先頭8文字>[-2].jpg */
export function receiptFileName(
  r: Pick<MedicalRecord, "id" | "date" | "payee" | "amount">,
  index: number,
  mimeType: string,
): string {
  const payee = r.payee.trim().replace(/[\\/:*?"<>|\s]+/g, "_");
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `${r.date.replaceAll("-", "")}_${payee}_${r.amount}_${r.id.slice(0, 8)}${suffix}.${EXTENSIONS[mimeType] ?? "bin"}`;
}

export function todayString(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}
