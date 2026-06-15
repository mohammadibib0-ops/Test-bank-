PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  label TEXT,
  student_name TEXT,
  device_key_jwk TEXT,
  device_fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  activated_at TEXT,
  last_login_at TEXT,
  expires_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_device ON licenses(device_fingerprint);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  license_id INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(license_id) REFERENCES licenses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_challenges_license ON challenges(license_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  license_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_hash TEXT,
  ua_hash TEXT,
  FOREIGN KEY(license_id) REFERENCES licenses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_license ON sessions(license_id);
CREATE INDEX IF NOT EXISTS idx_sessions_seen ON sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS request_nonces (
  nonce_hash TEXT PRIMARY KEY,
  license_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(license_id) REFERENCES licenses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_request_nonces_expiry ON request_nonces(expires_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  chapter INTEGER NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mcq',
  text TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  source TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(chapter,active);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  license_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(license_id) REFERENCES licenses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attempts_license ON attempts(license_id,created_at);

CREATE TABLE IF NOT EXISTS student_activity (
  license_id INTEGER PRIMARY KEY,
  last_logout_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_question_progress (
  license_id INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  first_answered_at TEXT NOT NULL,
  last_answered_at TEXT NOT NULL,
  times_answered INTEGER NOT NULL DEFAULT 1,
  best_correct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (license_id, question_id),
  FOREIGN KEY(license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_student_progress_license ON student_question_progress(license_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
