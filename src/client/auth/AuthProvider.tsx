import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  GOOGLE_SCOPES,
  type AppConfig,
  type AppUser,
  type TokenExchangeRequest,
  type TokenResponse,
} from "../../shared/auth";
import { HttpError, requestJson } from "../lib/http";
import { codeChallenge, randomString } from "./pkce";
import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from "./tokenStore";

/**
 * ログイン状態の管理。
 * - アクセストークン・ID トークンはメモリのみに保持
 * - 更新用トークンは端末の IndexedDB に暗号化して保存し、起動時・画面復帰時・期限前に自動更新する
 */

type Status = "loading" | "signedOut" | "signedIn" | "error";

interface Tokens {
  accessToken: string;
  idToken: string;
  expiresAt: number;
}

interface AuthContextValue {
  status: Status;
  user: AppUser | null;
  /** ログイン画面に表示するメッセージ（利用停止・失効など） */
  message: string | null;
  login: (inviteToken?: string) => Promise<void>;
  completeLogin: (code: string, state: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
  getIdToken: () => Promise<string>;
  getAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PENDING_LOGIN_KEY = "auth.pendingLogin";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

interface PendingLogin {
  state: string;
  codeVerifier: string;
  inviteToken?: string;
}

export function redirectUri(): string {
  return `${location.origin}/auth/callback`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AppUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const tokens = useRef<Tokens | null>(null);
  const refreshing = useRef<Promise<Tokens | null> | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const signOutLocally = useCallback(async (msg: string | null) => {
    window.clearTimeout(timer.current);
    tokens.current = null;
    await clearRefreshToken();
    setUser(null);
    setMessage(msg);
    setStatus("signedOut");
  }, []);

  const refresh = useCallback((): Promise<Tokens | null> => {
    refreshing.current ??= (async () => {
      try {
        const refreshToken = await loadRefreshToken();
        if (!refreshToken) {
          await signOutLocally(null);
          return null;
        }
        const res = await requestJson<TokenResponse>("/api/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        });
        if (res.refreshToken) await saveRefreshToken(res.refreshToken);
        return accept(res);
      } catch (e) {
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
          await signOutLocally(e.status === 401 ? "ログインの有効期限が切れました。もう一度ログインしてください" : e.message);
          return null;
        }
        // 通信エラー等。更新用トークンは残して再試行できるようにする
        setMessage(e instanceof Error ? e.message : String(e));
        setStatus((s) => (s === "signedIn" ? s : "error"));
        return null;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [signOutLocally]);

  // state の setter と ref しか触らないため、どのレンダーの accept を呼んでも同じ結果になる
  function accept(res: TokenResponse): Tokens {
    const t = { accessToken: res.accessToken, idToken: res.idToken, expiresAt: res.expiresAt };
    tokens.current = t;
    setUser(res.user);
    setMessage(null);
    setStatus("signedIn");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refresh(), Math.max(t.expiresAt - REFRESH_MARGIN_MS - Date.now(), 0));
    return t;
  }

  // 起動時に自動ログイン（コールバック画面では completeLogin に任せる）
  useEffect(() => {
    if (location.pathname !== "/auth/callback") void refresh();
    return () => window.clearTimeout(timer.current);
  }, [refresh]);

  // 画面復帰時（スリープ中はタイマーが止まるため）に期限が近ければ更新
  useEffect(() => {
    const onVisible = () => {
      const t = tokens.current;
      if (document.visibilityState === "visible" && t && t.expiresAt - REFRESH_MARGIN_MS < Date.now()) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const validTokens = useCallback(async (): Promise<Tokens> => {
    const t = tokens.current;
    if (t && t.expiresAt - 60_000 > Date.now()) return t;
    const fresh = await refresh();
    if (!fresh) throw new Error("ログインが必要です");
    return fresh;
  }, [refresh]);

  const login = useCallback(async (inviteToken?: string) => {
    const config = await requestJson<AppConfig>("/api/config");
    const pending: PendingLogin = { state: randomString(), codeVerifier: randomString(48), inviteToken };
    sessionStorage.setItem(PENDING_LOGIN_KEY, JSON.stringify(pending));
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      state: pending.state,
      code_challenge: await codeChallenge(pending.codeVerifier),
      code_challenge_method: "S256",
      access_type: "offline",
      // 更新用トークンを確実に受け取るため、毎回同意画面を出す（ログインは初回や失効時のみ）
      prompt: "consent select_account",
    });
    location.assign(`${GOOGLE_AUTH_URL}?${params}`);
  }, []);

  const completeLogin = useCallback(
    async (code: string, state: string) => {
      const raw = sessionStorage.getItem(PENDING_LOGIN_KEY);
      sessionStorage.removeItem(PENDING_LOGIN_KEY);
      const pending = raw ? (JSON.parse(raw) as PendingLogin) : null;
      if (!pending || pending.state !== state) {
        await signOutLocally("ログイン処理が不正です。もう一度お試しください");
        return;
      }
      try {
        const body: TokenExchangeRequest = {
          code,
          codeVerifier: pending.codeVerifier,
          redirectUri: redirectUri(),
          inviteToken: pending.inviteToken,
        };
        const res = await requestJson<TokenResponse>("/api/auth/token", { method: "POST", body: JSON.stringify(body) });
        if (!res.refreshToken) throw new Error("Google から更新用トークンを取得できませんでした");
        await saveRefreshToken(res.refreshToken);
        accept(res);
      } catch (e) {
        await signOutLocally(e instanceof Error ? e.message : String(e));
      }
    },
    [signOutLocally],
  );

  const logout = useCallback(async () => {
    const refreshToken = await loadRefreshToken();
    if (refreshToken) {
      await requestJson("/api/auth/revoke", { method: "POST", body: JSON.stringify({ token: refreshToken }) }).catch(
        () => undefined,
      );
    }
    await signOutLocally(null);
  }, [signOutLocally]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      message,
      login,
      completeLogin,
      logout,
      retry: () => {
        setStatus("loading");
        void refresh();
      },
      getIdToken: async () => (await validTokens()).idToken,
      getAccessToken: async () => (await validTokens()).accessToken,
    }),
    [status, user, message, login, completeLogin, logout, refresh, validTokens],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider の外では使えません");
  return ctx;
}
