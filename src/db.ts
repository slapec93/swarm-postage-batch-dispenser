import { Pool, PoolClient } from 'pg'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS batches (
  id SERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('syncing', 'available', 'assigned')),
  depth INTEGER NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'revoked')),
  batch_id TEXT REFERENCES batches (batch_id),
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL CHECK (mode IN ('auto', 'manual')),
  auto_until TIMESTAMPTZ
);

INSERT INTO settings (id, mode) VALUES (1, 'manual') ON CONFLICT DO NOTHING;
`

export let db: Pool

export async function connect(databaseUrl: string): Promise<void> {
  db = new Pool({ connectionString: databaseUrl })
  await db.query(SCHEMA)
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()

  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')

    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
