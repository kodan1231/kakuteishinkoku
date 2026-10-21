# 引き継ぎメモ

> 作成: 2026-10-21
> 作業ブランチ: `claude/compassionate-fermat-hb62lp`（最新コミット `14f38f4` 時点の内容）
> このファイルは、main を扱える別のセッションに作業を引き継ぐためのもの。

---

## 1. 引き継ぎ先セッションへの依頼

1. **`claude/compassionate-fermat-hb62lp` を `main` に取り込む**
   - リモートにはまだ `main` が無い。このブランチの内容をそのまま `main` として push してよい
   - `main` への push で Cloudflare Workers Builds による自動デプロイが走る（下記 3.2 のビルド設定が済んでいること）
2. 取り込み後、**「3. 利用者（オーナー）が行う作業」を利用者に案内**し、結果を受け取る
3. 結果を受け取ったら「5. 次の作業」に進む。**実装は利用者の承認を得てから始めること**（下記 2. 参照）

---

## 2. 進め方のルール（利用者の希望）

- 利用者は開発経験10年超。趣味でのアプリ開発
- 要件を受けたら、実現方針に不明点がないよう**詳細を確認してから**進める
- **実装は承認を得るまで行わない**
- 費用は**すべて無料枠**で運用する（クレジットカード登録が必要なサービスは使わない。R2 も使わない）
- 回答は日本語

---

## 3. 利用者（オーナー）が行う作業

詳細な手順は [`docs/setup.md`](./setup.md) を参照。

### 3.1 Google Cloud（Step 2 で必要）
- [x] 本アプリ専用の新規プロジェクトを作成（プロジェクトID `kakuteishinkoku2426508`）
- [x] Google Drive API・Google Sheets API を有効化
- [x] OAuth 同意画面: 外部、スコープ `openid` `email` `profile` `drive.file`、**「本番環境」で公開**（審査なしで公開できた）
  - 公開にはブランディングのホームページ・プライバシーポリシー・利用規約・承認済みドメインの入力が必要だった（`/privacy` `/terms` を追加）
- [x] OAuth クライアント（ウェブ アプリケーション）を作成
  - リダイレクトURI: `https://kakuteishinkoku.<サブドメイン>.workers.dev/auth/callback`（＋`http://localhost:5173/auth/callback`）

### 3.2 Cloudflare ダッシュボード（Worker `kakuteishinkoku`）
- [x] ビルド設定: 本番ブランチ `main`、ビルドコマンド `npm run build`、デプロイコマンド `npx wrangler deploy`（2026-10-22 デプロイ成功）
  - マイグレーションは自動デプロイに含めず、手元で `npm run db:migrate:remote` を実行する運用（setup.md 参照）
- [x] 変数とシークレット（2026-10-22 に `wrangler secret bulk` で4つともシークレットとして設定。値は手元の `.dev.vars` にもある）

  | 名前 | 種類 |
  |---|---|
  | `GOOGLE_CLIENT_ID` | テキスト |
  | `GOOGLE_CLIENT_SECRET` | シークレット |
  | `ADMIN_EMAIL` | テキスト（`kodan1231@gmail.com`） |
  | `OCR_LAB_KEY` | シークレット（OCR 検証ページの合言葉） |

### 3.3 動作確認と結果の共有
- [ ] **Step 0: OCR 検証** — `/lab/ocr` で領収書写真を読み取り、モデル別集計表のスクショと Workers AI の Neuron 消費量を共有
- [ ] **Step 2: ログイン・招待** — `docs/setup.md` の「Step 2 の動作確認」の6項目（1. 管理者ログインは 2026-10-22 に確認済み）
  - 特に: 1時間以上後に開き直してもログイン不要か／iPhone のホーム画面アプリ（PWA）からログインできるか

---

## 4. 現在の状態

