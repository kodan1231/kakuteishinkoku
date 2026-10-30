# セットアップ手順

## 前提
- Node.js 22 以上
- Cloudflare アカウント（Worker `kakuteishinkoku` 作成済み）

## 初回
```sh
npm install
npx wrangler login   # ブラウザで Cloudflare にログイン
```

## デプロイ（Workers Builds による自動デプロイ）

Worker `kakuteishinkoku` は GitHub と連携済みで、`main` への push で自動デプロイされる。
Cloudflare ダッシュボード → Workers & Pages → `kakuteishinkoku` → 設定 → ビルド で次のとおり設定する。

| 項目 | 値 |
|---|---|
| 本番ブランチ | `main` |
| ビルドコマンド | `npm run build` |
| デプロイコマンド | `npx wrangler deploy` |
| ルートディレクトリ | `/`（空欄） |

- `npm run build` で `dist/` にビルド済みの Worker と設定が出力され、`wrangler deploy` はそれを使う
  - ビルドコマンドが空だと `The assets property ... is missing the required directory property` で失敗する
- Worker 名はリポジトリの `wrangler.jsonc` の `name`（`kakuteishinkoku`）と一致している必要がある
- **D1 のマイグレーションは自動デプロイでは適用しない。** `migrations/` を追加したら、push の前に手元（`wrangler login` 済みの PC）で `npm run db:migrate:remote` を実行する。適用済みのものはスキップされる
  - 確認プロンプトを出さずに実行する場合は環境変数 `CI=true` を付ける
- 手元から手動でデプロイする場合は `npm run db:migrate:remote && npm run deploy`

## 変数とシークレット

ダッシュボード → `kakuteishinkoku` → 設定 → 変数とシークレット で設定する。
`wrangler.jsonc` に `keep_vars: true` を指定しているため、自動デプロイで消えることはない。

| 名前 | 種類 | 内容 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | テキスト | Google の OAuth クライアントID |
| `GOOGLE_CLIENT_SECRET` | シークレット | Google の OAuth クライアントシークレット |
| `ADMIN_EMAIL` | テキスト | 管理者の Google アカウントのメールアドレス（招待なしで管理者として登録される） |

## Google Cloud の準備（Step 2）

すべて無料・カード登録不要。既存アプリとは別のプロジェクトにする。

1. https://console.cloud.google.com/ で新しいプロジェクトを作成（例: `kakuteishinkoku`）
2. 「API とサービス」→「ライブラリ」で **Google Drive API** と **Google Sheets API** を有効化（Step 3 以降で使用）
3. 「Google Auth Platform」（旧「OAuth 同意画面」）
   - ブランディング: アプリ名「確定申告サポート」、サポートメール、デベロッパーの連絡先
     - 以下が空だと「アプリを公開」が押せない
     - ホームページ: `https://kakuteishinkoku.<サブドメイン>.workers.dev/login`
     - プライバシーポリシー: `https://kakuteishinkoku.<サブドメイン>.workers.dev/privacy`
     - 利用規約: `https://kakuteishinkoku.<サブドメイン>.workers.dev/terms`
     - 承認済みドメイン: `<サブドメイン>.workers.dev`
   - 対象: **外部**
   - データアクセス: スコープを追加 → `openid` `.../auth/userinfo.email` `.../auth/userinfo.profile` `.../auth/drive.file`
   - 対象 → 公開ステータスを **「本番環境に公開」**（「テスト」のままだとログインが7日で切れる）
     - 審査を求められた場合は、その画面のスクリーンショットを共有する
4. 「クライアント」→ 作成 → 種類「ウェブ アプリケーション」
   - 承認済みの JavaScript 生成元: `https://kakuteishinkoku.<サブドメイン>.workers.dev`、`http://localhost:5173`
   - 承認済みのリダイレクト URI: `https://kakuteishinkoku.<サブドメイン>.workers.dev/auth/callback`、`http://localhost:5173/auth/callback`
5. 表示されたクライアントID・クライアントシークレットを、上の「変数とシークレット」に設定する

## Step 2 の動作確認

1. `https://kakuteishinkoku.<サブドメイン>.workers.dev/` を開き、`ADMIN_EMAIL` のアカウントでログイン
2. ホームの「管理（招待・ユーザー）」→ 招待リンクを作成 →「LINE で送る」等で別アカウント（自分のサブアカウントでも可）に送る
3. 招待リンクを開いて Google でログインし、ホーム画面が表示されることを確認
4. 同じ招待リンクがもう使えないこと、招待していないアカウントではログインできないことを確認
5. 1時間以上たってからアプリを開き直し、ログイン画面が出ずにそのまま使えることを確認
6. iPhone の場合: Safari の「ホーム画面に追加」から開いた状態でもログインできるか確認

## ローカル開発
```sh
cat > .dev.vars <<'VARS'
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ADMIN_EMAIL=...
VARS
npm run db:migrate:local
npm run dev
```
Workers AI はローカルでもリモートの Cloudflare に接続するため、`wrangler login` 済みである必要がある（利用量は無料枠から消費される）。
