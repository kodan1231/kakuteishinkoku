import { useEffect, useState, type ReactNode } from "react";
import { useLedger } from "../drive/LedgerProvider";
import { saveToDevice } from "../lib/download";

const boxClass = "flex h-24 w-24 items-center justify-center overflow-hidden rounded border bg-gray-50 text-xs text-gray-500";
const actionClass = "text-xs text-teal-700 underline disabled:opacity-40";

export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

interface LoadedReceipt {
  blob: Blob;
  url: string;
  mimeType: string;
  name: string;
}

/** ドライブに保存済みの領収書。タップでドライブの表示画面を開き、「保存」で端末に保存する */
export function ReceiptPreview({ fileId, children }: { fileId: string; children?: ReactNode }) {
  const { loadReceipt } = useLedger();
  const [receipt, setReceipt] = useState<LoadedReceipt | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    loadReceipt(fileId).then(
      (r) => {
        if (cancelled) return;
        url = URL.createObjectURL(r.blob);
        setReceipt({ ...r, url });
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, loadReceipt]);

  return (
    <div className="space-y-1 text-center">
      <a href={driveFileUrl(fileId)} target="_blank" rel="noreferrer" className={boxClass}>
        {failed ? "表示できません" : !receipt ? "読み込み中…" : receipt.mimeType.startsWith("image/") ? (
          <img src={receipt.url} alt="領収書" className="h-full w-full object-cover" />
        ) : (
          "PDF"
        )}
      </a>
      <div className="flex justify-center gap-2">
        <button type="button" className={actionClass} disabled={!receipt} onClick={() => receipt && void saveToDevice(new Blob([receipt.blob], { type: receipt.mimeType }), receipt.name)}>
          保存
        </button>
        {children}
      </div>
    </div>
  );
}

/** 保存前に選んだファイル */
export function LocalFilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className={boxClass}>
      {url ? <img src={url} alt={file.name} className="h-full w-full object-cover" /> : <span className="break-all p-1">{file.name}</span>}
    </div>
  );
}
