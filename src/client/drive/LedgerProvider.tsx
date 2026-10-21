import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { loadString, saveString } from "../lib/storage";
import { defaultTaxYear } from "../lib/taxYear";
import { GoogleClient } from "./google";
import type { FamilyMember } from "./ledger";
import { LedgerCache } from "./ledgerCache";
import {
  addFamilyMember,
  createLedger,
  createRoot,
  deleteFamilyMember,
  findRoot,
  loadLedgerData,
  openLedger,
  reorderFamily,
  updateFamilyMember,
  type Ledger,
} from "./ledgerService";

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
          return { status: "ready", ...opened, family: data.members, problems: data.problems };
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

  /** 書き込み後に家族を読み直す（読み込み中表示にはしない） */
  const withReady = useCallback(
    async (f: (s: ReadyState) => Promise<void>) => {
      const s = stateRef.current;
      if (s.status !== "ready") throw new Error("台帳の準備ができていません");
      await f(s);
      const data = await loadLedgerData(client, s.ledger.spreadsheetId);
      setState((cur) =>
        cur.status === "ready" && cur.ledger.spreadsheetId === s.ledger.spreadsheetId
          ? { ...cur, family: data.members, problems: data.problems }
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

  const value = useMemo<LedgerContextValue>(
    () => ({ state, year, setYear, reload, setup, saveMember, deleteMember, moveMember }),
    [state, year, setYear, reload, setup, saveMember, deleteMember, moveMember],
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
