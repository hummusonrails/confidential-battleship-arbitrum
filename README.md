# cofhe-latency

How long one confidential action takes end to end with Fhenix CoFHE on Arbitrum compared with Ethereum, and the
block times behind the difference.

The action is one Battleship shot: a 64-cell board stored encrypted onchain, a shot at a public cell, hit or miss
computed under FHE, then decrypted and published onchain with its signature. Every reveal is checked against the
board the script made, so a run only passes if CoFHE answered correctly.

## Results (29 October 2026, from Israel)

| Stage (median) | Arbitrum Sepolia | Ethereum Sepolia |
| --- | --- | --- |
| Plain 0 ETH transfer | 0.31 s | 11.38 s |
| `fire`: shot included onchain | 0.46 s | 11.41 s |
| `decrypt`: CoFHE compute and decryption | 1.23 s | 0.22 s |
| `reveal`: result published onchain | 0.38 s | 11.59 s |
| Whole shot | 2.10 s | 25.60 s |

10 shots on Arbitrum Sepolia, 6 on Ethereum Sepolia, every reveal correct. Raw data in `results/`.

On Ethereum, CoFHE usually finishes during the 12 s wait for the next block, so `decrypt` returns at once; CoFHE's
own time is the 1.2 s seen on Arbitrum.

Block times from block timestamps (`blocktimes.py`):

| Network | Sample | Average block time |
| --- | --- | --- |
| Arbitrum One | 200,000 blocks over 15.5 h | 279 ms, up to 8 blocks in one second |
| Arbitrum Sepolia | 200,000 blocks over 14.4 h | 259 ms |
| Ethereum | 2,000 blocks over 6.7 h | 12.08 s, no empty slots in the last 300 |
| Ethereum Sepolia | 2,000 blocks over 6.7 h | 12.01 s, no empty slots in the last 300 |

## How it measures

- Each transaction is prepared and signed before the clock starts. The clock covers sending it until its receipt
  is back.
- Receipts come from `eth_sendRawTransactionSync` (EIP-7966), which returns the receipt in the same call. Polling a
  public Arbitrum RPC for the receipt instead adds about a second that is not the chain's.
- `decrypt` is `decryptForTx(...).withoutACP()` from `@cofhe/sdk`, timed until it returns the value and signature.
- The RPC round trip from the machine running the test (0.1 to 0.2 s here) is included in every transaction time.

## Run it

Needs Node 20+, Foundry, and a funded testnet key on each network you test.

```bash
npm install
forge build
cp .env.example .env   # add PRIVATE_KEY
set -a; . ./.env; set +a
node latency.mjs arbitrum-sepolia 10
node latency.mjs ethereum-sepolia 6
python3 blocktimes.py
```

Versions: `@cofhe/sdk` 1.0.1, `@fhenixprotocol/cofhe-contracts` 1.0.0, Solidity 0.8.25 (cancun).
