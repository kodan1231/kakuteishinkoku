import { FOLDER_MIME, GoogleApiError, SPREADSHEET_MIME, type DriveFile, type GoogleClient } from "./google";
import type { LedgerCache } from "./ledgerCache";
import {
  APP_ID,
  buildLedgerRequests,
  checkHeader,
  familyRow,
  ledgerName,
  MEDICAL_HEADERS,
  parseFamily,
  pickFamilySourceYear,
  ROOT_FOLDER_NAME,
  SHEET,
  sheetRange,
  type FamilyMember,
  type FamilyRow,
} from "./ledger";

/**
 * ドライブ上のフォルダ・台帳の検索と作成、家族シートの読み書き。
 * ファイルは名前ではなく作成時に付けた appProperties で探すため、名前の変更や移動に影響されない。
 */

export interface Ledger {
  year: number;
  spreadsheetId: string;
  yearFolderId: string;
  rootFolderId: string;
}

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

/** 家族と、台帳の構成の問題（見出しの変更・id の重複）を読み取る */
export async function loadLedgerData(
  c: GoogleClient,
  spreadsheetId: string,
): Promise<{ members: FamilyRow[]; problems: string[] }> {
  let family: unknown[][];
  let medicalHeader: unknown[][];
  try {
    [family, medicalHeader] = await c.batchGetValues(spreadsheetId, [
      sheetRange(SHEET.family, "A1:E"),
      sheetRange(SHEET.medical, "A1:N1"),
    ]);
  } catch (e) {
    // シート名が変えられた・消されたときは範囲を解釈できず 400 になる
    if (e instanceof GoogleApiError && e.status === 400) {
      throw new Error(`台帳のシート（${SHEET.medical}・${SHEET.family}）が見つかりません。シート名を元に戻してください`);
    }
    throw e;
  }
  const { members, problems } = parseFamily(family);
  const medicalProblem = checkHeader(SHEET.medical, medicalHeader[0] ?? [], MEDICAL_HEADERS);
  return { members, problems: medicalProblem ? [...problems, medicalProblem] : problems };
}

export async function addFamilyMember(c: GoogleClient, spreadsheetId: string, m: FamilyMember): Promise<void> {
  await c.appendValues(spreadsheetId, sheetRange(SHEET.family, "A:E"), [familyRow(m)]);
}

export async function updateFamilyMember(c: GoogleClient, spreadsheetId: string, m: FamilyMember): Promise<void> {
  const row = (await familyRowFinder(c, spreadsheetId))(m.id);
  await c.updateValues(spreadsheetId, [{ range: sheetRange(SHEET.family, `A${row}:D${row}`), values: [familyRow(m).slice(0, 4)] }]);
}

export async function deleteFamilyMember(c: GoogleClient, spreadsheetId: string, id: string): Promise<void> {
  const row = (await familyRowFinder(c, spreadsheetId))(id);
  await c.updateValues(spreadsheetId, [{ range: sheetRange(SHEET.family, `E${row}`), values: [[true]] }]);
}

/** 渡した順に並び順を 1, 2, 3… と振り直す */
export async function reorderFamily(c: GoogleClient, spreadsheetId: string, orderedIds: string[]): Promise<void> {
  const rowOf = await familyRowFinder(c, spreadsheetId);
  await c.updateValues(
    spreadsheetId,
    orderedIds.map((id, i) => ({ range: sheetRange(SHEET.family, `D${rowOf(id)}`), values: [[i + 1]] })),
  );
}

/** 書き込みの直前に id から行番号を引き直す（手で行を並べ替えられても正しい行に書くため） */
async function familyRowFinder(c: GoogleClient, spreadsheetId: string): Promise<(id: string) => number> {
  const [values] = await c.batchGetValues(spreadsheetId, [sheetRange(SHEET.family, "A:A")]);
  const rows = new Map<string, number>();
  values.forEach((r, i) => {
    const id = String(r[0] ?? "").trim();
    if (i > 0 && id && !rows.has(id)) rows.set(id, i + 1);
  });
  return (id) => {
    const row = rows.get(id);
    if (!row) throw new Error("家族が台帳に見つかりません。画面を再読み込みしてください");
    return row;
  };
}
