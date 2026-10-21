import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { Page, subButtonClass } from "../components/Layout";

export function Home() {
  const { user, logout } = useAuth();
  return (
    <Page title="確定申告サポート">
      <p className="text-sm text-gray-600">{user?.displayName ?? user?.email} さん、ログイン中です。</p>
      <p className="text-sm text-gray-600">記録機能は準備中です。</p>
      <nav className="flex flex-col gap-2">
        {user?.role === "admin" && (
          <Link to="/admin" className="text-teal-700 underline">
            管理（招待・ユーザー）
          </Link>
        )}
      </nav>
      <button type="button" className={subButtonClass} onClick={() => void logout()}>
        ログアウト
      </button>
    </Page>
  );
}
