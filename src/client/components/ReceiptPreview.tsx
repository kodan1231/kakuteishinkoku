import { useEffect, useState } from "react";
import { useLedger } from "../drive/LedgerProvider";

const boxClass = "flex h-24 w-24 items-center justify-center overflow-hidden rounded border bg-gray-50 text-xs text-gray-500";

export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** ドライブに保存済みの領収書。タップでドライブの表示画面を開く */
export function ReceiptPreview({ fileId }: { fileId: string }) {
  const { loadReceipt } = useLedger();
  const [preview, setPreview] = useState<{ url?: string; mimeType?: string; error?: boolean }>({});

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    loadReceipt(fileId).then(
      (r) => {
        if (cancelled) return;
        url = URL.createObjectURL(r.blob);
        setPreview({ url, mimeType: r.mimeType });
      },
      () => !cancelled && setPreview({ error: true }),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, loadReceipt]);

  return (
    <a href={driveFileUrl(fileId)} target="_blank" rel="noreferrer" className={boxClass}>
      {preview.error ? "表示できません" : !preview.url ? "読み込み中…" : preview.mimeType?.startsWith("image/") ? (
        <img src={preview.url} alt="領収書" className="h-full w-full object-cover" />
      ) : (
        "PDF"
      )}
    </a>
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
