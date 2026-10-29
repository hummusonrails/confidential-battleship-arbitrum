// Times one Battleship shot end to end on a CoFHE-supported chain, so Arbitrum and Ethereum can be compared.
//
//   PRIVATE_KEY=0x... node latency.mjs arbitrum-sepolia [shots]
//   PRIVATE_KEY=0x... node latency.mjs ethereum-sepolia [shots]
//
// Every shot is three stages, timed separately:
//   fire     send fire(cell) and wait for its receipt         (chain inclusion)
//   decrypt  decryptForTx on the hit handle until it returns  (CoFHE's offchain compute + Teecryptor)
//   reveal   send reveal(id, hit, signature), wait for receipt (chain inclusion)
// A 0 ETH self-transfer before the shots measures the chain's plain inclusion time on its own, and five
// eth_blockNumber calls measure this machine's round trip to the RPC, which every send and receipt poll pays.
// Results print as a table and are saved to results/<chain>-<time>.json.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, sepolia } from 'viem/chains';
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/node';
import { Encryptable } from '@cofhe/sdk';
import { chains as cofheChains } from '@cofhe/sdk/chains';

const NETWORKS = {
  'arbitrum-sepolia': {
    chain: arbitrumSepolia,
    cofhe: cofheChains.arbSepolia,
    rpc: process.env.ARB_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc',
  },
  'ethereum-sepolia': {
    chain: sepolia,
    cofhe: cofheChains.sepolia,
    rpc: process.env.ETH_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  },
};

const name = process.argv[2];
const shotCount = Number(process.argv[3] ?? 5);
const net = NETWORKS[name];
if (!net || !process.env.PRIVATE_KEY) {
  console.error(`usage: PRIVATE_KEY=0x... node latency.mjs <${Object.keys(NETWORKS).join('|')}> [shots]`);
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(new URL('./out/ShotLatency.sol/ShotLatency.json', import.meta.url)));
const abi = artifact.abi;
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
// A sync send waits for the block, which on Ethereum is 12 s, past viem's 10 s default.
const transport = http(net.rpc, { retryCount: 6, retryDelay: 500, timeout: 60_000 });
const publicClient = createPublicClient({ chain: net.chain, transport });
const walletClient = createWalletClient({ chain: net.chain, transport, account });

const now = () => performance.now();
const secs = (ms) => (ms / 1000).toFixed(2);
const log = (...args) => console.log(`[${name}]`, ...args);

// The transaction is prepared (nonce, gas, fees) and signed before the clock starts, so the time is only what the
// chain adds: from sending the signed transaction to holding its receipt. eth_sendRawTransactionSync (EIP-7966)
// returns the receipt in the same call; polling a public RPC for it instead adds about a second on Arbitrum, where
// the receipt reaches the load-balanced node later than the block is made. Chains without the method fall back
// to polling every 100 ms.
// The nonce is counted here: a load-balanced public node can answer the next nonce request before it has seen the
// transaction that just confirmed, and the reused nonce is rejected.
let syncSupported = process.env.NO_SYNC ? false : true;
let nonce;
async function sendAndWait(request) {
  nonce ??= await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
  // Gas estimation can land on a node that has not seen the previous transaction yet (a reveal estimated before
  // its shot exists reverts), so a revert during preparation is retried for a few seconds. Preparation happens
  // before the clock starts and is not part of any measured time.
  let prepared;
  for (let attempt = 0; ; attempt++) {
    try {
      prepared = await walletClient.prepareTransactionRequest({ ...request, nonce });
      break;
    } catch (error) {
      if (attempt >= 20 || !/revert/i.test(String(error.shortMessage ?? error.message))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  nonce += 1;
  const serializedTransaction = await walletClient.signTransaction(prepared);
  const start = now();
  let receipt;
  if (syncSupported) {
    try {
      receipt = await publicClient.sendRawTransactionSync({ serializedTransaction });
    } catch (error) {
      if (!/method not found|not supported|does not exist|-32601/i.test(String(error.details ?? error.message))) throw error;
      syncSupported = false;
      log('eth_sendRawTransactionSync is not supported here; polling for receipts');
    }
  }
  if (!receipt) {
    const hash = await publicClient.sendRawTransaction({ serializedTransaction });
    receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: 180_000 });
  }
  if (receipt.status !== 'success') throw new Error(`transaction ${receipt.transactionHash} reverted`);
  return { ms: now() - start, receipt };
}

const call = (functionName, args) => ({ to: contract, data: encodeFunctionData({ abi, functionName, args }) });
let contract;

// One eth_blockNumber round trip: the floor that every send and every receipt poll pays from this machine.
async function rpcRoundTrip() {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = now();
    await publicClient.getBlockNumber({ cacheTime: 0 });
    times.push(now() - start);
  }
  return times;
}

