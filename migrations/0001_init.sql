-- 許可アカウント
CREATE TABLE allowed_users (
  id            TEXT PRIMARY KEY,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

-- 招待
CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  memo        TEXT,
  created_by  TEXT NOT NULL REFERENCES allowed_users(id),
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  used_by     TEXT REFERENCES allowed_users(id),
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);

-- OCR 利用回数（JST の日付単位）
CREATE TABLE ocr_usage (
  user_id  TEXT NOT NULL REFERENCES allowed_users(id),
  date     TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
