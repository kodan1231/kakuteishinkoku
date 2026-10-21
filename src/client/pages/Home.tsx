import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { buttonClass, NoticeText, Page, WarningText } from "../components/Layout";
import { useReadyLedger } from "../drive/LedgerProvider";
import { formatYen } from "../lib/format";

export function Home() {
  const { user } = useAuth();
  const { year, records, warnings, problems, notice } = useReadyLedger();
  const total = records.reduce((sum, r) => sum + r.amount, 0);
  const reimbursed = records.reduce((sum, r) => sum + r.reimbursed, 0);
  return (
    <Page title="確定申告サポート">
      <p className="text-sm text-gray-600">{user?.displayName ?? user?.email} さん、ログイン中です。</p>
      {notice && <NoticeText>{notice}</NoticeText>}
      {[...warnings, ...problems].map((w) => (
        <WarningText key={w}>{w}</WarningText>
      ))}

      <section className="space-y-1 rounded border p-3">
        <div className="text-sm text-gray-600">{year}年分の医療費</div>
        <div className="text-2xl font-bold">{formatYen(total)}</div>
        <div className="text-sm text-gray-600">
          {records.length}件{reimbursed > 0 && `・うち補填 ${formatYen(reimbursed)}`}
        </div>
      </section>

      <Link to="/records/new" className={`${buttonClass} block text-center`}>
        記録する
      </Link>
      <nav className="flex flex-col gap-2">
        <Link to="/records" className="text-teal-700 underline">
          記録一覧
        </Link>
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
