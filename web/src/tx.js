import { keccak256 } from 'viem';

// Sends transactions and returns their receipts as fast as the chain allows. Shared by the browser game and
// selfplay.mjs.
//
// - The transaction is prepared and signed before the clock starts, so `ms` is only what the chain adds.
// - eth_sendRawTransactionSync (EIP-7966) returns the receipt in the same call; polling a public RPC instead adds
//   about a second on Arbitrum. Chains without it fall back to polling every 100 ms.
// - The nonce is counted locally: a load-balanced public node can return a stale one right after a confirmation.
// - Preparing a transaction costs several RPC round trips (gas estimate, fees), which a player would feel on every
//   shot. A function's gas limit is estimated once and reused with 50% headroom (unused gas is not charged), and
//   fees are refreshed in the background every 30 s with 2x headroom on the base fee.
// - Gas estimation can land on a node that has not seen the previous transaction yet, so a revert while preparing
//   is retried for a few seconds.

export function createSender({ publicClient, walletClient, onLog = () => {} }) {
  const account = walletClient.account;
  let syncSupported = true;
  let nonce;
  let queue = Promise.resolve();
  const gasByFunction = new Map();
  let fees;
  let feesAt = 0;

  async function refreshFees() {
    const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();
    fees = { maxFeePerGas: maxFeePerGas * 2n, maxPriorityFeePerGas };
    feesAt = performance.now();
  }

  async function prepare(request) {
    const key = request.to && request.data ? `${request.to}${request.data.slice(0, 10)}` : null;
    const gas = key && gasByFunction.get(key);
    if (gas && fees) {
      if (performance.now() - feesAt > 30_000) refreshFees().catch(() => {});
      return { key, prepared: { ...request, nonce, gas, ...fees, type: 'eip1559', chainId: walletClient.chain.id } };
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const prepared = await walletClient.prepareTransactionRequest({ ...request, nonce });
        if (key) gasByFunction.set(key, (prepared.gas * 3n) / 2n);
        if (!fees) await refreshFees();
        return { key, prepared };
      } catch (error) {
        if (attempt >= 20 || !/revert/i.test(String(error.shortMessage ?? error.message))) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  async function send(request) {
    nonce ??= await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const { key, prepared } = await prepare(request);
    nonce += 1;
    let receipt;
    let start;
    try {
      const serializedTransaction = await walletClient.signTransaction(prepared);
      start = performance.now();
      if (syncSupported) {
        try {
          receipt = await publicClient.sendRawTransactionSync({ serializedTransaction });
        } catch (error) {
          if (/method not found|not supported|does not exist|-32601/i.test(String(error.details ?? error.message))) {
            syncSupported = false;
            onLog('eth_sendRawTransactionSync is not supported here; polling for receipts');
          } else {
            // The call can end (a gateway timeout, a dropped connection) after the transaction was accepted, so the
            // receipt is looked up by hash before the send counts as failed.
            try {
              receipt = await publicClient.waitForTransactionReceipt({ hash: keccak256(serializedTransaction), pollingInterval: 250, timeout: 45_000 });
            } catch {
              throw error;
            }
          }
        }
      }
      if (!receipt) {
        const hash = await publicClient.sendRawTransaction({ serializedTransaction });
        receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: 180_000 });
      }
    } catch (error) {
      // Rejected or unconfirmed: the node's pending count decides the next nonce, so a rejected transaction leaves no
      // gap and an accepted one is not reused.
      nonce = undefined;
      throw error;
    }
    if (receipt.status !== 'success') {
      if (key) gasByFunction.delete(key);
      throw new Error(`transaction ${receipt.transactionHash} reverted`);
    }
    return { ms: performance.now() - start, receipt };
  }

  // One transaction at a time per account, so local nonces never race.
  const enqueue = (request) => {
    const result = queue.then(() => send(request));
    queue = result.catch(() => {});
    return result;
  };
  // Estimates a call's gas and the fees ahead of time, so its first real send skips that round trip.
  enqueue.warm = async (request) => {
    const key = `${request.to}${request.data.slice(0, 10)}`;
    if (gasByFunction.has(key)) return;
    const [gas] = await Promise.all([
      publicClient.estimateGas({ ...request, account }),
      fees ? null : refreshFees(),
    ]);
    gasByFunction.set(key, (gas * 3n) / 2n);
  };
  return enqueue;
}

// decryptForTx on a publicly allowed handle. A transient network error is retried with a short backoff, so one
// dropped request never costs the player a shot.
export async function decryptPublic(cofhe, handle, { attempts = 5 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await cofhe.decryptForTx(handle).withoutACP().set404RetryTimeout(60_000).execute();
    } catch (error) {
      if (attempt >= attempts || !/HTTP (403|429|5\d\d)|fetch failed|network/i.test(String(error.message))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}
