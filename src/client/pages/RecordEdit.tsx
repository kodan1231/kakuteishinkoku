import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { MEDICAL_CATEGORIES } from "../../shared/medical";
import { buttonClass, ErrorText, inputClass, Page, subButtonClass } from "../components/Layout";
import { LocalFilePreview, ReceiptPreview } from "../components/ReceiptPreview";
import { useReadyLedger } from "../drive/LedgerProvider";
import {
  lastCategoryFor,
  PAYEE_MAX_LENGTH,
  payeeSuggestions,
  todayString,
  validateRecord,
  type MedicalRecord,
  type RecordInput,
} from "../drive/records";

export function RecordEdit() {
  const { id } = useParams();
  const { records } = useReadyLedger();
  const existing = id ? records.find((r) => r.id === id) : undefined;
  if (id && !existing) {
    return (
      <Page title="記録">
        <ErrorText>記録が見つかりません。削除されたか、別の年度の記録です。</ErrorText>
        <Link to="/records" className="text-sm text-teal-700 underline">
          ← 記録一覧
        </Link>
      </Page>
    );
  }
  return <RecordForm key={id ?? "new"} existing={existing} />;
}

function RecordForm({ existing }: { existing?: MedicalRecord }) {
  const navigate = useNavigate();
  const { year, family, records, saveRecord, deleteRecord } = useReadyLedger();
  const [v, setV] = useState<RecordInput>(() => initialInput(existing, year, family));
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = validateRecord(v, year);
  const shown = submitted ? errors : {};
  const set = (patch: Partial<RecordInput>) => setV((cur) => ({ ...cur, ...patch }));
  const persons = family.some((f) => f.id === v.personId) || !existing
    ? family
    : [...family, { id: existing.personId, name: `${existing.personName}（削除済み）` }];

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      navigate("/records");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const save = () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    void run(() => saveRecord(v, { id: existing?.id, newFiles, removedFileIds: removed }));
  };

  return (
    <Page title={existing ? "記録の編集" : "記録する"}>
      <Link to="/records" className="text-sm text-teal-700 underline">
        ← 記録一覧
      </Link>
      {error && <ErrorText>{error}</ErrorText>}

      <Field label="支払日" error={shown.date}>
        <input
          type="date"
          value={v.date}
          min={`${year}-01-01`}
          max={`${year}-12-31`}
          onChange={(e) => set({ date: e.target.value })}
          className={inputClass}
          disabled={busy}
        />
      </Field>

      <Field label="医療を受けた人" error={shown.personId}>
        <select value={v.personId} onChange={(e) => set({ personId: e.target.value })} className={inputClass} disabled={busy}>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={`支払先（病院・薬局など、${PAYEE_MAX_LENGTH}文字以内）`} error={shown.payee}>
        <input
          value={v.payee}
          list="payee-suggestions"
          onChange={(e) => {
            const payee = e.target.value;
            // 新規のときだけ、同じ支払先の前回の区分を入れる
            const category = existing ? null : lastCategoryFor(records, payee);
            set(category ? { payee, category } : { payee });
          }}
          className={inputClass}
          disabled={busy}
        />
        <datalist id="payee-suggestions">
          {payeeSuggestions(records).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="区分" error={shown.category}>
        <select value={v.category} onChange={(e) => set({ category: e.target.value })} className={inputClass} disabled={busy}>
          {MEDICAL_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>

      <Field label="支払額（円）" error={shown.amount}>
        <input
          inputMode="numeric"
          value={v.amount}
          onChange={(e) => set({ amount: e.target.value })}
          className={inputClass}
          disabled={busy}
        />
      </Field>

      <Field label="補填額（円・保険金などで補填される額）" error={shown.reimbursed}>
        <input
          inputMode="numeric"
          value={v.reimbursed}
          placeholder="0"
          onChange={(e) => set({ reimbursed: e.target.value })}
          className={inputClass}
          disabled={busy}
        />
      </Field>

      <Field label="メモ（交通費の経路、薬の名前など）" error={shown.memo}>
        <textarea value={v.memo} onChange={(e) => set({ memo: e.target.value })} rows={2} className={inputClass} disabled={busy} />
      </Field>

      <section className="space-y-2">
        <div className="text-sm">領収書（写真・PDF）</div>
        <div className="flex flex-wrap gap-2">
          {existing?.receiptFileIds.map((id) => (
            <div key={id} className="space-y-1 text-center">
              <div className={removed.includes(id) ? "opacity-30" : ""}>
                <ReceiptPreview fileId={id} />
              </div>
              <button
                type="button"
                className="text-xs text-teal-700 underline"
                disabled={busy}
                onClick={() => setRemoved((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
              >
                {removed.includes(id) ? "元に戻す" : "削除"}
              </button>
            </div>
          ))}
          {newFiles.map((f, i) => (
            <div key={`${f.name}-${i}`} className="space-y-1 text-center">
              <LocalFilePreview file={f} />
              <button
                type="button"
                className="text-xs text-teal-700 underline"
                disabled={busy}
                onClick={() => setNewFiles((cur) => cur.filter((_, j) => j !== i))}
              >
                取り消し
              </button>
            </div>
          ))}
        </div>
        <label className={`${subButtonClass} inline-block cursor-pointer`}>
          写真・PDF を追加
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              setNewFiles((cur) => [...cur, ...files]);
              e.target.value = "";
            }}
          />
        </label>
      </section>

      {submitted && Object.keys(errors).length > 0 && <ErrorText>入力内容を確認してください</ErrorText>}
      <div className="flex flex-col gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={save}>
          {busy ? "保存しています…" : "保存"}
        </button>
        {existing && (
          <button
            type="button"
            className={subButtonClass}
            disabled={busy}
            onClick={() => {
              if (confirm("この記録を削除しますか？（領収書はドライブのゴミ箱に移ります）")) void run(() => deleteRecord(existing.id));
            }}
          >
            削除
          </button>
        )}
      </div>
    </Page>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      {label}
      {children}
      {error && <span className="mt-1 block text-red-700">{error}</span>}
    </label>
  );
}

function initialInput(existing: MedicalRecord | undefined, year: number, family: { id: string; relationship: string }[]): RecordInput {
  if (existing) {
    return {
      date: existing.date,
      personId: existing.personId,
      payee: existing.payee,
      category: existing.category,
      amount: String(existing.amount),
      reimbursed: existing.reimbursed ? String(existing.reimbursed) : "",
      memo: existing.memo,
    };
  }
  const today = todayString();
  return {
    // 選択中の年度が今年でなければ、日付は選んでもらう
    date: today.startsWith(`${year}-`) ? today : "",
    personId: (family.find((f) => f.relationship === "本人") ?? family[0])?.id ?? "",
    payee: "",
    category: MEDICAL_CATEGORIES[0],
    amount: "",
    reimbursed: "",
    memo: "",
  };
}
