import { createHash, randomBytes } from 'crypto'
import { PoolClient } from 'pg'
import { db, transaction } from './db'

export type Mode = 'auto' | 'manual'

export interface Settings {
  mode: Mode
  autoUntil: Date | null
}

export interface TeamStatus {
  name: string
  status: 'pending' | 'approved' | 'revoked'
  batchId: string | null
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function getSettings(): Promise<Settings> {
  const { rows } = await db.query('SELECT mode, auto_until FROM settings WHERE id = 1')
  const row = rows[0]

  if (row.mode === 'auto' && (!row.auto_until || row.auto_until <= new Date())) {
    await db.query("UPDATE settings SET mode = 'manual' WHERE id = 1")

    return { mode: 'manual', autoUntil: row.auto_until }
  }

  return { mode: row.mode, autoUntil: row.auto_until }
}

export async function setSettings(mode: Mode, autoUntil: Date | null): Promise<void> {
  if (mode === 'auto' && (!autoUntil || autoUntil <= new Date())) {
    throw new HttpError(400, 'Auto mode requires an end date in the future')
  }
  await db.query('UPDATE settings SET mode = $1, auto_until = $2 WHERE id = 1', [
    mode,
    mode === 'auto' ? autoUntil : null,
  ])
}

export class Teams {
  async request(name: string, ip: string): Promise<{ token: string; team: TeamStatus }> {
    const token = generateToken()
    const tokenHash = hashToken(token)
    const { rows } = await db.query<{ id: number }>(
      "INSERT INTO teams (name, token_hash, status, ip) VALUES ($1, $2, 'pending', $3) RETURNING id",
      [name, tokenHash, ip],
    )
    const id = rows[0]!.id

    if ((await getSettings()).mode === 'auto') {
      await this.tryAssign(id)
    }

    return { token, team: await this.statusByHash(tokenHash) }
  }

  async status(token: string): Promise<TeamStatus> {
    return this.statusByHash(hashToken(token))
  }

  async approve(id: number): Promise<void> {
    if (!(await this.tryAssign(id))) {
      throw new HttpError(409, 'Team is not pending or the pool is empty')
    }
  }

  async batchIdForToken(token: string): Promise<string> {
    const { rows } = await db.query<{ batch_id: string }>(
      "SELECT batch_id FROM teams WHERE token_hash = $1 AND status = 'approved'",
      [hashToken(token)],
    )

    if (!rows[0]) {
      throw new HttpError(404, 'Unknown or inactive token')
    }

    return rows[0].batch_id
  }

  async revoke(id: number): Promise<void> {
    await this.updateTeam("UPDATE teams SET status = 'revoked' WHERE id = $1", [id])
  }

  async reissue(id: number): Promise<string> {
    const token = generateToken()
    await this.updateTeam('UPDATE teams SET token_hash = $2 WHERE id = $1', [id, hashToken(token)])

    return token
  }

  async list() {
    const { rows } = await db.query(
      `SELECT t.id, t.name, t.status, t.batch_id, t.ip, t.created_at, t.approved_at,
              count(*) OVER (PARTITION BY lower(t.name)) > 1 AS duplicate_name
       FROM teams t ORDER BY t.created_at DESC`,
    )

    return rows
  }

  private async tryAssign(id: number): Promise<boolean> {
    return transaction(async client => {
      const team = await this.lockTeam(client, id)

      if (team.status !== 'pending') {
        return false
      }

      const { rows } = await client.query<{ batch_id: string }>(
        "SELECT batch_id FROM batches WHERE status = 'available' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      )
      const batch = rows[0]

      if (!batch) {
        return false
      }

      await client.query("UPDATE batches SET status = 'assigned' WHERE batch_id = $1", [batch.batch_id])
      await client.query("UPDATE teams SET status = 'approved', batch_id = $1, approved_at = now() WHERE id = $2", [
        batch.batch_id,
        id,
      ])

      return true
    })
  }

  private async updateTeam(query: string, params: unknown[]): Promise<void> {
    const { rowCount } = await db.query(query, params)

    if (!rowCount) {
      throw new HttpError(404, 'Team not found')
    }
  }

  private async lockTeam(client: PoolClient, id: number) {
    const { rows } = await client.query('SELECT * FROM teams WHERE id = $1 FOR UPDATE', [id])

    if (!rows[0]) {
      throw new HttpError(404, 'Team not found')
    }

    return rows[0]
  }

  private async statusByHash(tokenHash: string): Promise<TeamStatus> {
    const { rows } = await db.query('SELECT name, status, batch_id FROM teams WHERE token_hash = $1', [tokenHash])

    if (!rows[0]) {
      throw new HttpError(404, 'Unknown token')
    }

    return { name: rows[0].name, status: rows[0].status, batchId: rows[0].batch_id }
  }
}
