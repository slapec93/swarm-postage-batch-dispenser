# Swarm Postage Batch Dispenser

Hands out gateway-owned postage batches to hackathon teams. Teams get a token which the gateway maps to their batch.

## Run

```sh
docker compose up -d
cp .env.example .env   # fill in
npm install
npm run build
node --env-file=.env dist/index.js
```

- Prod: `docker compose -f compose.prod.yaml up -d --build` (joins the external `edge` and `swarm` networks like the gateway)

## Frontend

`frontend/` is a static site uploaded to Swarm. Set the API URL in `frontend/config.js` first, then:

```sh
swarm-cli upload frontend --stamp <batch-id> --index-document index.html
```

- User page: `index.html`
- Admin page: `admin.html` (logs in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`)

## Gateway contract

The gateway resolves a team token by calling the dispenser:

```
GET /swarm-postage-token-resolver
Authorization: Bearer $GATEWAY_SECRET
X-Swarm-Postage-Token: <team token>
```

- `200 { "batchId": "<hex>" }` for an approved team
- `404` for unknown, pending or revoked tokens
- `401` for a wrong gateway secret

`POSTAGE_DISPENSER_URL` is the dispenser's base URL without a path; the gateway appends `/swarm-postage-token-resolver`.

The gateway stamps with the returned batch, rejects requests whose token does not resolve, and always ignores a client-supplied `swarm-postage-batch-id`. Any caching on the gateway side delays revocation by the cache TTL.
