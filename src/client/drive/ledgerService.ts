import { FOLDER_MIME, GoogleApiError, SPREADSHEET_MIME, type DriveFile, type GoogleClient } from "./google";
import type { LedgerCache } from "./ledgerCache";
import {
  APP_ID,
  buildLedgerRequests,
  familyRow,
  ledgerName,
  parseFamily,
  pickFamilySourceYear,
  ROOT_FOLDER_NAME,
  buildAddReimbursementSheetRequests,
  MEDICAL_HEADERS,
  MEDICAL_LAST_COLUMN,
  readSchemaVersion,
  REIMBURSEMENT_LAST_COLUMN,
  SHEET,
  sheetRange,
  type FamilyMember,
  type FamilyRow,
} from "./ledger";
import { medicalRow, parseMedical, receiptFileName, type MedicalRecord } from "./records";
import { parseReimbursements, reimbursementRow, type MonthlyReimbursement } from "./reimbursements";
import { emptyCorrections, parseCorrections, type OcrCorrectionsData } from "./ocrCorrections";

/**
 * ドライブ上のフォルダ・台帳の検索と作成、家族・医療費シートの読み書き、領収書ファイルの保存。
 * ファイルは名前ではなく作成時に付けた appProperties で探すため、名前の変更や移動に影響されない。
 */

export interface Ledger {
  year: number;
  spreadsheetId: string;
  yearFolderId: string;
  rootFolderId: string;
}

const RECEIPT_FOLDER_NAME = "領収書";

export interface OpenedLedger {
  ledger: Ledger;
  warnings: string[];
  /** 新しい年度の台帳を自動作成したときのお知らせ */
  notice: string | null;
}

export interface Root {
  id: string;
  consentedAt?: string;
}

export async function findRoot(c: GoogleClient, cache: LedgerCache): Promise<Root | null> {
  const cached = cache.load().root;
  if (cached && (await c.isAlive(cached.id))) return cached;
  const file = (await c.findFiles({ app: APP_ID, type: "root" }))[0];
  const root = file ? { id: file.id, consentedAt: file.appProperties?.consentedAt } : undefined;
  cache.setRoot(root);
  return root ?? null;
}

export async function createRoot(c: GoogleClient, cache: LedgerCache, consentedAt: string): Promise<Root> {
  const file = await c.createFile({
    name: ROOT_FOLDER_NAME,
    mimeType: FOLDER_MIME,
    appProperties: { app: APP_ID, type: "root", consentedAt },
  });
  const root = { id: file.id, consentedAt };
  cache.setRoot(root);
  return root;
}

function findLedgers(c: GoogleClient, year?: number): Promise<DriveFile[]> {
  return c.findFiles({ app: APP_ID, type: "ledger", ...(year === undefined ? {} : { year: String(year) }) });
}

async function ensureYearFolder(c: GoogleClient, rootId: string, year: number): Promise<DriveFile> {
  const props = { app: APP_ID, type: "yearFolder", year: String(year) };
  return (await c.findFiles(props))[0] ?? c.createFile({ name: String(year), mimeType: FOLDER_MIME, parents: [rootId], appProperties: props });
}

export async function createLedger(
  c: GoogleClient,
  cache: LedgerCache,
  root: Root,
  year: number,
  family: FamilyMember[],
): Promise<Ledger> {
  const consentedAt = root.consentedAt ?? new Date().toISOString();
  const folder = await ensureYearFolder(c, root.id, year);
  const file = await c.createFile({
    name: ledgerName(year),
    mimeType: SPREADSHEET_MIME,
    parents: [folder.id],
    appProperties: { app: APP_ID, type: "ledger", year: String(year) },
  });
  try {
    const defaultSheetIds = await c.getSheetIds(file.id);
    await c.batchUpdate(file.id, buildLedgerRequests(defaultSheetIds, { year, family, createdAt: new Date().toISOString(), consentedAt }));
  } catch (e) {
    // 作りかけの台帳が見つかって使われないよう、ゴミ箱に移しておく
    await c.trashFile(file.id).catch(() => undefined);
    throw e;
  }
  const ledger = { year, spreadsheetId: file.id, yearFolderId: folder.id, rootFolderId: root.id };
  cache.setLedger(year, ledger);
  return ledger;
}

/**
 * その年度の台帳を開く。無ければ他の年度の家族をコピーして作成する。
 * どの年度の台帳も無い（初回設定が済んでいない）場合は null。
 */
