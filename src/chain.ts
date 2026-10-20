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
  'function balanceOf(address owner) view returns (uint256)',
]

const POSTAGE_STAMP_ABI = [
  'function createBatch(address _owner, uint256 _initialBalancePerChunk, uint8 _depth, uint8 _bucketDepth, bytes32 _nonce, bool _immutable) returns (bytes32)',
]

const BUCKET_DEPTH = 16
const CONFIRMATIONS = 3
const BZZ_DECIMALS = 16

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

  async buyBatch(depth: number, amount: bigint): Promise<PurchasedBatch> {
    const cost = 2n ** BigInt(depth) * amount
    const approve = await this.bzz.approve!(this.config.postageStampAddress, cost)
    await approve.wait(CONFIRMATIONS)

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
