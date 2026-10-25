import type { CellValue } from "./google";

/** 台帳スプレッドシートの構成（design.md 5.3）。端末内で完結する純粋な処理だけを置く */

export const APP_ID = "kakuteishinkoku";
export const ROOT_FOLDER_NAME = "確定申告サポート";
/** 2: 医療費シートに「状態」列（一時保存）を追加 */
export const LEDGER_SCHEMA_VERSION = 2;

export const SHEET = { medical: "医療費", family: "家族", settings: "設定", meta: "_meta" } as const;
type SheetKey = keyof typeof SHEET;

export const MEDICAL_HEADERS = [
  "id",
  "支払日",
  "対象者ID",
  "対象者名",
  "支払先",
  "区分",
  "支払額",
  "補填額",
  "内容メモ",
  "領収書ファイルID",
  "読取方法",
  "作成日時",
  "更新日時",
  "削除済",
  "状態",
];
/** 医療費シートの最終列（A1 形式） */
export const MEDICAL_LAST_COLUMN = "O";
export const FAMILY_HEADERS = ["id", "氏名", "続柄", "並び順", "削除済"];
const KEY_VALUE_HEADERS = ["key", "value"];

export const RELATIONSHIPS = ["本人", "配偶者", "子", "父母", "その他"] as const;

/** 医療費集計フォームの「医療を受けた人」は全角10文字以内 */
export const NAME_MAX_LENGTH = 10;

export interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
  order: number;
}

export interface FamilyRow extends FamilyMember {
  /** シート上の行番号（1始まり） */
  row: number;
}

export function ledgerName(year: number): string {
  return `台帳_${year}`;
}

/** シート名を含む A1 形式の範囲 */
export function sheetRange(sheet: string, range: string): string {
  return `'${sheet}'!${range}`;
}

export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return "名前を入力してください";
  if ([...n].length > NAME_MAX_LENGTH) return `名前は${NAME_MAX_LENGTH}文字以内で入力してください`;
  return null;
}

export function familyRow(m: FamilyMember): CellValue[] {
  return [m.id, m.name, m.relationship, m.order, false];
}

// 新規スプレッドシートの既定のシート（通常 0）と重ならない ID にする
const SHEET_IDS: Record<SheetKey, number> = { medical: 1001, family: 1002, settings: 1003, meta: 1004 };

export interface LedgerInit {
  year: number;
  family: FamilyMember[];
  createdAt: string;
  consentedAt: string;
}

/** 作成直後の空のスプレッドシートを台帳の形にする batchUpdate のリクエスト */
export function buildLedgerRequests(defaultSheetIds: number[], init: LedgerInit): object[] {
  const sheets: { key: SheetKey; rows: CellValue[][]; hidden?: boolean }[] = [
    { key: "medical", rows: [MEDICAL_HEADERS] },
    { key: "family", rows: [FAMILY_HEADERS, ...init.family.map(familyRow)] },
    { key: "settings", rows: [KEY_VALUE_HEADERS, ["総所得金額等", ""]] },
    {
      key: "meta",
      hidden: true,
      rows: [
        KEY_VALUE_HEADERS,
        ["schema_version", LEDGER_SCHEMA_VERSION],
        ["app", APP_ID],
        ["year", init.year],
        ["created_at", init.createdAt],
        ["consented_at", init.consentedAt],
      ],
    },
  ];
  return [
    ...sheets.map((s, index) => ({
      addSheet: {
        properties: {
          sheetId: SHEET_IDS[s.key],
          title: SHEET[s.key],
          index,
          hidden: s.hidden ?? false,
          gridProperties: { frozenRowCount: 1 },
        },
      },
    })),
    ...defaultSheetIds.map((sheetId) => ({ deleteSheet: { sheetId } })),
    ...sheets.map((s) => ({
      updateCells: {
        start: { sheetId: SHEET_IDS[s.key], rowIndex: 0, columnIndex: 0 },
        rows: s.rows.map((r) => ({ values: r.map(toCellData) })),
        fields: "userEnteredValue",
      },
    })),
    // 手で編集されても止めはせず、警告だけ出す
    ...sheets.map((s) => ({
      addProtectedRange: {
        protectedRange: {
          range: s.hidden
            ? { sheetId: SHEET_IDS[s.key] }
            : { sheetId: SHEET_IDS[s.key], startRowIndex: 0, endRowIndex: 1 },
          description: "確定申告サポートが使用します。編集しないでください",
          warningOnly: true,
        },
      },
    })),
  ];
}

function toCellData(v: CellValue): object {
  if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
  if (typeof v === "boolean") return { userEnteredValue: { boolValue: v } };
  return { userEnteredValue: { stringValue: v } };
}

export function checkHeader(sheet: string, actual: unknown[], expected: string[]): string | null {
  const same = expected.every((h, i) => String(actual[i] ?? "") === h);
  return same ? null : `シート「${sheet}」の見出し行が変更されています。台帳を元に戻してください`;
}

/** 家族シートの値（見出し行を含む）を読み取る。削除済みは除き、並び順に並べる */
export function parseFamily(values: unknown[][]): { members: FamilyRow[]; problems: string[] } {
  const [header = [], ...rows] = values;
  const problems: string[] = [];
  const headerProblem = checkHeader(SHEET.family, header, FAMILY_HEADERS);
  if (headerProblem) problems.push(headerProblem);

  const seen = new Set<string>();
  const members: FamilyRow[] = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    const id = String(r[0] ?? "").trim();
    if (!id) return;
    if (seen.has(id)) {
      problems.push(`シート「${SHEET.family}」の id が重複しています（${row}行目）`);
      return;
    }
    seen.add(id);
    if (r[4] === true || String(r[4]).toUpperCase() === "TRUE") return;
    members.push({ id, name: String(r[1] ?? ""), relationship: String(r[2] ?? ""), order: Number(r[3]) || 0, row });
  });
  members.sort((a, b) => a.order - b.order || a.row - b.row);
  return { members, problems };
}

/** _meta シートの値から台帳の版と、その行番号（1始まり）を読む。見つからなければ null */
export function readSchemaVersion(meta: unknown[][]): { version: number; row: number } | null {
  const i = meta.findIndex((r) => r[0] === "schema_version");
  if (i < 0) return null;
  const version = Number(meta[i][1]);
  return Number.isFinite(version) ? { version, row: i + 1 } : null;
}

/** 新しい年度の家族のコピー元。前年度を優先し、なければ近い年度（同じ近さなら過去の年度） */
export function pickFamilySourceYear(availableYears: number[], year: number): number | null {
  const candidates = availableYears.filter((y) => y !== year);
  if (candidates.length === 0) return null;
  const distance = (y: number) => (y < year ? year - y : y - year + 0.5);
  return candidates.reduce((best, y) => (distance(y) < distance(best) ? y : best));
}
