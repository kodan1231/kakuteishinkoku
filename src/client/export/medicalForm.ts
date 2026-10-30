import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { MEDICAL_CATEGORIES } from "../../shared/medical";
import { isFinal, type MedicalRecord } from "../drive/records";
import { totalReimbursed, type Allocation } from "../drive/reimbursements";

/**
 * 国税庁「医療費集計フォーム」（Ver.3.1）への書き込みと CSV（design.md 7.2）。
 * 入力規則・シートの保護・図形を壊さないよう、テンプレートの XML の入力欄だけを書き換える。
 */

/** 入力欄は 9〜1003 行目（995 件） */
export const FORM_FIRST_ROW = 9;
export const FORM_MAX_ROWS = 995;
const FORM_SHEET = "xl/worksheets/sheet1.xml";
const WORKBOOK = "xl/workbook.xml";
const CHECKED = "該当する";
/** 区分の列（D: 診療・治療、E: 医薬品購入、F: 介護保険サービス、G: その他の医療費） */
const CATEGORY_COLUMNS = ["D", "E", "F", "G"];

/** each: 領収書1件ずつ、grouped: 医療を受けた人・支払先ごとにまとめる */
export type FormMode = "each" | "grouped";

export interface FormRow {
  person: string;
  payee: string;
  categories: string[];
  amount: number;
  /** 記録ごとの補填額 + 健保給付の配分 */
  reimbursed: number;
  /** 2026/1/15 の形（まとめた行は空欄） */
  date: string;
}

/** YYYY-MM-DD → 2026/1/15（フォームの入力例の表示に合わせる） */
export function formDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return y && m && d ? `${y}/${m}/${d}` : "";
}

function byDate(a: MedicalRecord, b: MedicalRecord): number {
  return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
}

/** 出力の対象（確定した記録）を支払日順に行にする */
export function buildFormRows(records: MedicalRecord[], allocation: Allocation, mode: FormMode): FormRow[] {
  const targets = records.filter((r) => isFinal(r) && r.amount > 0).sort(byDate);
  if (mode === "each") {
    return targets.map((r) => ({
      person: r.personName,
      payee: r.payee,
      categories: [r.category],
      amount: r.amount,
      reimbursed: totalReimbursed(r, allocation),
      date: formDate(r.date),
    }));
  }
  const groups = new Map<string, FormRow>();
  for (const r of targets) {
    const key = `${r.personName}\u0000${r.payee}`;
    const g = groups.get(key) ?? { person: r.personName, payee: r.payee, categories: [], amount: 0, reimbursed: 0, date: "" };
    if (!g.categories.includes(r.category)) g.categories.push(r.category);
    g.amount += r.amount;
    g.reimbursed += totalReimbursed(r, allocation);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** 空のセル <c r="B9" s="6"/> を、値の入ったセルに1回の走査で置き換える */
function setCells(xml: string, values: Map<string, string | number>): string {
  const done = new Set<string>();
  const out = xml.replace(/<c r="([A-Z]+\d+)"( s="\d+")?\/>/g, (all, ref: string, style = "") => {
    const value = values.get(ref);
    if (value === undefined) return all;
    done.add(ref);
    return typeof value === "number"
      ? `<c r="${ref}"${style}><v>${value}</v></c>`
      : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  });
  const missing = [...values.keys()].find((ref) => !done.has(ref));
  if (missing) throw new Error(`集計フォームのセル ${missing} が見つかりません（フォームの版が変わった可能性があります）`);
  return out;
}

/** 合計の数式（C3: 支払額、C4: 補填額）の計算結果を入れておく（開いたときにも再計算させる） */
function setFormulaResult(xml: string, ref: string, value: number): string {
  if (value === 0) return xml;
  return xml.replace(new RegExp(`(<c r="${ref}" s="\\d+") t="str">(<f>[^<]*</f>)<v/></c>`), `$1>$2<v>${value}</v></c>`);
}

export function fillFormSheet(sheetXml: string, rows: FormRow[]): string {
  if (rows.length > FORM_MAX_ROWS) {
    throw new Error(`集計フォームに入るのは${FORM_MAX_ROWS}件までです（${rows.length}件）。「人・支払先ごとにまとめる」で作成してください`);
  }
  const values = new Map<string, string | number>();
  rows.forEach((r, i) => {
    const n = FORM_FIRST_ROW + i;
    values.set(`B${n}`, r.person);
    values.set(`C${n}`, r.payee);
    MEDICAL_CATEGORIES.forEach((c, j) => {
      if (r.categories.includes(c)) values.set(`${CATEGORY_COLUMNS[j]}${n}`, CHECKED);
    });
    values.set(`H${n}`, r.amount);
    if (r.reimbursed > 0) values.set(`I${n}`, r.reimbursed);
    if (r.date) values.set(`J${n}`, r.date);
  });
  let xml = setCells(sheetXml, values);
  xml = setFormulaResult(xml, "C3", rows.reduce((s, r) => s + r.amount, 0));
  xml = setFormulaResult(xml, "C4", rows.reduce((s, r) => s + r.reimbursed, 0));
  return xml;
}

/** 開いたときに数式を計算し直させる */
export function forceRecalc(workbookXml: string): string {
  return workbookXml.replace(/<calcPr([^>]*?)\/>/, (all, attrs: string) =>
    attrs.includes("fullCalcOnLoad") ? all : `<calcPr${attrs} fullCalcOnLoad="1"/>`,
  );
}

/** テンプレート（xlsx）に行を書き込んだファイルの中身 */
export function buildFormXlsx(template: Uint8Array, rows: FormRow[]): Uint8Array {
  const files = unzipSync(template);
  const sheet = files[FORM_SHEET];
  const workbook = files[WORKBOOK];
  if (!sheet || !workbook) throw new Error("集計フォームのテンプレートを読み込めませんでした");
  files[FORM_SHEET] = strToU8(fillFormSheet(strFromU8(sheet), rows));
  files[WORKBOOK] = strToU8(forceRecalc(strFromU8(workbook)));
  return zipSync(files, { level: 6 });
}

const CSV_HEADERS = [
  "支払日",
  "医療を受けた人",
  "支払先",
  "区分",
  "支払額",
  "補填額（記録ごと）",
  "健保給付の配分",
  "補填額合計",
  "調整後",
  "メモ",
  "領収書の枚数",
];

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** 控え用の CSV（Excel で文字化けしないよう BOM 付き UTF-8、改行は CRLF） */
export function buildCsv(records: MedicalRecord[], allocation: Allocation): string {
  const lines = records
    .filter(isFinal)
    .sort(byDate)
    .map((r) => {
      const allocated = allocation.byRecord.get(r.id) ?? 0;
      const reimbursed = r.reimbursed + allocated;
      return [r.date, r.personName, r.payee, r.category, r.amount, r.reimbursed, allocated, reimbursed, r.amount - reimbursed, r.memo, r.receiptFileIds.length];
    });
  return `\uFEFF${[CSV_HEADERS, ...lines].map((l) => l.map(csvField).join(",")).join("\r\n")}\r\n`;
}

/** 出力ファイル名の日時部分（20261030-1530） */
export function fileTimestamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
