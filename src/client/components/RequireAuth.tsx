import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { buttonClass, ErrorText, Loading, Page } from "./Layout";

export function RequireAuth({ admin = false, children }: { admin?: boolean; children: ReactNode }) {
  const { status, user, message, retry } = useAuth();
  if (status === "loading") return <Loading />;
  if (status === "error") {
    return (
      <Page>
        <ErrorText>サーバーに接続できませんでした。{message}</ErrorText>
        <button type="button" className={buttonClass} onClick={retry}>
          再試行
        </button>
      </Page>
    );
  }
  if (status === "signedOut" || !user) return <Navigate to="/login" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
