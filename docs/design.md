# 確定申告準備アプリ 設計書（ドラフト v0.1）

> ステータス: **レビュー待ち**（承認後に実装開始）
> 最終更新: 2026-10-21

---

## 1. 目的とスコープ

日常の支出を発生時点でスマホから記録し（領収書撮影＋自動読み取り）、確定申告時に必要な形式で出力できるようにする。

| フェーズ | 内容 | 利用者 | 目標 |
|---|---|---|---|
| **1** | 医療費控除（家族分含む）の記録・集計・出力 | 管理者（自分）＋招待ユーザー | 2026年12月中 |
| **2** | 副業（フリーランスSE・民泊等）の収入／経費記録、勘定科目別集計、白色申告（収支内訳書）向け出力 | 招待ユーザー | 2027年1〜2月 |
| **3** | 減価償却、訂正削除履歴、年度比較 等 | — | 必要に応じて |

**本書はフェーズ1の詳細設計とフェーズ2の概要を扱う。** フェーズ2の詳細は着手前に別途設計する。

### 対象外（現時点）
- 青色申告（複式簿記）
- クレジットカード・銀行明細の取込
- e-Tax への直接送信（国税庁「確定申告書等作成コーナー」へのファイル読込で対応）

---

## 2. 前提・制約

| 項目 | 内容 |
|---|---|
| 費用 | **すべて無料枠**で運用（クレジットカード登録が必要なサービスは使わない） |
| Cloudflare | Free プラン（既存アカウントを流用、リソースは本アプリ専用に新規作成） |
| URL | `https://<app-name>.<subdomain>.workers.dev` |
| ログイン | Google アカウントのみ |
| データ保管 | **各ユーザー自身の Google ドライブ**（スプレッドシート＋画像/PDF） |
| 利用端末 | 主にスマホ（PWA としてホーム画面追加） |
| 利用開始 | 招待制（招待リンクを LINE 等で送付） |

### Cloudflare Free プランで設計に効く制約
| 制約 | 値 | 設計上の対応 |
|---|---|---|
| Workers CPU 時間 | **10ms / リクエスト** | 画像リサイズ・xlsx 生成など重い処理は**すべてブラウザ側**で行う。Worker は中継と軽い処理のみ（外部APIの待ち時間は CPU 時間に含まれない） |
| Workers リクエスト数 | 100,000 / 日 | 個人＋知人規模なら問題なし |
| サブリクエスト | 50 / リクエスト | 1 API 呼び出しで Google API を数回叩く程度に収める |
| D1 | 500MB / DB | 認証・招待情報のみ保存するため問題なし |
| Workers AI | 10,000 Neurons / 日 | 超過時は手入力にフォールバック |

---

## 3. システム構成

```
┌──────────────┐        ┌─────────────────────────────────────────┐
│ スマホ (PWA)   │ HTTPS  │ Cloudflare Workers（1つの Worker）          │
│ React + Vite  │───────▶│  ├ 静的アセット配信（React ビルド成果物）       │
│               │        │  └ /api/*  Hono                           │
│ ・画像リサイズ   │        │      ├ 認証 / 招待 / セッション              │
│ ・xlsx 生成     │        │      ├ Google Drive / Sheets 中継          │
└──────────────┘        │      └ OCR（Workers AI 呼び出し）            │
                        └──────┬──────────────┬──────────────┬──────┘
                               │              │              │
                        ┌──────▼─────┐ ┌──────▼──────┐ ┌─────▼──────────────┐
                        │ D1          │ │ Workers AI  │ │ Google APIs         │
                        │ ユーザー・招待  │ │ 画像読み取り  │ │ OAuth / Drive /     │
                        │ セッション     │ │             │ │ Sheets（ユーザー毎）  │
                        └────────────┘ └─────────────┘ └────────────────────┘
```

### 技術スタック
| 層 | 採用 |
|---|---|
| 言語 | TypeScript |
| API | Hono（Cloudflare Workers） |
| フロント | React + Vite（`@cloudflare/vite-plugin` で Worker と一体ビルド） |
| UI | 軽量なもの（Tailwind CSS 想定、スマホファースト） |
| DB | Cloudflare D1（Drizzle ORM もしくは素の SQL ※実装時に決定） |
| xlsx 生成 | ExcelJS（ブラウザ側で実行） |
| PWA | vite-plugin-pwa |
| テスト | Vitest（`@cloudflare/vitest-pool-workers`） |
| CI/CD | GitHub Actions → `wrangler deploy`（main への push でデプロイ） |

