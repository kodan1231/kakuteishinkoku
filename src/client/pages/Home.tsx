import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { NoticeText, Page, WarningText } from "../components/Layout";
import { useReadyLedger } from "../drive/LedgerProvider";

export function Home() {
  const { user } = useAuth();
  const { year, family, warnings, problems, notice } = useReadyLedger();
  return (
    <Page title="確定申告サポート">
      <p className="text-sm text-gray-600">{user?.displayName ?? user?.email} さん、ログイン中です。</p>
      {notice && <NoticeText>{notice}</NoticeText>}
      {[...warnings, ...problems].map((w) => (
        <WarningText key={w}>{w}</WarningText>
      ))}
      <p className="text-lg font-bold">{year}年分</p>
      <p className="text-sm text-gray-600">家族 {family.length}人・記録機能は準備中です。</p>
      <nav className="flex flex-col gap-2">
        <Link to="/settings/family" className="text-teal-700 underline">
          家族設定
        </Link>
        <Link to="/settings" className="text-teal-700 underline">
          設定（年度の切り替え・ログアウト）
        </Link>
        {user?.role === "admin" && (
          <Link to="/admin" className="text-teal-700 underline">
            管理（招待・ユーザー）
          </Link>
        )}
      </nav>
    </Page>
  );
}