export async function openLedger(
  c: GoogleClient,
  cache: LedgerCache,
  root: Root,
  year: number,
): Promise<OpenedLedger | null> {
  const cached = cache.load().ledgers[year];
  if (cached && (await c.isAlive(cached.spreadsheetId))) {
    return { ledger: { year, rootFolderId: root.id, ...cached }, warnings: [], notice: null };
  }

  const found = await findLedgers(c, year);
  const file = found[0];
  if (file) {
    const ledger = { year, spreadsheetId: file.id, yearFolderId: file.parents?.[0] ?? root.id, rootFolderId: root.id };
    cache.setLedger(year, ledger);
    const warnings =
      found.length > 1 ? [`${year}年分の台帳が${found.length}個あります。最初に作成されたものを使っています`] : [];
    return { ledger, warnings, notice: null };
  }
  cache.setLedger(year, undefined);

  const all = await findLedgers(c);
  const sourceYear = pickFamilySourceYear(all.map((f) => Number(f.appProperties?.year)), year);
  const source = all.find((f) => Number(f.appProperties?.year) === sourceYear);
  if (!source) return null;
  const { members } = await loadLedgerData(c, source.id);
  const ledger = await createLedger(c, cache, root, year, members.map(stripRow));
  return { ledger, warnings: [], notice: `${year}年分の台帳を作成しました（家族は${sourceYear}年分からコピーしました）` };
}

function stripRow({ row: _row, ...m }: FamilyRow): FamilyMember {
  return m;
}

export interface LedgerData {
  members: FamilyRow[];
  records: MedicalRecord[];
  reimbursements: MonthlyReimbursement[];
  problems: string[];
}

/** 家族・医療費の記録・月ごとの補填と、台帳の構成の問題（見出しの変更・id の重複）を読み取る */
export async function loadLedgerData(c: GoogleClient, spreadsheetId: string): Promise<LedgerData> {
  let family: unknown[][];
  let medical: unknown[][];
  let meta: unknown[][];
  try {
    [family, medical, meta] = await c.batchGetValues(spreadsheetId, [
      sheetRange(SHEET.family, "A1:E"),
      sheetRange(SHEET.medical, `A1:${MEDICAL_LAST_COLUMN}`),
      sheetRange(SHEET.meta, "A1:B"),
    ]);
  } catch (e) {
    // シート名が変えられた・消されたときは範囲を解釈できず 400 になる
    if (e instanceof GoogleApiError && e.status === 400) {
      throw new Error(`台帳のシート（${SHEET.medical}・${SHEET.family}・${SHEET.meta}）が見つかりません。シート名を元に戻してください`);
    }
    throw e;
  }
  const schema = readSchemaVersion(meta);
  if (schema && schema.version < 2) {
    await migrateToV2(c, spreadsheetId, schema.row);
    medical[0] = MEDICAL_HEADERS;
  }
  if (schema && schema.version < 3) await migrateToV3(c, spreadsheetId, schema.row);
  // 補填シートは版3で追加したため、移行の後に読む
  const [reimbursement] = await c.batchGetValues(spreadsheetId, [
    sheetRange(SHEET.reimbursement, `A1:${REIMBURSEMENT_LAST_COLUMN}`),
  ]).catch((e: unknown) => {
    if (e instanceof GoogleApiError && e.status === 400) {
      throw new Error(`台帳のシート（${SHEET.reimbursement}）が見つかりません。シート名を元に戻してください`);
    }
    throw e;
  });
  const f = parseFamily(family);
  const m = parseMedical(medical);
  const r = parseReimbursements(reimbursement);
  return {
    members: f.members,
    records: m.records,
    reimbursements: r.entries,
    problems: [...f.problems, ...m.problems, ...r.problems],
  };
}

/** 版1 → 2: 医療費シートに「状態」列の見出しを追加する（既存の行は空欄＝確定のまま） */
async function migrateToV2(c: GoogleClient, spreadsheetId: string, versionRow: number): Promise<void> {
  await c.updateValues(spreadsheetId, [
    { range: sheetRange(SHEET.medical, `${MEDICAL_LAST_COLUMN}1`), values: [[MEDICAL_HEADERS[MEDICAL_HEADERS.length - 1]]] },
    { range: sheetRange(SHEET.meta, `B${versionRow}`), values: [[2]] },
  ]);
}

