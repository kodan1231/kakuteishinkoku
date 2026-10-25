import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { OcrUsage } from "../../shared/ocr";
import { useAuth } from "../auth/AuthProvider";
import { NoticeText, Page, WarningText } from "../components/Layout";
import { StartRecord } from "../components/StartRecord";
import { useReadyLedger } from "../drive/LedgerProvider";
import { isFinal } from "../drive/records";
import { formatYen } from "../lib/format";
import { useOcr } from "../lib/ocr";

export function Home() {
  const { user } = useAuth();
  const { year, records, warnings, problems, notice } = useReadyLedger();
  const finals = records.filter(isFinal);
  const drafts = records.length - finals.length;
  const total = finals.reduce((sum, r) => sum + r.amount, 0);
  const reimbursed = finals.reduce((sum, r) => sum + r.reimbursed, 0);
  const usage = useOcrUsage();
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
          {finals.length}件{reimbursed > 0 && `・うち補填 ${formatYen(reimbursed)}`}
        </div>
      </section>

      {drafts > 0 && (
        <Link to="/records" className="block rounded bg-amber-50 p-3 text-sm text-amber-900 underline">
          一時保存中の記録が {drafts}件 あります
        </Link>
      )}

      <StartRecord />
      {usage && <p className="text-xs text-gray-500">今日の写真の読み取り: 残り {usage.remaining}回（1日{usage.limit}回まで）</p>}

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

/** 表示できなくても記録には影響しないため、失敗は無視する */
function useOcrUsage(): OcrUsage | null {
  const { usage } = useOcr();
  const [value, setValue] = useState<OcrUsage | null>(null);
  useEffect(() => {
    let cancelled = false;
    usage().then(
      (u) => !cancelled && setValue(u),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [usage]);
  return value;
}
