import { Chain } from './chain'
import { getConfig } from './config'
import { connect } from './db'
import { PoolWarmer } from './pool'
import { createServer } from './server'
import { Teams } from './teams'

async function main() {
  const config = getConfig()
  await connect(config.databaseUrl)

  const chain = new Chain(config)
  const teams = new Teams()
  new PoolWarmer(config, chain).start()

  createServer(config, teams, chain).listen(config.port, () => {
    console.log(`Dispenser listening on port ${config.port}`)
  })
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
