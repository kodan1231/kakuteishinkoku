import { useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { buttonClass, ErrorText, inputClass, Loading, Page, subButtonClass } from "../components/Layout";
import { NAME_MAX_LENGTH, ROOT_FOLDER_NAME, validateName } from "../drive/ledger";
import { useLedger } from "../drive/LedgerProvider";

/** 初回設定。ドライブへの保存の同意と、本人の名前の確認を受けてから台帳を作る */
export function Setup() {
  const { user, logout } = useAuth();
  const { state, year, setup, reload } = useLedger();
  const [name, setName] = useState(user?.displayName ?? "");
  const [declined, setDeclined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "ready") return <Navigate to="/" replace />;
  if (state.status === "loading") return <Loading label="ドライブを確認しています…" />;
  if (state.status === "error") {
    return (
      <Page>
        <ErrorText>ドライブを確認できませんでした。{state.message}</ErrorText>
        <button type="button" className={buttonClass} onClick={reload}>
          再試行
        </button>
      </Page>
    );
  }

  if (declined) {
    return (
      <Page title="はじめに">
        <p>同意いただけない場合は、本アプリを利用できません。</p>
        <div className="flex gap-2">
          <button type="button" className={subButtonClass} onClick={() => setDeclined(false)}>
            戻る
          </button>
          <button type="button" className={subButtonClass} onClick={() => void logout()}>
            ログアウト
          </button>
        </div>
      </Page>
    );
  }

  const nameError = validateName(name);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await setup(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Page title="はじめに">
      {error && <ErrorText>{error}</ErrorText>}
      <section className="space-y-2">
        <h2 className="font-bold">データの保存先</h2>
        <p>
          記録と領収書は、あなたの Google ドライブに保存されます。運営者のサーバーには保存されません。
        </p>
        <p>
          同意いただくと、ドライブに「{ROOT_FOLDER_NAME}」フォルダと、{year}年分の台帳（スプレッドシート）を作成します。
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-bold">あなたの名前</h2>
        <p className="text-sm text-gray-600">
          確定申告の医療費集計フォームに「医療を受けた人」として記載されます。ニックネームの場合は本名に直してください（{NAME_MAX_LENGTH}
          文字以内）。あとから家族設定でも変更できます。
        </p>
        <label className="block text-sm">
          名前
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} disabled={busy} />
        </label>
        {name && nameError && <p className="text-sm text-red-700">{nameError}</p>}
      </section>
      <div className="flex flex-col gap-2">
        <button type="button" className={buttonClass} disabled={busy || !!nameError} onClick={() => void submit()}>
          {busy ? "ドライブを準備しています…" : "同意して作成"}
        </button>
        <button type="button" className={subButtonClass} disabled={busy} onClick={() => setDeclined(true)}>
          同意しない
        </button>
      </div>
    </Page>
  );
}
