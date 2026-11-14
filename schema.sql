
CREATE TABLE IF NOT EXISTS users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance NUMERIC(24,9) NOT NULL DEFAULT 0,
  energy NUMERIC(12,2) NOT NULL DEFAULT 1000,
  max_energy NUMERIC(12,2) NOT NULL DEFAULT 1000,
  hourly_rate NUMERIC(24,9) NOT NULL DEFAULT 0,
  energy_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  type TEXT NOT NULL,
  amount NUMERIC(24,9) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_user_idx
ON transactions(telegram_id, created_at DESC);
