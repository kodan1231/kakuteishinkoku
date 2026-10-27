import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { resizeToBlob } from "../lib/image";
import { loadString, saveString } from "../lib/storage";
import { defaultTaxYear } from "../lib/taxYear";
import { GoogleClient } from "./google";
import type { FamilyMember } from "./ledger";
import { LedgerCache } from "./ledgerCache";
import {
  addFamilyMember,
  addRecords,
  createLedger,
  createRoot,
  deleteFamilyMember,
  deleteRecord,
  deleteReimbursement,
  findRoot,
  loadLedgerData,
  loadOcrCorrections,
  saveOcrCorrections,
  openLedger,
  renameReceipts,
  reorderFamily,
  saveReimbursement,
  trashFiles,
  updateFamilyMember,
  updateRecord,
  uploadReceipts,
  type Ledger,
  type ReceiptContent,
} from "./ledgerService";
import {
  parseAmount,
  PDF_MAX_BYTES,
  TRANSPORT_CATEGORY,
  transportAmount,
  transportMemo,
  type MedicalRecord,
  type RecordInput,
  type RecordSource,
  type TransportInput,
} from "./records";
import { allocate, DEFAULT_REIMBURSEMENT_KIND, type Allocation, type MonthlyReimbursement } from "./reimbursements";
import {
  emptyCorrections,
  recordCorrection,
  removeCorrection,
  type OcrCorrection,
  type OcrCorrectionsData,
} from "./ocrCorrections";

/**
 * 選択中の年度の台帳と家族の状態。
 * 初回設定（ドライブ保存への同意）が済むまでは何も作成しない。
 */

export type LedgerState =
  | { status: "loading" }
  | { status: "needsSetup" }
  | {
      status: "ready";
      ledger: Ledger;
      family: FamilyMember[];
      records: MedicalRecord[];
      /** 月ごとの補填（健保給付など） */
      reimbursements: MonthlyReimbursement[];
      /** 同じ年度の台帳が複数あるなど */
      warnings: string[];
      /** 見出しの変更・id の重複など、台帳の中身の問題 */
      problems: string[];
      notice: string | null;
    }
  | { status: "error"; message: string };

type ReadyState = Extract<LedgerState, { status: "ready" }>;

export interface MemberInput {
  id?: string;
  name: string;
  relationship: string;
}

export interface MonthlyReimbursementInput {
  /** 既存の補填の id（新規なら省略） */
  id?: string;
  month: string;
  personId: string;
  amount: number;
  memo: string;
}

export interface SaveRecordOptions {
  /** 編集する記録の id（新規なら省略） */
  id?: string;
  newFiles: File[];
  removedFileIds: string[];
  /** 一緒に記録する通院の交通費（台帳には別の記録として追加する）。一時保存では使わない */
  transport?: TransportInput;
  /** 一時保存（入力途中）として保存する */
  draft?: boolean;
  /** 新規の記録の読取方法（写真から読み取ったら ocr） */
  source?: RecordSource;
}

interface LedgerContextValue {
  state: LedgerState;
  year: number;
  setYear: (year: number) => void;
  reload: () => void;
  /** 同意を受けてフォルダと台帳を作成し、本人を登録する */
  setup: (selfName: string) => Promise<void>;
  saveMember: (m: MemberInput) => Promise<void>;
  deleteMember: (id: string) => Promise<void>;
  moveMember: (id: string, delta: -1 | 1) => Promise<void>;
  saveRecord: (input: RecordInput, opts: SaveRecordOptions) => Promise<void>;
  deleteRecord: (id: string) => Promise<void>;
  /** 領収書ファイルの中身・種類・ファイル名（表示・保存用） */
  loadReceipt: (fileId: string) => Promise<{ blob: Blob; mimeType: string; name: string }>;
  /** 月の補填額を保存する（金額 0 なら削除） */
  saveMonthlyReimbursement: (input: MonthlyReimbursementInput) => Promise<void>;
  /** 月ごとの補填の記録への配分（台帳の準備ができるまでは空） */
  allocation: Allocation;
  /** 写真の読み取りで支払先を手で直した記録 */
  ocrCorrections: OcrCorrection[];
  /** 読み取った支払先と直した支払先の組を記録する（同じなら何もしない） */
  recordOcrCorrection: (read: string, corrected: string) => Promise<void>;
  deleteOcrCorrection: (read: string, corrected: string) => Promise<void>;
}

