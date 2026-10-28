export interface Config {
  port: number
  databaseUrl: string
  adminUsername: string
  adminPassword: string
  beeApiUrl: string
  publicGatewayUrl: string
  corsOrigin: string
  gatewaySecret: string
  gatewayOwnerAddress: string
  walletPrivateKey: string
  jsonRpcUrl: string
  bzzAddress: string
  postageStampAddress: string
  poolSize: number
  batchDepth: number
  batchTtlDays: number
  poolIntervalSeconds: number
  batchReadyMinutes: number
  requestsPerIpPerHour: number
}

function required(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw Error(`Missing required environment variable ${name}`)
  }

  return value
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback
}

export function getConfig(): Config {
  return {
    port: Number(optional('PORT', '3000')),
    databaseUrl: required('DATABASE_URL'),
    adminUsername: required('ADMIN_USERNAME'),
    adminPassword: required('ADMIN_PASSWORD'),
    beeApiUrl: optional('BEE_API_URL', ''),
    publicGatewayUrl: optional('PUBLIC_GATEWAY_URL', 'https://api.gateway.ethswarm.org'),
    corsOrigin: optional('CORS_ORIGIN', '*'),
    gatewaySecret: required('GATEWAY_SECRET'),
    gatewayOwnerAddress: required('GATEWAY_OWNER_ADDRESS'),
    walletPrivateKey: required('WALLET_PRIVATE_KEY'),
    jsonRpcUrl: optional('JSON_RPC_URL', 'https://xdai.fairdatasociety.org'),
    bzzAddress: optional('BZZ_ADDRESS', '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da'),
    postageStampAddress: optional('POSTAGE_STAMP_ADDRESS', '0x45a1502382541Cd610CC9068e88727426b696293'),
    poolSize: Number(optional('POOL_SIZE', '5')),
    batchDepth: Number(optional('BATCH_DEPTH', '22')),
    batchTtlDays: Number(optional('BATCH_TTL_DAYS', '30')),
    poolIntervalSeconds: Number(optional('POOL_INTERVAL_SECONDS', '60')),
    batchReadyMinutes: Number(optional('BATCH_READY_MINUTES', '10')),
    requestsPerIpPerHour: Number(optional('REQUESTS_PER_IP_PER_HOUR', '5')),
  }
}