/** 版2 → 3: 「補填」シートを追加する */
async function migrateToV3(c: GoogleClient, spreadsheetId: string, versionRow: number): Promise<void> {
  try {
    await c.batchUpdate(spreadsheetId, buildAddReimbursementSheetRequests());
  } catch (e) {
    // 別の端末が先に移行していればシートは既にある
    if (!(e instanceof GoogleApiError && e.status === 400)) throw e;
  }
  await c.updateValues(spreadsheetId, [{ range: sheetRange(SHEET.meta, `B${versionRow}`), values: [[3]] }]);
}

export async function saveReimbursement(c: GoogleClient, spreadsheetId: string, r: MonthlyReimbursement, isNew: boolean): Promise<void> {
  if (isNew) {
    await c.appendValues(spreadsheetId, sheetRange(SHEET.reimbursement, `A:${REIMBURSEMENT_LAST_COLUMN}`), [reimbursementRow(r)]);
    return;
  }
  const row = (await rowFinder(c, spreadsheetId, SHEET.reimbursement))(r.id);
  await c.updateValues(spreadsheetId, [
    { range: sheetRange(SHEET.reimbursement, `A${row}:${REIMBURSEMENT_LAST_COLUMN}${row}`), values: [reimbursementRow(r)] },
  ]);
}

export async function deleteReimbursement(c: GoogleClient, spreadsheetId: string, id: string): Promise<void> {
  const row = (await rowFinder(c, spreadsheetId, SHEET.reimbursement))(id);
  await c.updateValues(spreadsheetId, [{ range: sheetRange(SHEET.reimbursement, `I${row}`), values: [[true]] }]);
}

export async function addFamilyMember(c: GoogleClient, spreadsheetId: string, m: FamilyMember): Promise<void> {
  await c.appendValues(spreadsheetId, sheetRange(SHEET.family, "A:E"), [familyRow(m)]);
}

export async function updateFamilyMember(c: GoogleClient, spreadsheetId: string, m: FamilyMember): Promise<void> {
  const row = (await rowFinder(c, spreadsheetId, SHEET.family))(m.id);
  await c.updateValues(spreadsheetId, [{ range: sheetRange(SHEET.family, `A${row}:D${row}`), values: [familyRow(m).slice(0, 4)] }]);
}

export async function deleteFamilyMember(c: GoogleClient, spreadsheetId: string, id: string): Promise<void> {
  const row = (await rowFinder(c, spreadsheetId, SHEET.family))(id);
  await c.updateValues(spreadsheetId, [{ range: sheetRange(SHEET.family, `E${row}`), values: [[true]] }]);
}

/** 渡した順に並び順を 1, 2, 3… と振り直す */
export async function reorderFamily(c: GoogleClient, spreadsheetId: string, orderedIds: string[]): Promise<void> {
  const rowOf = await rowFinder(c, spreadsheetId, SHEET.family);
  await c.updateValues(
    spreadsheetId,
    orderedIds.map((id, i) => ({ range: sheetRange(SHEET.family, `D${rowOf(id)}`), values: [[i + 1]] })),
  );
}

/** 複数の記録（診療と交通費など）を1回の書き込みで追加する */
export async function addRecords(c: GoogleClient, spreadsheetId: string, records: MedicalRecord[]): Promise<void> {
  await c.appendValues(spreadsheetId, sheetRange(SHEET.medical, `A:${MEDICAL_LAST_COLUMN}`), records.map(medicalRow));
}

export async function updateRecord(c: GoogleClient, spreadsheetId: string, r: MedicalRecord): Promise<void> {
  const row = (await rowFinder(c, spreadsheetId, SHEET.medical))(r.id);
  await c.updateValues(spreadsheetId, [
    { range: sheetRange(SHEET.medical, `A${row}:${MEDICAL_LAST_COLUMN}${row}`), values: [medicalRow(r)] },
  ]);
}

export async function deleteRecord(c: GoogleClient, spreadsheetId: string, id: string): Promise<void> {
  const row = (await rowFinder(c, spreadsheetId, SHEET.medical))(id);
  await c.updateValues(spreadsheetId, [{ range: sheetRange(SHEET.medical, `N${row}`), values: [[true]] }]);
}

/** 書き込みの直前に id から行番号を引き直す（手で行を並べ替えられても正しい行に書くため） */
async function rowFinder(c: GoogleClient, spreadsheetId: string, sheet: string): Promise<(id: string) => number> {
  const [values] = await c.batchGetValues(spreadsheetId, [sheetRange(sheet, "A:A")]);
  const rows = new Map<string, number>();
  values.forEach((r, i) => {
    const id = String(r[0] ?? "").trim();
    if (i > 0 && id && !rows.has(id)) rows.set(id, i + 1);
  });
  return (id) => {
    const row = rows.get(id);
    if (!row) throw new Error(`シート「${sheet}」に対象の行が見つかりません。画面を再読み込みしてください`);
    return row;
  };
}