const RECEIPT_MAX_EDGE = 1600;

/** 写真は縮小して位置情報を除き、PDF はそのまま保存する */
async function prepareReceipt(file: File): Promise<ReceiptContent> {
  if (file.type === "application/pdf") {
    if (file.size > PDF_MAX_BYTES) throw new Error(`${file.name} は10MBを超えているため保存できません`);
    return { blob: file, mimeType: file.type };
  }
  if (file.type.startsWith("image/")) {
    try {
      return { blob: await resizeToBlob(file, RECEIPT_MAX_EDGE), mimeType: "image/jpeg" };
    } catch {
      throw new Error(`${file.name} を画像として読み込めませんでした`);
    }
  }
  throw new Error(`${file.name} は保存できない形式です（写真か PDF を選んでください）`);
}

const LedgerContext = createContext<LedgerContextValue | null>(null);

const YEAR_KEY = "ledger.year";

/** 選んだ年度は、初期表示の年度が変わる（申告期限を過ぎる等）までの間だけ覚えておく */
function loadYear(): number {
  const base = defaultTaxYear(new Date());
  try {
    const saved = JSON.parse(loadString(YEAR_KEY) ?? "null") as { year?: unknown; base?: unknown } | null;
    if (saved && saved.base === base && typeof saved.year === "number") return saved.year;
  } catch {
    // 壊れた値は無視して初期値を使う
  }
  return base;
}

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, user } = useAuth();
  const userId = user?.id ?? "";
  const cache = useMemo(() => new LedgerCache(userId), [userId]);
  // getAccessToken はログイン状態の更新のたびに作り直されるため、ref 経由で呼んでクライアントを使い回す
  const tokenRef = useRef(getAccessToken);
  useEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);
  const client = useMemo(() => new GoogleClient(() => tokenRef.current()), []);

  const [year, setYearState] = useState(loadYear);
  const [state, setState] = useState<LedgerState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  // StrictMode の二重実行などで同じ年度の台帳を2つ作らないよう、実行中の読み込みを共有する
  const inflight = useRef(new Map<number, Promise<LedgerState>>());

  const open = useCallback(
    (y: number): Promise<LedgerState> => {
      let p = inflight.current.get(y);
      if (!p) {
        p = (async (): Promise<LedgerState> => {
          const root = await findRoot(client, cache);
          if (!root) return { status: "needsSetup" };
          const opened = await openLedger(client, cache, root, y);
          if (!opened) return { status: "needsSetup" };
          const data = await loadLedgerData(client, opened.ledger.spreadsheetId);
          return {
            status: "ready",
            ...opened,
            family: data.members,
            records: data.records,
            reimbursements: data.reimbursements,
            problems: data.problems,
          };
        })().finally(() => inflight.current.delete(y));
        inflight.current.set(y, p);
      }
      return p;
    },
    [client, cache],
  );

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    open(year).then(
      (s) => !cancelled && setState(s),
      (e: unknown) => !cancelled && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [open, year, version]);

  const setYear = useCallback((y: number) => {
    saveString(YEAR_KEY, JSON.stringify({ year: y, base: defaultTaxYear(new Date()) }));
    setYearState(y);
  }, []);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const setup = useCallback(
    async (selfName: string) => {
      const consentedAt = new Date().toISOString();
      const root = (await findRoot(client, cache)) ?? (await createRoot(client, cache, consentedAt));
      // 別の端末で先に作られていた場合は、そちらを使う
      if (!(await openLedger(client, cache, root, year))) {
        const self: FamilyMember = { id: crypto.randomUUID(), name: selfName.trim(), relationship: "本人", order: 1 };
        await createLedger(client, cache, root, year, [self]);
      }
      reload();
    },
    [client, cache, year, reload],
  );

  /** 書き込み後に家族・記録を読み直す（読み込み中表示にはしない） */
  const withReady = useCallback(
    async (f: (s: ReadyState) => Promise<void>) => {
      const s = stateRef.current;
      if (s.status !== "ready") throw new Error("台帳の準備ができていません");
      await f(s);
      const data = await loadLedgerData(client, s.ledger.spreadsheetId);
      setState((cur) =>
        cur.status === "ready" && cur.ledger.spreadsheetId === s.ledger.spreadsheetId
          ? {
              ...cur,
              family: data.members,
              records: data.records,
              reimbursements: data.reimbursements,
              problems: data.problems,
            }
          : cur,
      );
    },
    [client],
  );

  const saveMember = useCallback(
    (m: MemberInput) =>
      withReady(async (s) => {
        const id = s.ledger.spreadsheetId;
        const current = s.family.find((f) => f.id === m.id);
        const member = { name: m.name.trim(), relationship: m.relationship };
        if (current) {
          await updateFamilyMember(client, id, { ...current, ...member });
        } else {
          const order = Math.max(0, ...s.family.map((f) => f.order)) + 1;
          await addFamilyMember(client, id, { id: crypto.randomUUID(), order, ...member });
        }
      }),
    [client, withReady],
  );

  const deleteMember = useCallback(
    (id: string) => withReady((s) => deleteFamilyMember(client, s.ledger.spreadsheetId, id)),
    [client, withReady],
  );

  const moveMember = useCallback(
    (id: string, delta: -1 | 1) =>
      withReady(async (s) => {
        const ids = s.family.map((f) => f.id);
        const from = ids.indexOf(id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        await reorderFamily(client, s.ledger.spreadsheetId, ids);
      }),
    [client, withReady],
  );

  const saveRecord = useCallback(
    (input: RecordInput, opts: SaveRecordOptions) =>
      withReady(async (s) => {
        const existing = opts.id ? s.records.find((r) => r.id === opts.id) : undefined;
        if (opts.id && !existing) throw new Error("記録が見つかりません。画面を再読み込みしてください");
        const now = new Date().toISOString();
        const person = s.family.find((f) => f.id === input.personId);
        const base = {
          id: existing?.id ?? crypto.randomUUID(),
          date: input.date,
          personId: input.personId,
          personName: person?.name ?? existing?.personName ?? "",
          payee: input.payee.trim(),
          category: input.category,
          amount: parseAmount(input.amount) ?? 0,
          reimbursed: input.reimbursed.trim() ? (parseAmount(input.reimbursed) ?? 0) : 0,
          memo: input.memo.trim(),
          source: existing?.source ?? opts.source ?? "manual",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          status: opts.draft ? ("draft" as const) : ("final" as const),
        };
        const kept = (existing?.receiptFileIds ?? []).filter((id) => !opts.removedFileIds.includes(id));
        const contents = await Promise.all(opts.newFiles.map(prepareReceipt));
        const uploaded = await uploadReceipts(client, cache, s.ledger, base, contents, kept.length);
        const record: MedicalRecord = { ...base, receiptFileIds: [...kept, ...uploaded] };
        const transport: MedicalRecord | null =
          opts.transport && !opts.draft
            ? {
                ...base,
                id: crypto.randomUUID(),
                payee: opts.transport.carrier.trim(),
                category: TRANSPORT_CATEGORY,
                amount: transportAmount(opts.transport) ?? 0,
                reimbursed: 0,
                memo: transportMemo(opts.transport),
                receiptFileIds: [],
                source: "manual",
              }
            : null;
        try {
          if (existing) await updateRecord(client, s.ledger.spreadsheetId, record);
          // 新規は診療と交通費を1回で書き込み、片方だけ残らないようにする
          else await addRecords(client, s.ledger.spreadsheetId, transport ? [record, transport] : [record]);
        } catch (e) {
          await trashFiles(client, uploaded);
          throw e;
        }
        if (existing && transport) {
          try {
            await addRecords(client, s.ledger.spreadsheetId, [transport]);
          } catch (e) {
            throw new Error(`記録は保存しましたが、交通費を保存できませんでした。${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (existing) {
          await trashFiles(client, opts.removedFileIds);
          const renamed =
            existing.date !== record.date || existing.payee !== record.payee || existing.amount !== record.amount;
          // 名前の付け直しに失敗しても記録は保存済みのため、続行する
          if (renamed || opts.removedFileIds.length > 0) await renameReceipts(client, record).catch(() => undefined);
        }
      }),
    [client, cache, withReady],
  );

  const deleteRecordById = useCallback(
    (id: string) =>
      withReady(async (s) => {
        const record = s.records.find((r) => r.id === id);
        await deleteRecord(client, s.ledger.spreadsheetId, id);
        if (record) await trashFiles(client, record.receiptFileIds);
      }),
    [client, withReady],
  );

  const loadReceipt = useCallback(
    async (fileId: string) => {
      const [meta, blob] = await Promise.all([client.getFileMeta(fileId), client.downloadFile(fileId)]);
      return { blob, mimeType: meta.mimeType, name: meta.name };
    },
    [client],
  );

  const saveMonthlyReimbursement = useCallback(
    (input: MonthlyReimbursementInput) =>
      withReady(async (s) => {
        const id = s.ledger.spreadsheetId;
        const existing = input.id ? s.reimbursements.find((r) => r.id === input.id) : undefined;
        if (input.amount <= 0) {
          if (existing) await deleteReimbursement(client, id, existing.id);
          return;
        }
        const now = new Date().toISOString();
        const entry: MonthlyReimbursement = {
          id: existing?.id ?? crypto.randomUUID(),
          month: input.month,
          personId: input.personId,
          amount: input.amount,
          kind: existing?.kind ?? DEFAULT_REIMBURSEMENT_KIND,
          memo: input.memo.trim(),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await saveReimbursement(client, id, entry, !existing);
      }),
    [client, withReady],
  );

  // OCR の修正記録は台帳とは別のファイル。読めなくても記録の入力には影響しないため、失敗は無視する
  const [corrections, setCorrections] = useState<OcrCorrectionsData>(emptyCorrections);
  const correctionsRef = useRef(corrections);
  correctionsRef.current = corrections;
  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    loadOcrCorrections(client, cache).then(
      (data) => !cancelled && setCorrections(data),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [ready, client, cache]);

  const updateCorrections = useCallback(
    async (next: OcrCorrectionsData) => {
      const s = stateRef.current;
      if (s.status !== "ready" || next === correctionsRef.current) return;
      setCorrections(next);
      await saveOcrCorrections(client, cache, s.ledger.rootFolderId, next);
    },
    [client, cache],
  );

  const recordOcrCorrection = useCallback(
    (read: string, corrected: string) =>
      updateCorrections(recordCorrection(correctionsRef.current, read, corrected, new Date().toISOString())),
    [updateCorrections],
  );

  const deleteOcrCorrection = useCallback(
    (read: string, corrected: string) => updateCorrections(removeCorrection(correctionsRef.current, read, corrected)),
    [updateCorrections],
  );

  const allocation = useMemo(
    () => (state.status === "ready" ? allocate(state.records, state.reimbursements) : allocate([], [])),
    [state],
  );

  const value = useMemo<LedgerContextValue>(
    () => ({
      state,
      year,
      setYear,
      reload,
      setup,
      saveMember,
      deleteMember,
      moveMember,
      saveRecord,
      deleteRecord: deleteRecordById,
      loadReceipt,
      saveMonthlyReimbursement,
      allocation,
      ocrCorrections: corrections.corrections,
      recordOcrCorrection,
      deleteOcrCorrection,
    }),
    [
      corrections,
      recordOcrCorrection,
      deleteOcrCorrection,
      state,
      year,
      setYear,
      reload,
      setup,
      saveMember,
      deleteMember,
      moveMember,
      saveRecord,
      deleteRecordById,
      loadReceipt,
      saveMonthlyReimbursement,
      allocation,
    ],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerContextValue {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("LedgerProvider の外では使えません");
  return ctx;
}

/** 台帳の準備ができている前提の画面で使う */
export function useReadyLedger(): ReadyState & Omit<LedgerContextValue, "state"> {
  const { state, ...rest } = useLedger();
  if (state.status !== "ready") throw new Error("台帳の準備ができていません");
  return { ...state, ...rest };
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}
