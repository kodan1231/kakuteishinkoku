import type { ReactNode } from "react";

export function Page({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
      {title && <h1 className="text-xl font-bold">{title}</h1>}
      {children}
    </main>
  );
}

export function Loading({ label = "読み込み中…" }: { label?: string }) {
  return <p className="p-8 text-center text-gray-500">{label}</p>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="rounded bg-red-50 p-3 text-sm text-red-800">{children}</p>;
}

export const buttonClass = "rounded bg-teal-700 px-4 py-2 text-white disabled:opacity-40";
export const subButtonClass = "rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-40";