### リポジトリ構成（案）
```
/
├ docs/                 設計書
├ migrations/           D1 マイグレーション SQL
├ src/
│  ├ server/            Hono（Worker）
│  │  ├ routes/         auth, invites, records, files, ocr, export ...
│  │  ├ google/         OAuth, Drive, Sheets クライアント
│  │  └ lib/            crypto, session ...
│  ├ client/            React
│  └ shared/            型定義・定数（医療費区分など）
├ wrangler.jsonc
└ .github/workflows/deploy.yml
```

---

## 4. 認証・招待

### 4.1 Google OAuth
- **認可コードフロー + PKCE + state**（サーバー側でトークン交換）
- スコープ（すべて非機密スコープ想定）
  - `openid` `email` `profile`
  - `https://www.googleapis.com/auth/drive.file` … **本アプリが作成したファイルのみ**アクセス可能。Sheets API もこのスコープで操作可能
- `access_type=offline` でリフレッシュトークンを取得
- リフレッシュトークンは **AES-GCM で暗号化して D1 に保存**（鍵は Worker Secret `TOKEN_ENC_KEY`）
- アクセストークン（有効1時間）も暗号化して有効期限付きでキャッシュし、期限切れ時のみ更新
- Google Cloud プロジェクトは**本アプリ専用に新規作成**（既存アプリに影響を与えない）
- OAuth 同意画面は「本番環境」で公開する（「テスト」のままだとリフレッシュトークンが7日で失効するため）
  - 非機密スコープのみのため審査不要の見込み → **Step 0 で確認**

> 注: 管理者は暗号鍵を保持するため、技術的には各ユーザーの「本アプリが作成したファイル」にアクセス可能。招待時に利用者へ説明する。

### 4.2 招待フロー
```
管理者                        Worker                          被招待者
  │ 招待作成（メモ: 「山田さん」）  │                                 │
  │──────────────────────────▶│ token 生成（32byte 乱数）          │
  │                           │ D1 に SHA-256 ハッシュ・期限を保存    │
  │◀── 招待URL ────────────────│                                 │
  │  /invite/<token>          │                                 │
  │ ── LINE 等で送付 ──────────────────────────────────────────────▶│
  │                           │◀──── 招待URLを開く ────────────────│
  │                           │ token 検証 → Google ログインへ      │
  │                           │◀──── OAuth コールバック ───────────│
  │                           │ ユーザー作成（Google sub と紐付け）  │
  │                           │ 招待を使用済みに                    │
  │                           │ Drive にフォルダ・台帳を作成          │
  │                           │──── ホーム画面へ ─────────────────▶│
```
- 招待リンク: **1回限り・有効期限7日**（期限は作成時に変更可）
- 招待されていない Google アカウントでのログインは拒否
- 管理者は招待の取消・ユーザーの無効化が可能
- **初期管理者**: Worker の環境変数 `ADMIN_EMAIL` と一致する Google アカウントは招待なしで登録でき、管理者権限を持つ

### 4.3 セッション
- ログイン成功時に乱数のセッションIDを発行し、ハッシュを D1 に保存
- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`、有効期限30日（利用ごとに延長）
- 状態を変更する API は `Origin` ヘッダを検証（CSRF 対策）

---

## 5. データ設計

### 5.1 D1（認証・管理情報のみ）

```sql
-- ユーザー
CREATE TABLE users (
  id                TEXT PRIMARY KEY,          -- UUID
  google_sub        TEXT NOT NULL UNIQUE,      -- Google アカウント識別子
  email             TEXT NOT NULL,
  display_name      TEXT,
  role              TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  status            TEXT NOT NULL DEFAULT 'active',-- 'active' | 'disabled'
  refresh_token_enc TEXT,                      -- 暗号化済み
  access_token_enc  TEXT,
  access_token_exp  INTEGER,                   -- epoch秒
  drive_root_id     TEXT,                      -- 「確定申告アプリ」フォルダID
  created_at        INTEGER NOT NULL,
  last_login_at     INTEGER
);

-- 年度ごとの Drive 上のファイル
CREATE TABLE user_years (
  user_id           TEXT NOT NULL REFERENCES users(id),
  year              INTEGER NOT NULL,
  folder_id         TEXT NOT NULL,             -- 年度フォルダ
  receipts_folder_id TEXT NOT NULL,
  exports_folder_id TEXT NOT NULL,
  spreadsheet_id    TEXT NOT NULL,             -- 台帳
  PRIMARY KEY (user_id, year)
);

-- 招待
CREATE TABLE invitations (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  memo         TEXT,                           -- 誰宛か（管理者用メモ）
  created_by   TEXT NOT NULL REFERENCES users(id),
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  used_by      TEXT REFERENCES users(id),
  revoked_at   INTEGER,
  created_at   INTEGER NOT NULL
);

