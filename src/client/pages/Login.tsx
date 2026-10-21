import { useState } from "react";
import { Link, Navigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { buttonClass, ErrorText, Loading, Page } from "../components/Layout";

export function Login() {
  const { status, message, login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  if (status === "loading") return <Loading />;
  if (status === "signedIn") return <Navigate to="/" replace />;
  return (
    <Page title="確定申告サポート">
      {(message || error) && <ErrorText>{error ?? message}</ErrorText>}
      <p className="text-sm text-gray-600">
        確定申告（医療費控除）の準備をスマホで行うためのツールです。記録と領収書は、ご自身の Google ドライブに保存されます。
      </p>
      <p className="text-sm text-gray-600">招待されたユーザーのみ利用できます。</p>
      <button
        type="button"
        className={buttonClass}
        onClick={() => login().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
      >
        Google でログイン
      </button>
      <nav className="flex gap-4 pt-8 text-sm">
        <Link to="/privacy" className="text-teal-700 underline">
          プライバシーポリシー
        </Link>
        <Link to="/terms" className="text-teal-700 underline">
          利用規約
        </Link>
      </nav>
    </Page>
  );
}
