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

- User page: `/`
- Admin page: `/admin` (HTTP basic auth)

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

The gateway stamps with the returned batch, rejects requests whose token does not resolve, and always ignores a client-supplied `swarm-postage-batch-id`. Any caching on the gateway side delays revocation by the cache TTL.
