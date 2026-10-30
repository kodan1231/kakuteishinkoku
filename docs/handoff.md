# 引き継ぎメモ

> 更新: 2026-10-30（Step 6・7 の実装まで）
> 作業ブランチ: `main`（リモート `origin/main`。push すると Cloudflare に自動デプロイされる）

---

## 1. 進め方のルール（利用者の希望）

- 利用者は開発経験10年超。趣味でのアプリ開発。回答は日本語
- 要件を受けたら、実現方針に不明点がないよう**詳細を確認してから**進める。おすすめ案を添えて質問すると「全部おすすめで」「OK」と返ってくることが多い
- **実装は承認を得るまで行わない**（仕様をまとめて「この内容で実装してよいですか？」と確認 → OK をもらってから）。不具合の修正は、合意済みの仕様どおりに直す範囲なら確認なしで行ってきた
- 費用は**すべて無料枠**（クレジットカード登録が必要なサービスは使わない。R2 も使わない）
- 読み取り結果などを**勝手に置き換えず、候補として出して利用者に選ばせる**のが好み
- 実装後は `npm run typecheck` / `npm test` / `npx vite build` を通し、design.md・handoff.md を更新してコミット → `main` に push（push はこれまで毎回行ってよいことになっている）。最後に、実機で確認してほしい項目を番号付きで伝える
- 本物の Google API・Workers AI・iPhone では確認できないので、その旨を毎回はっきり伝える

---

## 2. 環境

- Windows / PowerShell（Bash も可）。作業フォルダ `C:\work\source\kakuteishinkoku`
- URL: `https://kakuteishinkoku.kodan1231.workers.dev`
- Cloudflare: Worker `kakuteishinkoku`、Workers Builds（本番ブランチ `main`、ビルド `npm run build`、デプロイ `npx wrangler deploy`）
- **D1 のマイグレーションは自動デプロイに含めない**。`migrations/` を追加したら、push の前に手元で `CI=true` を付けて `npm run db:migrate:remote` を実行する（このPCの wrangler は利用者のアカウントでログイン済み）。`0001_init.sql` のみ適用済み
- シークレット（`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `ADMIN_EMAIL`）は `wrangler secret bulk` で設定済み（`OCR_LAB_KEY` は 2026-10-30 に Worker と `.dev.vars` から削除済み）。値は手元の `.dev.vars`（Git 管理外）にある。**シークレットはコミットしない**
- Google Cloud: プロジェクト `kakuteishinkoku2426508`、OAuth 同意画面は「本番環境」で公開済み（ホームページ `/login`、`/privacy`、`/terms`、承認済みドメイン `kodan1231.workers.dev`）
- 管理者: `kodan1231@gmail.com`。家族: 小段圭司（本人）、小段あゆみ
- コミットメッセージの末尾: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

## 3. 現在の状態

### 3.1 方針（詳細は [`docs/design.md`](./design.md)）
- フェーズ1は会社員の**医療費控除**（家族分含む）。フェーズ2で副業（白色申告）
- 構成: Cloudflare Workers（Hono）+ React/Vite + D1 + Workers AI
- **データは各ユーザーの Google ドライブ**（`確定申告サポート/<年>/台帳_<年>` のスプレッドシート、`領収書/`、ルートに `OCR修正記録.json`）。端末から Drive/Sheets API を直接呼ぶ。D1 には許可アカウント・招待・OCR 利用回数のみ
- ログインは Google のみ（`drive.file`）。招待制
- 出力は国税庁「医療費集計フォーム」（Ver.3.1、列構成は design.md 7.2 で確認済み）

### 3.2 開発ステップ

| Step | 内容 | 状態 |
|---|---|---|
| 0 | 検証 | OCR は Mistral Small 3.1 に決定（2026-10-25）。集計フォームの列構成は確認済み。検証ページ `/lab/ocr` は 2026-10-30 に撤去 |
| 1 | 土台 | 完了 |
| 2 | 認証・招待 | ログイン・招待は実機で確認済み。**1時間後の自動再ログイン・iOS PWA は未確認** |
| 3 | ドライブ初期化・台帳・家族設定 | 実機で確認済み。**年度切り替えでの台帳自動作成・別端末は未確認** |
| 4 | 記録（手入力・領収書の添付・一覧） | 実機で確認済み。日付リール・通院交通費の同時入力（別の記録として保存）・前回の呼び出し・領収書の保存を追加済み |
| 5 | 撮影して入力（OCR）・一時保存 | 実装済み。和暦はサーバーで換算（令和8年→2022年の誤りを修正）。**最新の変更は実機での確認待ち** |
| 5a | 月ごとの補填（健保給付）の入力と自動配分 | 実装済み・**実機での確認待ち**（design.md 7.3） |
| 5b | OCR の改善（支払先の修正記録・過去の支払先との照合を候補に表示、患者名から医療を受けた人を選ぶ、過去の支払先を AI に伝える） | 実装済み・**実機での確認待ち** |
| 6 | 一覧の絞り込み（design.md 6.4） | 実装済み・**実機での確認待ち** |
| 7 | 集計・出力（医療費集計フォーム xlsx、CSV、控除見込額。design.md 7.1・7.2） | 実装済み・**実機での確認待ち**。手元の Excel で生成ファイルを開けることは確認済み。**作成コーナーでの読み込みは未確認** |
| 8 | PWA | 未着手 |

### 3.3 台帳の版
- 版3（医療費シートに「状態」列＝一時保存、「補填」シートを追加）。古い台帳は開いたときに自動で移行する（`ledgerService.loadLedgerData`）

### 3.4 コード構成
```text
src/server/   Worker（Hono）
  routes/     auth, invites, admin, ocr（読み取り・利用回数 1人30回/日）
  lib/        idToken, google, db（D1・OCR 利用回数）, session, ocr（応答の解析・和暦換算）
