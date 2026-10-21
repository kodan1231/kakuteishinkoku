import { useEffect } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { Loading } from "../components/Layout";

// 認可コードは1回しか使えないため、開発時の StrictMode による二重実行を防ぐ
const handledCodes = new Set<string>();

export function AuthCallback() {
  const { status, completeLogin } = useAuth();
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");

  useEffect(() => {
    if (!code || !state || handledCodes.has(code)) return;
    handledCodes.add(code);
    void completeLogin(code, state);
  }, [code, state, completeLogin]);

  if (!code || !state) return <Navigate to="/login" replace />;
  if (status === "signedIn") return <Navigate to="/" replace />;
  if (status === "signedOut") return <Navigate to="/login" replace />;
  return <Loading label="ログイン中…" />;
}
