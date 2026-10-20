import express, { NextFunction, Request, Response } from 'express'
import { timingSafeEqual } from 'crypto'
import { Chain } from './chain'
import { Config } from './config'
import { db } from './db'
import { HttpError, Mode, Teams, getSettings, setSettings } from './teams'

const MAX_TEAM_NAME_LENGTH = 64
const HOUR_MS = 60 * 60 * 1000

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)

  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB)
}

function basicAuth(config: Config) {
  const expected = `Basic ${Buffer.from(`${config.adminUsername}:${config.adminPassword}`).toString('base64')}`

  return (req: Request, res: Response, next: NextFunction) => {
    if (safeEqual(req.headers.authorization ?? '', expected)) {
      next()

      return
    }
    res.status(401).json({ error: 'Unauthorized' })
  }
}

function rateLimit(limit: number) {
  const hits = new Map<string, number[]>()

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const ip = req.ip ?? 'unknown'
    const recent = (hits.get(ip) ?? []).filter(time => time > now - HOUR_MS)

    if (recent.length >= limit) {
      res.status(429).json({ error: 'Too many requests, try again later' })

      return
    }
    hits.set(ip, [...recent, now])
    next()
  }
}

function bearerToken(req: Request): string {
  const token = req.headers.authorization?.replace(/^Bearer /, '')

  if (!token) {
    throw new HttpError(401, 'Missing token')
  }

  return token
}

export function createServer(config: Config, teams: Teams, chain: Chain) {
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', config.corsOrigin)
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')

    if (req.method === 'OPTIONS') {
      res.sendStatus(204)

      return
    }
    next()
  })

  app.get('/health', (_req, res) => res.sendStatus(200))

  app.post('/api/teams', rateLimit(config.requestsPerIpPerHour), async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''

    if (!name || name.length > MAX_TEAM_NAME_LENGTH) {
      throw new HttpError(400, `Team name must be 1-${MAX_TEAM_NAME_LENGTH} characters`)
    }
    res.json(await teams.request(name, req.ip ?? ''))
  })

  app.get('/api/info', (_req, res) => {
    res.json({ gatewayUrl: config.publicGatewayUrl })
  })

  app.get('/api/teams/me', async (req, res) => {
    res.json(await teams.status(bearerToken(req)))
  })

  app.get('/swarm-postage-token-resolver', async (req, res) => {
    if (!safeEqual(req.headers.authorization ?? '', `Bearer ${config.gatewaySecret}`)) {
      throw new HttpError(401, 'Unauthorized')
    }
    const token = req.get('X-Swarm-Postage-Token')

    if (!token) {
      throw new HttpError(400, 'Missing X-Swarm-Postage-Token header')
    }
    res.json({ batchId: await teams.batchIdForToken(token) })
  })

  const admin = express.Router()
  admin.use(basicAuth(config))

  admin.get('/api/state', async (_req, res) => {
    const [settings, teamList, pool, wallet] = await Promise.all([
      getSettings(),
      teams.list(),
      db.query('SELECT status, count(*)::int AS count FROM batches GROUP BY status'),
      chain.getBalance().catch(error => ({ error: String(error) })),
    ])
    res.json({
      settings,
      teams: teamList,
      pool: Object.fromEntries(pool.rows.map(row => [row.status, row.count])),
      poolSize: config.poolSize,
      wallet,
    })
  })

  admin.put('/api/settings', async (req, res) => {
    const mode: Mode = req.body?.mode === 'auto' ? 'auto' : 'manual'
    await setSettings(mode, req.body?.autoUntil ? new Date(req.body.autoUntil) : null)
    res.json(await getSettings())
  })

  admin.post('/api/teams/:id/approve', async (req, res) => {
    await teams.approve(Number(req.params.id))
    res.sendStatus(204)
  })

  admin.post('/api/teams/:id/revoke', async (req, res) => {
    await teams.revoke(Number(req.params.id))
    res.sendStatus(204)
  })

  admin.post('/api/teams/:id/reissue', async (req, res) => {
    res.json({ token: await teams.reissue(Number(req.params.id)) })
  })

  app.use('/admin', admin)

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message })

      return
    }
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
