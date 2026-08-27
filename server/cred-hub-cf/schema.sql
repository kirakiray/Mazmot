-- cred-hub-cf 数据库结构（与 Rust 版语义对齐）
-- 初始化：npm run init-db:local（本地）/ npm run init-db:remote（线上）

-- 凭证存储：key = 记录 id（role-issuer-subject），cred 为完整 JSON 原文
CREATE TABLE IF NOT EXISTS creds (
  key TEXT PRIMARY KEY,
  cred TEXT NOT NULL,
  last_access_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creds_last_access ON creds(last_access_ms);

-- 配对码卡片：code 即字面配对码（6/8 位自适应，长短混存）
CREATE TABLE IF NOT EXISTS pairing_cards (
  code TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  card TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pairing_subject ON pairing_cards(subject);

-- resolve 未命中限流计数（每 IP 分钟级固定窗口；成功解析不计数）
CREATE TABLE IF NOT EXISTS resolve_fails (
  ip TEXT NOT NULL,
  minute INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ip, minute)
);

-- 系统元数据（pairing-secret 等）
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v BLOB NOT NULL
);