### 4.1 決定済みの方針（詳細は [`docs/design.md`](./design.md) v0.2）
- 会社員の**医療費控除**（家族分含む）がフェーズ1。副業（フリーランスSE・民泊）の収入・経費（白色申告）はフェーズ2
- 構成: Cloudflare Workers（Hono）+ React/Vite + D1 + Workers AI。URL は `kakuteishinkoku.<サブドメイン>.workers.dev`
- **データは各ユーザーの Google ドライブ**（年度ごとの台帳スプレッドシート＋領収書画像/PDF）。端末から Drive/Sheets API を直接呼ぶ
- **D1 には許可アカウント・招待・OCR 利用回数のみ**。トークン・セッションはサーバーに保存しない
- ログインは Google のみ（`drive.file` スコープ）。更新用トークンは端末の IndexedDB に暗号化保存し、Worker は交換・更新を中継するだけ
- 招待制: 管理画面で1回限りの招待リンクを作成し LINE 等で送付
- 出力: 国税庁「医療費集計フォーム」(xlsx) に流し込み、確定申告書等作成コーナーで読み込む
- リポジトリは非公開

### 4.2 開発ステップの進捗（design.md 12章）

| Step | 内容 | 状態 |
|---|---|---|
| 0 | 検証（OCR 精度、医療費集計フォーム、OAuth 本番公開、PWA ログイン） | 検証ページ実装済み・**利用者の結果待ち**。集計フォームの列構成は確認済み（design.md 7.2） |
| 1 | 土台（Hono + React + Vite、D1 マイグレーション、CI） | 完了 |
| 2 | 認証・招待 | 実装済み・**実機での動作確認待ち**（本物の Google ログインは未実施） |
| 3〜8 | ドライブ初期化・記録・OCR・一覧・集計出力・PWA | 未着手 |

### 4.3 リソース
- Cloudflare Worker: `kakuteishinkoku`（作成済み、GitHub 連携済み、`main` で自動デプロイ）
- D1: `kakuteishinkoku`（`database_id: 3c5208f4-f598-49bf-af85-be36af08dc85`、`wrangler.jsonc` に設定済み、`0001_init.sql` を 2026-10-22 に適用済み）
- URL: `https://kakuteishinkoku.kodan1231.workers.dev`
- 既存アプリ `tamahouse0930/checkinmanagement` の認証コードは参照できなかった（GitHub 権限なし）。必須ではない

### 4.4 コード構成
```
src/server/   Worker（Hono）
  routes/     auth（トークン中継）, invites, admin, ocrLab（Step 0 用、後で削除）
  lib/        idToken（Google IDトークン検証）, google（OAuth）, db（D1）, session（利用可否判定）, ocr
  middleware/ requireUser / requireAdmin（Bearer IDトークン）
src/client/   React
  auth/       AuthProvider（ログイン・自動更新）, tokenStore（IndexedDB 暗号化保存）, pkce
  pages/      Login, AuthCallback, Invite, Home, Admin, OcrLab
src/shared/   型・定数
migrations/   D1
docs/         design.md（設計）, setup.md（手順）, handoff.md（このファイル）
```
- チェック: `npm run typecheck` / `npm test`（16件）/ `npx vite build`
- Free プランの CPU 10ms 制限のため、重い処理（画像縮小・xlsx 生成）は端末側で行う方針

---

## 5. 次の作業

1. **Step 0 の結果を受けて OCR モデルを決定**
   - 候補: Llama 4 Scout / Gemma 3 12B / Gemma 4 26B / Mistral Small 3.1 / Llama 3.2 Vision / Kimi K2.6 / Qwen 3.8（画像対応か要確認）
   - 1日あたりの OCR 上限回数（初期案 30回/人）も消費量から決める
2. ~~医療費集計フォームの最新版の列構成を確認~~ → 2026-10-22 確認済み（design.md 7.2 に記載）。作成コーナーでの読み込み試験は未実施
3. **Step 2 の実機確認で問題があれば修正**（特に iOS PWA でのリダイレクトログイン）
4. **Step 3（ドライブ初期化・台帳作成・家族設定）の詳細を利用者と確認 → 承認後に実装**
   - 確認したい点の例: 台帳のファイル名・フォルダ名、家族の初期値（本人を自動登録するか）、年度の切り替え方
5. Step 0 完了後、`OCR_LAB_KEY` の削除と `/lab/ocr`・`routes/ocrLab.ts` の撤去（本番 OCR API に置き換え）

### 利用者に未確認の質問
- なし（`ADMIN_EMAIL` は `kodan1231@gmail.com` に決定）