-- セッション
CREATE TABLE sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

-- OAuth の state / PKCE verifier（短期間のみ保持）
CREATE TABLE oauth_states (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  invite_id     TEXT,                          -- 招待経由の場合
  expires_at    INTEGER NOT NULL
);
```

**医療費・家族などの中身は D1 に一切保存しない。**

### 5.2 Google ドライブのフォルダ構成（ユーザーごと）

```
マイドライブ/
└ 確定申告アプリ/
   ├ 2026/
   │  ├ 台帳_2026（スプレッドシート）
   │  ├ 領収書/
   │  │  ├ 20260115_〇〇病院_12340_<id>.jpg
   │  │  └ 20260203_△△薬局_2980_<id>.pdf
   │  └ 出力/
   │     └ 医療費集計フォーム_2026_<日時>.xlsx
   └ 2027/
      └ ...
```
- ファイル名に「日付_支払先_金額」を含め、**Drive 上でも検索しやすく**する
- 年度フォルダ・台帳は、その年の記録が初めて保存されたときに自動作成

### 5.3 台帳スプレッドシート（年度ごと）

全シート共通: 1行目はヘッダ（保護設定）、`id` 列で行を特定、削除は論理削除（`削除済` 列）。

#### シート「_meta」（非表示）
| key | value |
|---|---|
| schema_version | 1 |
| app | kakuteishinkoku |
| year | 2026 |

#### シート「家族」
| 列 | 型 | 説明 |
|---|---|---|
| id | 文字列 | UUID |
| 氏名 | 文字列 | 医療を受けた人 |
| 続柄 | 文字列 | 本人／配偶者／子／父母 など |
| 並び順 | 数値 | |
| 削除済 | TRUE/FALSE | |

> 家族は年をまたいで使うため、新年度の台帳作成時に前年度からコピーする。

#### シート「医療費」
| 列 | 型 | 必須 | 説明 |
|---|---|---|---|
| id | 文字列 | ○ | UUID |
| 支払日 | 日付 | ○ | |
| 対象者ID | 文字列 | ○ | 家族シートの id |
| 対象者名 | 文字列 | ○ | 表示・出力用（記録時点の名前） |
| 支払先 | 文字列 | ○ | 病院・薬局など |
| 区分 | 文字列 | ○ | `診療・治療` / `医薬品購入` / `介護保険サービス` / `その他の医療費` |
| 支払額 | 数値 | ○ | 円 |
| 補填額 | 数値 | | 円（既定 0） |
| 内容メモ | 文字列 | | 交通費の経路、薬の名前など |
| 領収書ファイルID | 文字列 | | Drive ファイルID（複数はカンマ区切り） |
| 読取方法 | 文字列 | | `ocr` / `manual` |
| 作成日時 | 日時 | ○ | |
| 更新日時 | 日時 | ○ | |
| 削除済 | TRUE/FALSE | ○ | |

**年度は支払日の年で決まる**（12月診療・1月支払 → 支払った年の分）。

### 5.4 データアクセス方針
- 一覧・検索・集計は、**その年度の医療費シートを丸ごと読み込み、ブラウザ側で処理**（年数百行程度なので十分速い）
- 追加は `values.append`、更新は `id` から行番号を特定して `values.update`
- 台帳が手で編集されて壊れた場合（ヘッダの欠落、id の重複など）は検知して警告を表示

---

## 6. 領収書の取り込み

### 6.1 画像
1. スマホでカメラ撮影 or 写真選択（**複数枚の一括選択に対応**）
2. **ブラウザ側で**縮小（長辺 1600px、JPEG 品質 0.8 程度）。EXIF の位置情報は削除
3. Worker 経由で Drive の「領収書」フォルダにアップロード
4. PDF はそのままアップロード（上限 10MB）

### 6.2 写真からの読み取り（OCR）
- **Cloudflare Workers AI の画像対応モデル**を使用（無料枠内）
  - 候補: Llama 3.2 Vision、Gemma 3、Mistral Small 3.1 など → **Step 0 で実際の領収書を使って精度を比較して決定**
- OCR 用にはさらに小さい画像（長辺 1024px 程度）をブラウザで作って送る
- モデルへの指示: 領収書から `支払日` `支払先` `金額（合計）` `区分の推定` を JSON で返させる
- 読み取り結果は**必ず確認・修正画面を経てから保存**
- 無料枠の超過や読み取り失敗時は手入力にフォールバック
- PDF は OCR 対象外（フェーズ1）。手入力とする

### 6.3 一括登録の流れ
```
写真を複数選択 → 順にアップロード＆OCR（裏で実行）
            → 確認待ちリストに並ぶ → 1件ずつ確認・修正して保存
