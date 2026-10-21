import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  INVITE_DEFAULT_DAYS,
  INVITE_MAX_DAYS,
  type CreatedInvitation,
  type InvitationSummary,
  type UserSummary,
} from "../../shared/auth";
import { useAuth } from "../auth/AuthProvider";
import { buttonClass, ErrorText, Page, subButtonClass } from "../components/Layout";
import { useApi } from "../lib/api";

export function Admin() {
  const api = useApi();
  const { user: me } = useAuth();
  const [invites, setInvites] = useState<InvitationSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState(INVITE_DEFAULT_DAYS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const reload = useCallback(async () => {
    const [i, u] = await Promise.all([
      api<InvitationSummary[]>("/api/admin/invites"),
      api<UserSummary[]>("/api/admin/users"),
    ]);
    setInvites(i);
    setUsers(u);
  }, [api]);

  useEffect(() => {
    void run(reload);
  }, [run, reload]);

  const createInvite = () =>
    run(async () => {
      const inv = await api<CreatedInvitation>("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({ memo, days }),
      });
      setCreated(inv);
      setMemo("");
      await reload();
    });

  return (
    <Page title="管理">
      <Link to="/" className="text-sm text-teal-700 underline">
        ← ホーム
      </Link>
      {error && <ErrorText>{error}</ErrorText>}

      <section className="space-y-2">
        <h2 className="font-semibold">招待を作成</h2>
        <label className="block text-sm">
          メモ（誰宛か）
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={100}
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          有効期限（日）
          <input
            type="number"
            min={1}
            max={INVITE_MAX_DAYS}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1 block w-24 rounded border px-2 py-1"
          />
        </label>
        <button type="button" className={buttonClass} disabled={busy} onClick={createInvite}>
          招待リンクを作成
        </button>
        {created && <CreatedInvite invite={created} />}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">招待一覧</h2>
        <ul className="divide-y rounded border text-sm">
          {invites.length === 0 && <li className="p-2 text-gray-500">まだありません</li>}
          {invites.map((inv) => {
            const state = inviteState(inv);
            return (
              <li key={inv.id} className="flex items-center justify-between gap-2 p-2">
                <div>
                  <div>{inv.memo ?? "（メモなし）"}</div>
                  <div className="text-xs text-gray-500">
                    {state.label}
                    {inv.usedByEmail && `：${inv.usedByEmail}`}・期限 {formatDate(inv.expiresAt)}
                  </div>
                </div>
                {state.active && (
                  <button
                    type="button"
                    className={subButtonClass}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`/api/admin/invites/${inv.id}`, { method: "DELETE" });
                        await reload();
                      })
                    }
                  >
                    取消
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">ユーザー一覧</h2>
        <ul className="divide-y rounded border text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 p-2">
              <div>
                <div>
                  {u.displayName ?? u.email}
                  {u.role === "admin" && <span className="ml-1 text-xs text-teal-700">管理者</span>}
                  {u.status === "disabled" && <span className="ml-1 text-xs text-red-700">利用停止中</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {u.email}・最終利用 {u.lastSeenAt ? formatDate(u.lastSeenAt) : "—"}
                </div>
              </div>
              {u.id !== me?.id && (
                <button
                  type="button"
                  className={subButtonClass}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const status = u.status === "active" ? "disabled" : "active";
                      if (status === "disabled" && !confirm(`${u.email} を利用停止にしますか？`)) return;
                      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
                      await reload();
                    })
                  }
                >
                  {u.status === "active" ? "利用停止" : "再開"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Link to="/lab/ocr" className="block text-sm text-teal-700 underline">
        OCR 検証ページ
      </Link>
    </Page>
  );
}

function CreatedInvite({ invite }: { invite: CreatedInvitation }) {
  const url = `${location.origin}/invite/${invite.token}`;
  const text = `確定申告サポートへの招待です。${formatDate(invite.expiresAt)}まで有効です。\n${url}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded bg-teal-50 p-3 text-sm">
      <p>招待リンクを作成しました。このリンクはこの画面でしか表示されません。</p>
      <p className="break-all font-mono text-xs">{url}</p>
      <div className="flex flex-wrap gap-2">
        {"share" in navigator && (
          <button
            type="button"
            className={subButtonClass}
            onClick={() => void navigator.share({ text }).catch(() => undefined)}
          >
            共有（LINE など）
          </button>
        )}
        <a
          className={subButtonClass}
          href={`https://line.me/R/share?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
        >
          LINE で送る
        </a>
        <button
          type="button"
          className={subButtonClass}
          onClick={() =>
            void navigator.clipboard.writeText(url).then(
              () => setCopied(true),
              () => undefined,
            )
          }
        >
          {copied ? "コピーしました" : "URL をコピー"}
        </button>
      </div>
    </div>
  );
}

function inviteState(inv: InvitationSummary): { label: string; active: boolean } {
  if (inv.usedAt) return { label: "使用済み", active: false };
  if (inv.revokedAt) return { label: "取消済み", active: false };
  if (inv.expiresAt < Date.now()) return { label: "期限切れ", active: false };
  return { label: "未使用", active: true };
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
