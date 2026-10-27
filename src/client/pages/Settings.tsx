import { useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { ErrorText, inputClass, Page, subButtonClass } from "../components/Layout";
import { driveFolderUrl, spreadsheetUrl, useReadyLedger } from "../drive/LedgerProvider";
import { selectableYears } from "../lib/taxYear";

export function Settings() {
  const { logout } = useAuth();
  const { year, setYear, ledger, ocrCorrections, deleteOcrCorrection } = useReadyLedger();
  const [error, setError] = useState<string | null>(null);
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

      <section className="space-y-1">
        <h2 className="font-bold">写真の読み取りの修正記録</h2>
        <p className="text-xs text-gray-500">
          読み取った支払先を手で直すと記録され、次に同じ読み間違いがあったときに候補として表示されます。間違って覚えたものは削除してください。
        </p>
        {error && <ErrorText>{error}</ErrorText>}
        <ul className="divide-y rounded border text-sm">
          {ocrCorrections.map((c) => (
            <li key={`${c.read}\u0000${c.corrected}`} className="flex items-center justify-between gap-2 p-2">
              <span className="min-w-0">
                {c.read} → <span className="font-bold">{c.corrected}</span>
                <span className="ml-1 text-xs text-gray-500">{c.count}回</span>
              </span>
              <button
                type="button"
                className={subButtonClass}
                onClick={() => {
                  setError(null);
                  deleteOcrCorrection(c.read, c.corrected).catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  );
                }}
              >
                削除
              </button>
            </li>
          ))}
          {ocrCorrections.length === 0 && <li className="p-2 text-gray-500">まだありません</li>}
        </ul>
      </section>

      <button type="button" className={subButtonClass} onClick={() => void logout()}>
        ログアウト
      </button>
    </Page>
  );
}