```
手元にある2026年1〜10月分の領収書をまとめて登録するための機能。

---

## 7. 集計・出力

### 7.1 集計画面
- 年間の支払額合計・補填額合計・対象者別・区分別・月別の小計
- **控除見込額** = 支払額合計 − 補填額合計 − min(10万円, 総所得金額等 × 5%)（上限200万円）
  - 総所得金額等は設定画面で入力（会社員は源泉徴収票の「給与所得控除後の金額」が目安）。未入力なら10万円で計算
- セルフメディケーション税制とは併用できない旨を注意書きとして表示

### 7.2 医療費集計フォーム出力
- 国税庁配布の**「医療費集計フォーム」(xlsx) に記録を流し込んだファイル**を生成
  - 公式テンプレートをアプリに同梱し、ExcelJS で値を書き込む（ブラウザ側で実行）
  - 生成したファイルはダウンロードし、Drive の「出力」フォルダにも保存
- 生成したファイルは、確定申告書等作成コーナーの医療費控除画面で「医療費集計フォームを読み込む」から取り込む
- **フォームの列構成・入力規則・件数上限は、最新の公式ファイルで Step 0 に確認してから実装する**（テンプレートは年によって改版される可能性があるため、差し替えやすい作りにする）
- 予備として CSV 出力も用意

---

## 8. 画面一覧（フェーズ1）

| # | 画面 | パス | 概要 |
|---|---|---|---|
| 1 | ログイン | `/login` | 「Google でログイン」ボタン |
| 2 | 招待受諾 | `/invite/:token` | 招待の説明（データの保存先・管理者がアクセスできる範囲）→ Google ログイン |
| 3 | ホーム | `/` | 今年の合計・控除見込額、「撮影して記録」ボタン、確認待ち件数 |
| 4 | 記録（撮影） | `/records/new` | 撮影／写真選択（複数）／手入力 |
| 5 | 確認待ちリスト | `/records/pending` | OCR 済みで未確定の記録 |
| 6 | 記録の確認・編集 | `/records/:id` | 画像を見ながら各項目を修正・保存・削除 |
| 7 | 一覧・検索 | `/records` | 期間・支払先・金額範囲・対象者・区分で絞り込み |
| 8 | 集計・出力 | `/summary` | 集計表示、医療費集計フォーム出力、CSV 出力 |
| 9 | 家族設定 | `/settings/family` | 家族の追加・編集・並び替え |
| 10 | 設定 | `/settings` | 対象年度の切替、総所得金額等、Drive フォルダを開くリンク、ログアウト |
| 11 | 管理 | `/admin` | 招待の作成・URL コピー・取消、ユーザー一覧・無効化（管理者のみ） |

---

## 9. API 一覧（フェーズ1）

| メソッド | パス | 概要 |
|---|---|---|
| GET | `/api/auth/login` | Google 認可画面へリダイレクト（`?invite=<token>` 可） |
| GET | `/api/auth/callback` | OAuth コールバック、ユーザー作成／ログイン |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/me` | ログイン中ユーザー情報 |
| GET | `/api/invites/:token` | 招待の有効性確認 |
| GET | `/api/years/:year` | 年度の台帳を準備（なければ作成）し ID を返す |
| GET | `/api/years/:year/family` | 家族一覧 |
| PUT | `/api/years/:year/family` | 家族一覧の保存 |
| GET | `/api/years/:year/medical` | 医療費一覧（年度分を全件） |
| POST | `/api/years/:year/medical` | 医療費の追加 |
| PUT | `/api/years/:year/medical/:id` | 医療費の更新 |
| DELETE | `/api/years/:year/medical/:id` | 医療費の削除（論理削除） |
| POST | `/api/files` | 領収書ファイルのアップロード（→ Drive） |
| GET | `/api/files/:fileId` | 領収書ファイルの取得（Drive から中継） |
| POST | `/api/ocr` | 画像を読み取って候補値を返す |
| POST | `/api/years/:year/exports` | 生成した xlsx を Drive の「出力」フォルダへ保存 |
| GET/POST/DELETE | `/api/admin/invites` | 招待の一覧／作成／取消（管理者） |
| GET/PATCH | `/api/admin/users` | ユーザー一覧／無効化（管理者） |

---

## 10. セキュリティ・プライバシー

