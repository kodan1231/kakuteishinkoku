import { Link } from "react-router";

export function Home() {
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-bold">確定申告サポート</h1>
      <p className="mt-2 text-sm text-gray-600">準備中です。</p>
      <Link to="/lab/ocr" className="mt-4 inline-block text-teal-700 underline">
        OCR 検証ページ
      </Link>
    </main>
  );
}
