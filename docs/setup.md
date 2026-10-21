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
| デプロイコマンド | `npm run db:migrate:remote && npx wrangler deploy` |
| ルートディレクトリ | `/`（空欄） |

- `npm run build` で `dist/` にビルド済みの Worker と設定が出力され、`wrangler deploy` はそれを使う
- Worker 名はリポジトリの `wrangler.jsonc` の `name`（`kakuteishinkoku`）と一致している必要がある
- デプロイコマンドの前半で D1 のマイグレーション（テーブル作成・変更）を適用する。適用済みのものはスキップされる
  - ビルド用 API トークンに D1 の権限がなく失敗する場合は、デプロイコマンドを `npx wrangler deploy` に戻し、手元で `npm run db:migrate:remote` を実行する
- 手元から手動でデプロイする場合は `npm run db:migrate:remote && npm run deploy`

## 変数とシークレット

ダッシュボード → `kakuteishinkoku` → 設定 → 変数とシークレット で設定する。
`wrangler.jsonc` に `keep_vars: true` を指定しているため、自動デプロイで消えることはない。

| 名前 | 種類 | 内容 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | テキスト | Google の OAuth クライアントID |
| `GOOGLE_CLIENT_SECRET` | シークレット | Google の OAuth クライアントシークレット |
| `ADMIN_EMAIL` | テキスト | 管理者の Google アカウントのメールアドレス（招待なしで管理者として登録される） |
| `OCR_LAB_KEY` | シークレット | OCR 検証ページの合言葉（Step 0 の間のみ） |

## Google Cloud の準備（Step 2）

すべて無料・カード登録不要。既存アプリとは別のプロジェクトにする。

1. https://console.cloud.google.com/ で新しいプロジェクトを作成（例: `kakuteishinkoku`）
2. 「API とサービス」→「ライブラリ」で **Google Drive API** と **Google Sheets API** を有効化（Step 3 以降で使用）
3. 「Google Auth Platform」（旧「OAuth 同意画面」）
   - ブランディング: アプリ名「確定申告サポート」、サポートメール、デベロッパーの連絡先
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

## Step 0: OCR 検証ページを使う

1. 検証ページ用の合言葉を Worker に設定する（任意の文字列。他人に推測されにくいもの）
   - ダッシュボード → `kakuteishinkoku` → 設定 → 変数とシークレット → 追加
   - 種類: **シークレット**、名前: `OCR_LAB_KEY`
   - ※「テキスト」型の変数はデプロイ時に `wrangler.jsonc` の内容で上書きされるため、必ずシークレットにする
2. `main` にマージされると自動デプロイされる
3. スマホまたは PC で `https://kakuteishinkoku.<サブドメイン>.workers.dev/lab/ocr` を開く
4. 合言葉を入力し、比較するモデルを選び、領収書の写真を選択して「読み取り実行」
   - 写真は端末で長辺 1024px に縮小してから送信される。サーバーには保存されない
   - 正解（日付・支払先・金額）を入力すると、モデル別の集計表に正解数が出る
5. 結果のスクリーンショットを共有する
6. Cloudflare ダッシュボードの「Workers AI」で Neuron の消費量を確認し、あわせて共有する

### 注意
- Workers AI の無料枠は 1日 10,000 Neurons。大型モデル（Kimi など）は消費が大きい可能性があるため、最初は1〜2枚で試す
- Llama 3.2 Vision は初回にライセンス同意が自動送信される（Meta のライセンスに同意したことになる）
- 検証が終わったら合言葉（シークレット `OCR_LAB_KEY`）をダッシュボードから削除すると、検証 API は無効になる

## ローカル開発
```sh
cat > .dev.vars <<'VARS'
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ADMIN_EMAIL=...
OCR_LAB_KEY=任意の文字列
VARS
npm run db:migrate:local
npm run dev
```
Workers AI はローカルでもリモートの Cloudflare に接続するため、`wrangler login` 済みである必要がある（利用量は無料枠から消費される）。