| 項目 | 対応 |
|---|---|
| 保存場所 | 医療費などの中身は各ユーザーの Google ドライブにのみ保存 |
| Google の権限 | `drive.file` のみ（ユーザーの他のファイルにはアクセスできない） |
| トークン | AES-GCM で暗号化して D1 に保存。鍵は Worker Secret |
| 管理者のアクセス | 技術的には可能（暗号鍵を保持するため）。招待受諾画面と説明で明示 |
| 招待トークン・セッションID | ハッシュのみを D1 に保存 |
| 位置情報 | 画像の EXIF はアップロード前に削除 |
| OCR | Workers AI に送られた画像はモデルの学習には使われない（Cloudflare の規約） |
| 秘密情報 | `GOOGLE_CLIENT_SECRET` `TOKEN_ENC_KEY` は `wrangler secret` で設定し、リポジトリには置かない |

---

## 11. 事前準備（管理者が行う作業）

1. **Google Cloud**（無料・カード不要）
   1. 新規プロジェクトを作成
   2. Google Drive API・Google Sheets API を有効化
   3. OAuth 同意画面: 外部ユーザー向け、スコープ `openid` `email` `profile` `drive.file`、「本番環境」で公開
   4. OAuth クライアントID（Web アプリ）を作成。リダイレクトURI: `https://<app>.workers.dev/api/auth/callback`（＋ローカル開発用）
2. **Cloudflare**
   1. D1 データベースを新規作成（本アプリ専用）
   2. Worker Secret を設定: `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `TOKEN_ENC_KEY` `ADMIN_EMAIL`
   3. GitHub Actions 用の API トークンを発行（Workers・D1 の編集権限のみ）
3. **GitHub**: リポジトリの Secrets に `CLOUDFLARE_API_TOKEN` `CLOUDFLARE_ACCOUNT_ID` を登録

具体的な手順書は実装時に `docs/setup.md` として作成する。

---

## 12. 開発ステップ（フェーズ1）

| Step | 内容 | 完了条件 |
|---|---|---|
| **0. 検証** | ① Workers AI の各モデルで実際の領収書 5〜10 枚を読み取り、精度を比較 ② 最新の医療費集計フォームの列構成を確認し、生成ファイルが作成コーナーで読み込めるか試す ③ OAuth 同意画面を審査なしで本番公開できるか確認 | 結果を報告し、方針を確定 |
| 1. 土台 | プロジェクト作成（Hono + React + Vite）、D1 マイグレーション、GitHub Actions でのデプロイ | workers.dev で空の画面が表示される |
| 2. 認証・招待 | Google ログイン、セッション、管理画面で招待URLを発行 | 招待URL経由で別アカウントが登録できる |
| 3. Drive 初期化 | フォルダ・台帳の自動作成、家族設定 | Drive に台帳が作られ、家族を登録できる |
| 4. 記録 | 手入力での登録・編集・削除、画像アップロード | 記録が台帳に反映され、画像が Drive に保存される |
| 5. OCR | 撮影 → 読み取り → 確認 → 保存、一括登録 | 複数枚をまとめて登録できる |
| 6. 一覧・検索 | 絞り込み検索、画像表示 | 条件で検索できる |
| 7. 集計・出力 | 集計画面、医療費集計フォーム出力、CSV 出力 | 出力ファイルが作成コーナーで読み込める |
| 8. 仕上げ | PWA 化、エラー表示、`docs/setup.md` | スマホのホーム画面から使える |

各 Step の完了ごとに動作確認を依頼する。

---

## 13. フェーズ2 概要（詳細は着手前に設計）

- 台帳スプレッドシートに「収入」「経費」シートを追加
- **事業区分**（例: フリーランスSE／民泊）を持ち、事業ごと・合計で集計
- 所得区分（事業所得／雑所得）をユーザーごとに設定
- 経費: 日付・取引先・内容・金額・勘定科目・支払方法・家事按分率・領収書
- 収入: 入金日・取引先・内容・金額・源泉徴収税額
- 勘定科目は収支内訳書（一般用）に準拠
- 出力: 勘定科目別・月別の集計（収支内訳書への転記用）、CSV
- 電子取引データの保存要件（日付・金額・取引先で検索できること）を満たす

---

## 14. 未確定事項・確認待ち

| # | 内容 | 状況 |
|---|---|---|
| 1 | 既存アプリ（`tamahouse0930/checkinmanagement`）の認証コードの参照 | このセッションの GitHub 権限では読めず。読めるようになれば、実装方針の参考にする（必須ではない） |
| 2 | OCR に使うモデル | Step 0 で決定 |
| 3 | 医療費集計フォームの列構成 | Step 0 で確認 |
| 4 | OAuth 同意画面の本番公開に審査が必要か | Step 0 で確認 |
| 5 | アプリ名（Worker 名・URL） | 案: `kakuteishinkoku` |