async function main() {
  const balance = await publicClient.getBalance({ address: account.address });
  log(`account ${account.address}, balance ${Number(balance) / 1e18} ETH`);
  if (balance === 0n) throw new Error('the account has no ETH on this network');

  const cofhe = createCofheClient(createCofheConfig({ supportedChains: [net.cofhe] }));
  await cofhe.connect(publicClient, walletClient);

  const rtt = await rpcRoundTrip();
  log(`RPC round trip: ${rtt.map(secs).join(', ')} s`);

  const baseline = [];
  for (let i = 0; i < 3; i++) {
    const { ms } = await sendAndWait({ to: account.address, value: 0n });
    baseline.push(ms);
    log(`plain transfer ${i + 1}: ${secs(ms)} s`);
  }

  const deployed = await sendAndWait({ data: artifact.bytecode.object });
  const address = deployed.receipt.contractAddress;
  contract = address;
  log(`deployed ShotLatency at ${address} in ${secs(deployed.ms)} s`);

  // A random board: 64 cells, about 40% of them ships. Kept locally so every reveal can be checked.
  let board = 0n;
  for (let cell = 0; cell < 64; cell++) if (Math.random() < 0.4) board |= 1n << BigInt(cell);

  const encryptStart = now();
  const [boardHash, proof] = await cofhe.encryptInputs([Encryptable.uint64(board)]).setConsumingContract(address).execute();
  const encryptMs = now() - encryptStart;
  const setBoard = await sendAndWait(call('setBoard', [boardHash, proof]));
  log(`board encrypted in ${secs(encryptMs)} s, stored in ${secs(setBoard.ms)} s`);

  // A public RPC can drop a request mid-run. The shots finished before that are kept and summarized, and the run
  // says it stopped early; a wrong reveal still fails the whole run.
  const shots = [];
  let stoppedEarly = '';
  for (let i = 0; i < shotCount; i++) {
   try {
    const cell = Math.floor(Math.random() * 64);
    const expected = ((board >> BigInt(cell)) & 1n) === 1n;

    const fired = await sendAndWait(call('fire', [cell]));
    const [event] = parseEventLogs({ abi, logs: fired.receipt.logs, eventName: 'Shot' });
    const { id, hit: handle } = event.args;

    const decryptStart = now();
    let polls = 0;
    const result = await cofhe.decryptForTx(handle).withoutACP().set404RetryTimeout(60_000)
      .onPoll(() => { polls += 1; }).execute();
    const decryptMs = now() - decryptStart;
    const hit = result.decryptedValue === 1n;
    if (hit !== expected) throw new Error(`shot ${i + 1} at cell ${cell}: CoFHE said ${hit}, the board says ${expected}`);

    const revealed = await sendAndWait(call('reveal', [id, hit, result.signature]));

    const shot = { cell, hit, fireMs: fired.ms, decryptMs, revealMs: revealed.ms, polls,
      totalMs: fired.ms + decryptMs + revealed.ms };
    shots.push(shot);
    log(`shot ${i + 1} at cell ${cell}: ${hit ? 'HIT' : 'miss'} | fire ${secs(shot.fireMs)} s, ` +
        `decrypt ${secs(decryptMs)} s (${polls} polls), reveal ${secs(revealed.ms)} s, total ${secs(shot.totalMs)} s`);
   } catch (error) {
    if (/CoFHE said/.test(error.message) || !shots.length) throw error;
    stoppedEarly = `stopped after ${shots.length} shots: ${error.shortMessage ?? error.message}`;
    log(stoppedEarly);
    break;
   }
  }

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const row = (label, values) =>
    `${label.padEnd(16)} median ${secs(median(values)).padStart(6)} s   min ${secs(Math.min(...values)).padStart(6)} s   max ${secs(Math.max(...values)).padStart(6)} s`;

  console.log(`\n${name}: ${shots.length} shots${stoppedEarly ? ` (${stoppedEarly})` : ''}, every reveal matched the board, receipts by ${syncSupported ? 'eth_sendRawTransactionSync' : 'polling'}`);
  console.log(row('RPC round trip', rtt));
  console.log(row('plain transfer', baseline));
  console.log(row('fire', shots.map((s) => s.fireMs)));
  console.log(row('decrypt', shots.map((s) => s.decryptMs)));
  console.log(row('reveal', shots.map((s) => s.revealMs)));
  console.log(row('shot total', shots.map((s) => s.totalMs)));

  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  const file = new URL(`./results/${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ network: name, receipts: syncSupported ? 'eth_sendRawTransactionSync' : 'polling', contract: address, account: account.address, rpc: net.rpc, rpcRoundTripMs: rtt, baselineMs: baseline,
    deployMs: deployed.ms, encryptMs, setBoardMs: setBoard.ms, stoppedEarly, shots }, null, 2));
  console.log(`saved ${file.pathname}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`[${name}] failed:`, error.shortMessage ?? error.message ?? error);
  process.exit(1);
});
