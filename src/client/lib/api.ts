import { useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { requestJson } from "./http";

/** ログイン中ユーザーの ID トークンを付けて Worker の API を呼ぶ */
export function useApi() {
  const { getIdToken } = useAuth();
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${await getIdToken()}`);
      return requestJson<T>(path, { ...init, headers });
    },
    [getIdToken],
  );
}