src/client/   React
  auth/       AuthProvider（ログイン・自動更新）, tokenStore, pkce
  drive/      google（Drive/Sheets API）, ledger（台帳の構成・版）, records（記録・交通費・入力検証）,
              reimbursements（月ごとの補填と配分）, ocrCorrections（修正記録・候補・患者名の照合）,
              recordFilter（一覧の絞り込み・並び順）, summary（小計・控除見込額・総所得金額等）,
              ledgerService（検索・作成・読み書き・移行）, ledgerCache（ID のキャッシュ）, LedgerProvider（状態）
  export/     medicalForm（集計フォームの XML 書き込み・CSV）, iryouhi_form_v3.1.xlsx（公式テンプレート）
  lib/        ocr（読み取り API・写真の受け渡し）, taxYear（年度の初期値）, download（端末への保存）, image, format
  pages/      Login, AuthCallback, Invite, Setup, Home, Records, RecordEdit, Reimbursements, Summary, Settings,
              FamilySettings, Admin, Privacy, Terms
src/shared/   型・定数（ocr.ts に本番モデル・AI への指示）
```
- チェック: `npm run typecheck` / `npm test`（108件）/ `npx vite build`
- 許可したコマンドは `.claude/settings.local.json`（Git 管理外）に登録してあり、セッションをまたいで使える
- Free プランの CPU 10ms 制限のため、重い処理（画像縮小・xlsx 生成）は端末側で行う

---

## 4. 次の作業

1. **利用者の実機確認の結果を受け取る**
   - 前回分（Step 5a・5b）: 患者名からの人の選択、支払先の候補（「ロハル」など）、7月の健保給付 14,600円（小段あゆみ）の配分・超過警告、補填シート・状態列の追加、一時保存 → 確定
     - 利用者から「登録内容から確認して」と依頼あり。ただしドライブ（drive.file）はアプリからしか読めないため、台帳を xlsx でダウンロードするか、集計画面の CSV を作業フォルダに置いてもらう必要がある（2026-10-30 にお願い済み・回答待ち）
   - 今回分（Step 6・7）: 一覧の絞り込み、集計画面・控除見込額・総所得金額等、集計フォーム・CSV の作成とドライブ・端末への保存
2. **集計フォームを作成コーナーで読み込めるかの試験**（令和7年分の作成コーナーで、医療費控除 →「医療費集計フォームを利用する」）。読み込めなければ、まず支払日（J 列）の書き方・インライン文字列を疑う
3. 令和8年分のフォームが改版されたら（来年1月ごろ）テンプレートを差し替える（`src/client/export/`。入力欄が見つからなければエラーになる）
4. Step 8（PWA・仕上げ）の詳細確認
5. 残りの実機確認: Step 2（1時間後の自動再ログイン、iOS PWA）、Step 3（年度切り替え、別端末）

### 利用者に未確認の質問
- 実機確認（前回分）を、台帳・CSV のファイルから確認する方法でよいか（上の 1）
