-- D1 スキーマ。適用: wrangler d1 execute monster-game-db --file=./schema.sql
-- 生成は決定論なので、保存するのは「個体コード」と「育成state(JSON)」だけ。画像/ステータスは保存しない。

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub  TEXT UNIQUE NOT NULL,      -- GoogleアカウントのサブジェクトID
  email       TEXT,
  name        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monsters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  code        TEXT NOT NULL,             -- 個体コード playerId|word|nonce(全生成のシード)
  train_json  TEXT NOT NULL,             -- 育成state(newTrain(...) をJSON化)
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_monsters_user ON monsters(user_id);

CREATE TABLE IF NOT EXISTS battles (
  id           TEXT PRIMARY KEY,         -- 短いUUID
  p1_user      INTEGER NOT NULL,
  p2_user      INTEGER NOT NULL,
  p1_code      TEXT NOT NULL,
  p2_code      TEXT NOT NULL,
  result_json  TEXT NOT NULL,            -- resolveBattle() の {events, winner, winnerName}
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_battles_p1 ON battles(p1_user);
CREATE INDEX IF NOT EXISTS idx_battles_p2 ON battles(p2_user);

-- ===== 経済(ガチャチケット) =====
-- 保存は残高のみ。初回20連ぶんを DEFAULT 20 で付与(新規・既存とも初回INSERT時)。
CREATE TABLE IF NOT EXISTS wallets (
  user_id  INTEGER PRIMARY KEY,           -- users.id
  tickets  INTEGER NOT NULL DEFAULT 20
);

-- デイリー受取の冪等記録(1ユーザー1日1回)。day は JST 'YYYY-MM-DD'
CREATE TABLE IF NOT EXISTS daily_claims (
  user_id  INTEGER NOT NULL,
  day      TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- 育成チケット(1日5回の上限を超えて育成できる)。チャレンジ撤退報酬で入手。
CREATE TABLE IF NOT EXISTS train_tickets (
  user_id INTEGER PRIMARY KEY,
  amount  INTEGER NOT NULL DEFAULT 0
);

-- 公開表示名(ニックネーム)。Googleアカウント名は公開しない。未設定は匿名表示。
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id      INTEGER PRIMARY KEY,
  display_name TEXT
);

-- ===== モンスターのメタ情報(お気に入り・ニックネーム) =====
-- 生成には影響しない表示専用の付随情報。monstersへのALTERを避け別テーブルで冪等に。
CREATE TABLE IF NOT EXISTS monster_meta (
  monster_id INTEGER PRIMARY KEY,       -- monsters.id
  favorite   INTEGER NOT NULL DEFAULT 0,
  nickname   TEXT
);

-- ===== 育成の1日制限(モンスターあたり5回/日) =====
CREATE TABLE IF NOT EXISTS train_limits (
  monster_id INTEGER NOT NULL,
  day        TEXT NOT NULL,               -- JST 'YYYY-MM-DD'
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monster_id, day)
);

-- ===== チャレンジ(PvEエンドレス) =====
-- 敵は code "npc|seed|stage" から決定論生成。run開始時に code/train をスナップショット。
CREATE TABLE IF NOT EXISTS challenge_runs (
  id          TEXT PRIMARY KEY,           -- crypto.randomUUID().slice(0,12)
  user_id     INTEGER NOT NULL,
  monster_id  INTEGER NOT NULL,
  code        TEXT NOT NULL,              -- 開始時スナップショット
  train_json  TEXT NOT NULL,              -- 開始時スナップショット
  seed        TEXT NOT NULL,              -- 敵生成シード(run固有)
  stage       INTEGER NOT NULL DEFAULT 1, -- 次に戦うステージ
  score       INTEGER NOT NULL DEFAULT 0, -- 撃破数 = stage - 1
  status      TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'dead'
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
-- 1ユーザー1アクティブランのみ(部分ユニークインデックス)
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_active ON challenge_runs(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_runs_leaderboard ON challenge_runs(status, score DESC);
