import { Bee } from '@ethersphere/bee-js'
import { Chain } from './chain'
import { Config } from './config'
import { db } from './db'

export class PoolWarmer {
  private bee: Bee | null
  private running = false

  constructor(
    private config: Config,
    private chain: Chain,
  ) {
    this.bee = config.beeApiUrl ? new Bee(config.beeApiUrl) : null
  }

  start(): void {
    void this.tick()
    setInterval(() => void this.tick(), this.config.poolIntervalSeconds * 1000)
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true

    try {
      if (this.bee && !(await this.beeNodeIsBatchOwner(this.bee))) {
        return
      }
      await this.promoteSyncedBatches()
      await this.refill()
    } catch (error) {
      console.error('Pool tick failed', error)
    } finally {
      this.running = false
    }
  }

  private async beeNodeIsBatchOwner(bee: Bee): Promise<boolean> {
    const { ethereum } = await bee.connectivity.getNodeAddresses()
    const nodeAddress = ethereum.toHex().replace(/^0x/, '').toLowerCase()
    const ownerAddress = this.config.gatewayOwnerAddress.replace(/^0x/, '').toLowerCase()

    if (nodeAddress !== ownerAddress) {
      console.error(
        `BEE_API_URL node is 0x${nodeAddress} but GATEWAY_OWNER_ADDRESS is 0x${ownerAddress}; not buying or promoting batches`,
      )
    }

    return nodeAddress === ownerAddress
  }

  private async promoteSyncedBatches(): Promise<void> {
    if (!this.bee) {
      const { rows } = await db.query<{ batch_id: string }>(
        "UPDATE batches SET status = 'available' WHERE status = 'syncing' AND created_at <= now() - make_interval(mins => $1) RETURNING batch_id",
        [this.config.batchReadyMinutes],
      )
      rows.forEach(({ batch_id }) =>
        console.log(`Batch ${batch_id} is available after ${this.config.batchReadyMinutes} minutes`),
      )

      return
    }
    const bee = this.bee
    const { rows } = await db.query<{ batch_id: string }>("SELECT batch_id FROM batches WHERE status = 'syncing'")

    for (const { batch_id } of rows) {
      const usable = await bee.stamp.get(batch_id).then(
        batch => batch.usable,
        () => false,
      )

      if (usable) {
        await db.query("UPDATE batches SET status = 'available' WHERE batch_id = $1", [batch_id])
        console.log(`Batch ${batch_id} is usable on the gateway node`)
      }
    }
  }

  private async refill(): Promise<void> {
    const { rows } = await db.query<{ count: string }>(
      "SELECT count(*) FROM batches WHERE status IN ('syncing', 'available')",
    )

    if (Number(rows[0]!.count) >= this.config.poolSize) {
      return
    }

    const amount = await this.chain.getAmountForDays(this.config.batchTtlDays)
    console.log(`Buying batch with depth ${this.config.batchDepth} and amount ${amount}`)
    const { batchId, txHash } = await this.chain.buyBatch(this.config.batchDepth, amount)
    await db.query(
      "INSERT INTO batches (batch_id, status, depth, amount, tx_hash) VALUES ($1, 'syncing', $2, $3, $4)",
      [batchId, this.config.batchDepth, amount.toString(), txHash],
    )
    console.log(`Bought batch ${batchId} in tx ${txHash}`)
  }
}
