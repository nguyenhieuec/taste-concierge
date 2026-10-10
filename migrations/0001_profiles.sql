-- One row per browser: the seeds it searched with and the last city and venue, so follow-ups need fewer words.
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
