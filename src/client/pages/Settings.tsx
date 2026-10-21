import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { inputClass, Page, subButtonClass } from "../components/Layout";
import { driveFolderUrl, spreadsheetUrl, useReadyLedger } from "../drive/LedgerProvider";
import { selectableYears } from "../lib/taxYear";

export function Settings() {
  const { logout } = useAuth();
  const { year, setYear, ledger } = useReadyLedger();
  return (
    <Page title="設定">
      <Link to="/" className="text-sm text-teal-700 underline">
        ← ホーム
      </Link>

      <section className="space-y-1">
        <label className="block">
          <span className="font-bold">対象年度</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${inputClass} w-40`}>
            {selectableYears(new Date()).map((y) => (
              <option key={y} value={y}>
                {y}年分
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-gray-500">
          申告期限（3月15日ごろ）までは前年分、それ以降は今年分が最初に選ばれます。台帳が無い年度を選ぶと自動で作成します。
        </p>
      </section>

      <nav className="flex flex-col gap-2">
        <Link to="/settings/family" className="text-teal-700 underline">
          家族設定
        </Link>
        <a href={driveFolderUrl(ledger.yearFolderId)} target="_blank" rel="noreferrer" className="text-teal-700 underline">
          ドライブのフォルダを開く
        </a>
        <a href={spreadsheetUrl(ledger.spreadsheetId)} target="_blank" rel="noreferrer" className="text-teal-700 underline">
          台帳（スプレッドシート）を開く
        </a>
      </nav>

      <button type="button" className={subButtonClass} onClick={() => void logout()}>
        ログアウト
      </button>
    </Page>
  );
}
