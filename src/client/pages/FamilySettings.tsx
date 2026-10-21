import { useState } from "react";
import { Link } from "react-router";
import { buttonClass, ErrorText, inputClass, Page, subButtonClass } from "../components/Layout";
import { NAME_MAX_LENGTH, RELATIONSHIPS, validateName } from "../drive/ledger";
import { useReadyLedger, type MemberInput } from "../drive/LedgerProvider";

export function FamilySettings() {
  const { year, family, saveMember, deleteMember, moveMember } = useReadyLedger();
  // 編集中の家族の id。"new" は追加
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="家族設定">
      <Link to="/settings" className="text-sm text-teal-700 underline">
        ← 設定
      </Link>
      <p className="text-sm text-gray-600">
        {year}年分の台帳に登録されている家族です。名前は医療費集計フォームの「医療を受けた人」に使われます。
      </p>
      {error && <ErrorText>{error}</ErrorText>}

      <ul className="divide-y rounded border">
        {family.map((m, i) =>
          editing === m.id ? (
            <li key={m.id} className="p-2">
              <MemberForm initial={m} busy={busy} onSave={(v) => run(() => saveMember(v))} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={m.id} className="flex items-center justify-between gap-2 p-2">
              <div>
                <div>{m.name}</div>
                <div className="text-xs text-gray-500">{m.relationship}</div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={subButtonClass}
                  disabled={busy || i === 0}
                  aria-label="上へ"
                  onClick={() => void run(() => moveMember(m.id, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={subButtonClass}
                  disabled={busy || i === family.length - 1}
                  aria-label="下へ"
                  onClick={() => void run(() => moveMember(m.id, 1))}
                >
                  ↓
                </button>
                <button type="button" className={subButtonClass} disabled={busy} onClick={() => setEditing(m.id)}>
                  編集
                </button>
                <button
                  type="button"
                  className={subButtonClass}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`${m.name} を削除しますか？（これまでの記録は残ります）`)) void run(() => deleteMember(m.id));
                  }}
                >
                  削除
                </button>
              </div>
            </li>
          ),
        )}
        {family.length === 0 && <li className="p-2 text-sm text-gray-500">まだ登録されていません</li>}
      </ul>

      {editing === "new" ? (
        <MemberForm busy={busy} onSave={(v) => run(() => saveMember(v))} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" className={buttonClass} disabled={busy} onClick={() => setEditing("new")}>
          家族を追加
        </button>
      )}
    </Page>
  );
}

function MemberForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial?: MemberInput;
  busy: boolean;
  onSave: (m: MemberInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [relationship, setRelationship] = useState(initial?.relationship ?? "配偶者");
  const nameError = validateName(name);
  // 台帳を手で編集して一覧にない続柄が入っていても、選択肢に出して消えないようにする
  const options = RELATIONSHIPS.includes(relationship as never) ? RELATIONSHIPS : [relationship, ...RELATIONSHIPS];
  return (
    <div className="space-y-2 rounded bg-gray-50 p-2">
      <label className="block text-sm">
        名前（{NAME_MAX_LENGTH}文字以内）
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} disabled={busy} />
      </label>
      {name && nameError && <p className="text-sm text-red-700">{nameError}</p>}
      <label className="block text-sm">
        続柄
        <select
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          className={inputClass}
          disabled={busy}
        >
          {options.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !!nameError}
          onClick={() => onSave({ id: initial?.id, name, relationship })}
        >
          保存
        </button>
        <button type="button" className={subButtonClass} disabled={busy} onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
