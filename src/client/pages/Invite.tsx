import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { InviteStatus } from "../../shared/auth";
import { useAuth } from "../auth/AuthProvider";
import { buttonClass, ErrorText, Loading, Page } from "../components/Layout";
import { requestJson } from "../lib/http";

export function Invite() {
  const { token = "" } = useParams();
  const { status, login } = useAuth();
  const [invite, setInvite] = useState<InviteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestJson<InviteStatus>(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  if (status === "signedIn") {
    return (
      <Page title="確定申告サポートへの招待">
        <p>すでにログインしています。</p>
        <Link to="/" className="text-teal-700 underline">
          ホームへ
        </Link>
      </Page>
    );
  }
  if (error) return <Page title="確定申告サポートへの招待"><ErrorText>{error}</ErrorText></Page>;
  if (!invite) return <Loading />;
  if (!invite.valid) {
    return (
      <Page title="確定申告サポートへの招待">
        <ErrorText>この招待リンクは使用済みか、有効期限が切れています。招待した人に新しいリンクを依頼してください。</ErrorText>
      </Page>
    );
  }

  return (
    <Page title="確定申告サポートへの招待">
      <p>確定申告の準備（医療費などの記録・集計）をスマホで行うアプリです。</p>
      <section className="space-y-2 rounded bg-gray-50 p-3 text-sm">
        <h2 className="font-semibold">データの扱いについて</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>記録した内容と領収書の写真は、<strong>あなた自身の Google ドライブ</strong>に保存されます。</li>
          <li>アプリがアクセスできるのは、このアプリが作成したファイルだけです。ドライブ内の他のファイルは見えません。</li>
          <li>アプリの管理者はあなたのデータを保存しておらず、通常の運用で見ることはありません。</li>
          <li>ログインの情報はこの端末の中だけに保存されます。</li>
        </ul>
      </section>
      <p className="text-xs text-gray-500">
        この招待リンクの有効期限: {new Date(invite.expiresAt!).toLocaleString("ja-JP")}
      </p>
      <button
        type="button"
        className={buttonClass}
        onClick={() => login(token).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
      >
        Google でログインして利用を開始
      </button>
    </Page>
  );
}