/** 年度フォルダ内の「領収書」フォルダ。ID は端末にキャッシュする */
async function ensureReceiptFolder(c: GoogleClient, cache: LedgerCache, ledger: Ledger): Promise<string> {
  const cached = cache.load().ledgers[ledger.year];
  if (cached?.receiptFolderId && (await c.isAlive(cached.receiptFolderId))) return cached.receiptFolderId;
  const props = { app: APP_ID, type: "receiptFolder", year: String(ledger.year) };
  const folder =
    (await c.findFiles(props))[0] ??
    (await c.createFile({ name: RECEIPT_FOLDER_NAME, mimeType: FOLDER_MIME, parents: [ledger.yearFolderId], appProperties: props }));
  cache.setLedger(ledger.year, { ...ledger, receiptFolderId: folder.id });
  return folder.id;
}

export interface ReceiptContent {
  blob: Blob;
  mimeType: string;
}

/** 領収書をアップロードし、ファイル ID を返す。index は記録内での通し番号の開始値 */
export async function uploadReceipts(
  c: GoogleClient,
  cache: LedgerCache,
  ledger: Ledger,
  record: Pick<MedicalRecord, "id" | "date" | "payee" | "amount">,
  contents: ReceiptContent[],
  startIndex: number,
): Promise<string[]> {
  if (contents.length === 0) return [];
  const folderId = await ensureReceiptFolder(c, cache, ledger);
  const ids: string[] = [];
  try {
    for (const [i, content] of contents.entries()) {
      const file = await c.uploadFile(
        {
          name: receiptFileName(record, startIndex + i, content.mimeType),
          mimeType: content.mimeType,
          parents: [folderId],
          appProperties: { app: APP_ID, type: "receipt", recordId: record.id },
        },
        content.blob,
      );
      ids.push(file.id);
    }
  } catch (e) {
    await trashFiles(c, ids);
    throw e;
  }
  return ids;
}

/** 記録の内容に合わせて領収書のファイル名を付け直す */
export async function renameReceipts(
  c: GoogleClient,
  record: Pick<MedicalRecord, "id" | "date" | "payee" | "amount" | "receiptFileIds">,
): Promise<void> {
  await Promise.all(
    record.receiptFileIds.map(async (id, i) => {
      const meta = await c.getFileMeta(id);
      const name = receiptFileName(record, i, meta.mimeType);
      if (meta.name !== name) await c.renameFile(id, name);
    }),
  );
}

const CORRECTIONS_FILE_NAME = "OCR修正記録.json";
const CORRECTIONS_CACHE_KEY = "ocrCorrections";

/** OCR の修正記録（ルートフォルダの JSON ファイル。年度をまたいで使う）。無ければ空 */
export async function loadOcrCorrections(c: GoogleClient, cache: LedgerCache): Promise<OcrCorrectionsData> {
  const id = await findCorrectionsFile(c, cache);
  if (!id) return emptyCorrections();
  return parseCorrections(await (await c.downloadFile(id)).text());
}

export async function saveOcrCorrections(
  c: GoogleClient,
  cache: LedgerCache,
  rootId: string,
  data: OcrCorrectionsData,
): Promise<void> {
  const content = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const id = await findCorrectionsFile(c, cache);
  if (id) {
    await c.updateFileContent(id, content, "application/json");
    return;
  }
  const file = await c.uploadFile(
    {
      name: CORRECTIONS_FILE_NAME,
      mimeType: "application/json",
      parents: [rootId],
      appProperties: { app: APP_ID, type: "ocrCorrections" },
    },
    content,
  );
  cache.setFile(CORRECTIONS_CACHE_KEY, file.id);
}

async function findCorrectionsFile(c: GoogleClient, cache: LedgerCache): Promise<string | null> {
  const cached = cache.getFile(CORRECTIONS_CACHE_KEY);
  if (cached && (await c.isAlive(cached))) return cached;
  const file = (await c.findFiles({ app: APP_ID, type: "ocrCorrections" }))[0];
  cache.setFile(CORRECTIONS_CACHE_KEY, file?.id);
  return file?.id ?? null;
}

/** ゴミ箱へ移す（失敗しても記録の保存は終わっているため無視する） */
export async function trashFiles(c: GoogleClient, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => c.trashFile(id).catch(() => undefined)));
}
