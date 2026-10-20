import {
  Contract,
  ContractTransactionReceipt,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  hexlify,
  randomBytes,
} from 'ethers'
import { Config } from './config'

const BZZ_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]

const POSTAGE_STAMP_ABI = [
  'function createBatch(address _owner, uint256 _initialBalancePerChunk, uint8 _depth, uint8 _bucketDepth, bytes32 _nonce, bool _immutable) returns (bytes32)',
  'function lastPrice() view returns (uint64)',
  'function minimumInitialBalancePerChunk() view returns (uint256)',
]

const BUCKET_DEPTH = 16
const CONFIRMATIONS = 3
const BZZ_DECIMALS = 16
const GNOSIS_BLOCK_TIME_SECONDS = 5

export interface PurchasedBatch {
  batchId: string
  txHash: string
}

export interface WalletBalance {
  address: string
  xdai: string
  bzz: string
}

export class Chain {
  private wallet: Wallet
  private bzz: Contract
  private postageStamp: Contract

  constructor(private config: Config) {
    const provider = new JsonRpcProvider(config.jsonRpcUrl)
    this.wallet = new Wallet(config.walletPrivateKey, provider)
    this.bzz = new Contract(config.bzzAddress, BZZ_ABI, this.wallet)
    this.postageStamp = new Contract(config.postageStampAddress, POSTAGE_STAMP_ABI, this.wallet)
  }

  async getAmountForDays(days: number): Promise<bigint> {
    const [price, minimum] = (await Promise.all([
      this.postageStamp.lastPrice!(),
      this.postageStamp.minimumInitialBalancePerChunk!(),
    ])) as [bigint, bigint]
    const blocks = BigInt(Math.ceil((days * 86400) / GNOSIS_BLOCK_TIME_SECONDS))
    const amount = blocks * price + 1n

    if (amount < minimum) {
      throw Error(
        `BATCH_TTL_DAYS=${days} is below the contract minimum of ${(Number(minimum / price) * GNOSIS_BLOCK_TIME_SECONDS) / 86400} days`,
      )
    }

    return amount
  }

  async buyBatch(depth: number, amount: bigint): Promise<PurchasedBatch> {
    const cost = 2n ** BigInt(depth) * amount
    const balance = (await this.bzz.balanceOf!(this.wallet.address)) as bigint

    if (balance < cost) {
      throw Error(
        `Batch costs ${formatUnits(cost, BZZ_DECIMALS)} xBZZ but the wallet holds ${formatUnits(balance, BZZ_DECIMALS)}`,
      )
    }
    const allowance = (await this.bzz.allowance!(this.wallet.address, this.config.postageStampAddress)) as bigint

    if (allowance < cost) {
      const approve = await this.bzz.approve!(this.config.postageStampAddress, cost)
      await approve.wait(CONFIRMATIONS)
    }

    const create = await this.postageStamp.createBatch!(
      this.config.gatewayOwnerAddress,
      amount,
      depth,
      BUCKET_DEPTH,
      hexlify(randomBytes(32)),
      false,
    )
    const receipt = (await create.wait(CONFIRMATIONS)) as ContractTransactionReceipt
    const log = receipt.logs.find(x => x.address.toLowerCase() === this.config.postageStampAddress.toLowerCase())
    const batchId = log?.topics[1]

    if (!batchId) {
      throw Error(`No batch created event in tx ${receipt.hash}`)
    }

    return { batchId: batchId.slice(2), txHash: receipt.hash }
  }

  async getBalance(): Promise<WalletBalance> {
    const [xdai, bzz] = await Promise.all([
      this.wallet.provider!.getBalance(this.wallet.address),
      this.bzz.balanceOf!(this.wallet.address) as Promise<bigint>,
    ])

    return {
      address: this.wallet.address,
      xdai: formatEther(xdai),
      bzz: formatUnits(bzz, BZZ_DECIMALS),
    }
  }
}
