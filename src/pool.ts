import { Bee } from '@ethersphere/bee-js'
import { Chain } from './chain'
import { Config } from './config'
import { db } from './db'

export class PoolWarmer {
  private bee: Bee
  private running = false

  constructor(
    private config: Config,
    private chain: Chain,
  ) {
    this.bee = new Bee(config.beeApiUrl)
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
      await this.promoteSyncedBatches()
      await this.refill()
    } catch (error) {
      console.error('Pool tick failed', error)
    } finally {
      this.running = false
    }
  }

  private async promoteSyncedBatches(): Promise<void> {
    const { rows } = await db.query<{ batch_id: string }>("SELECT batch_id FROM batches WHERE status = 'syncing'")

    for (const { batch_id } of rows) {
      const usable = await this.bee.stamp.get(batch_id).then(
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
