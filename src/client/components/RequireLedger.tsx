import { Navigate, Outlet } from "react-router";
import { useLedger } from "../drive/LedgerProvider";
import { buttonClass, ErrorText, Loading, Page } from "./Layout";

/** 台帳の準備ができるまで子の画面を出さない。初回設定が済んでいなければ /setup へ */
export function RequireLedger() {
  const { state, reload } = useLedger();
  if (state.status === "loading") return <Loading label="ドライブを確認しています…" />;
  if (state.status === "needsSetup") return <Navigate to="/setup" replace />;
  if (state.status === "error") {
    return (
      <Page>
        <ErrorText>ドライブの台帳を開けませんでした。{state.message}</ErrorText>
        <button type="button" className={buttonClass} onClick={reload}>
          再試行
        </button>
      </Page>
    );
  }
  return <Outlet />;
}
