// Plays one full game of Battleship against the encrypted house fleet, headless, and checks what CoFHE revealed:
// every sector holds one straight ship of the right length, and SUNK arrives exactly on its last cell.
//
//   PRIVATE_KEY=0x... node selfplay.mjs arbitrum-sepolia            deploy Battleship, then play
//   PRIVATE_KEY=0x... node selfplay.mjs arbitrum-sepolia --deploy   deploy and write web/src/deployments.json only
//
// Without --deploy, the address in web/src/deployments.json is used when there is one.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/node';
import { createSender, decryptPublic } from './web/src/tx.js';
import { NETWORKS } from './web/src/networks.js';

const name = process.argv[2];
const deployOnly = process.argv.includes('--deploy');
const net = NETWORKS[name];
if (!net || !process.env.PRIVATE_KEY) {
  console.error(`usage: PRIVATE_KEY=0x... node selfplay.mjs <${Object.keys(NETWORKS).join('|')}> [--deploy]`);
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(new URL('./out/Battleship.sol/Battleship.json', import.meta.url)));
const abi = artifact.abi;
const deploymentsFile = new URL('./web/src/deployments.json', import.meta.url);
const deployments = existsSync(deploymentsFile) ? JSON.parse(readFileSync(deploymentsFile)) : {};

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const transport = http(process.env[net.rpcEnv] || net.rpc, { retryCount: 6, retryDelay: 500, timeout: 60_000 });
const publicClient = createPublicClient({ chain: net.chain, transport });
const walletClient = createWalletClient({ chain: net.chain, transport, account });
const log = (...args) => console.log(`[${name}]`, ...args);
const send = createSender({ publicClient, walletClient, onLog: log });
const secs = (ms) => (ms / 1000).toFixed(2);

const RESULT = ['miss', 'HIT', 'SUNK'];
const shipLength = (sector) => (sector === 0 ? 4 : sector === 3 ? 2 : 3);
const sectorOf = (cell) => Math.floor(cell / 32) * 2 + Math.floor((cell % 8) / 4);

async function main() {
  let contract = deployments[name];
  if (deployOnly || !contract) {
    const deployed = await send({ data: artifact.bytecode.object });
    contract = deployed.receipt.contractAddress;
    deployments[name] = contract;
    writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2) + '\n');
    log(`deployed Battleship at ${contract} in ${secs(deployed.ms)} s (gas ${deployed.receipt.gasUsed})`);
    if (deployOnly) process.exit(0);
  }
  const call = (functionName, args) => ({ to: contract, data: encodeFunctionData({ abi, functionName, args }) });

  const cofhe = createCofheClient(createCofheConfig({ supportedChains: [net.cofhe] }));
  await cofhe.connect(publicClient, walletClient);

  const started = await send(call('newGame', []));
  const [{ args: { gameId } }] = parseEventLogs({ abi, logs: started.receipt.logs, eventName: 'GameStarted' });
  log(`game ${gameId} started in ${secs(started.ms)} s (gas ${started.receipt.gasUsed})`);

  const gameStart = performance.now();
  const cells = [...Array(64).keys()].sort(() => Math.random() - 0.5);
  const hits = [[], [], [], []];
  const sunk = [false, false, false, false];
  const totals = [];
  let lastBlock = started.receipt.blockNumber;
  for (const cell of cells) {
    const shotStart = performance.now();
    const fired = await send(call('fire', [gameId, cell]));
    const [{ args: { result: handle } }] = parseEventLogs({ abi, logs: fired.receipt.logs, eventName: 'Shot' });
    const decryptStart = performance.now();
    const decrypted = await decryptPublic(cofhe, handle);
    const decryptMs = performance.now() - decryptStart;
    const result = Number(decrypted.decryptedValue);
    const revealed = await send(call('reveal', [gameId, result, decrypted.signature]));
    lastBlock = revealed.receipt.blockNumber;

    const sector = sectorOf(cell);
    if (result !== 0) {
      if (sunk[sector]) throw new Error(`cell ${cell} hit a ship in sector ${sector}, which was already sunk`);
      hits[sector].push(cell);
    }
    const complete = hits[sector].length === shipLength(sector);
    if ((result === 2) !== (result !== 0 && complete)) {
      throw new Error(`cell ${cell}: ${RESULT[result]} after ${hits[sector].length} hits on a ${shipLength(sector)}-cell ship`);
    }
    if (result === 2) {
      const sorted = hits[sector].sort((a, b) => a - b);
      const step = sorted[1] - sorted[0];
      if (![1, 8].includes(step) || sorted.some((c, i) => c !== sorted[0] + i * step)) {
        throw new Error(`sector ${sector} ship is not a straight line: ${sorted.join(', ')}`);
      }
      sunk[sector] = true;
    }
    // Wall clock from preparing fire to the reveal's receipt, so preparation and retries count too.
    const total = performance.now() - shotStart;
    totals.push(total);
    log(`shot ${totals.length} at ${'ABCDEFGH'[cell % 8]}${Math.floor(cell / 8) + 1}: ${RESULT[result].padEnd(4)} | ` +
        `fire ${secs(fired.ms)} s, decrypt ${secs(decryptMs)} s, reveal ${secs(revealed.ms)} s, total ${secs(total)} s`);
    if (sunk.every(Boolean)) break;
  }

  // The contract must agree: every ship sunk, every hit recorded, and the Won event emitted. It is read at the last
  // reveal's block, retrying while a load-balanced RPC node has not seen that block yet.
  const atLastBlock = async (read) => {
    for (let attempt = 1; ; attempt++) {
      try { return await read(); } catch (error) {
        if (attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };
  const [, shotMask, hitMask, sunkMask, shots, pending] = await atLastBlock(() =>
    publicClient.readContract({ address: contract, abi, functionName: 'getGame', args: [gameId], blockNumber: lastBlock }));
  const hitCount = [...hitMask.toString(2)].filter((bit) => bit === '1').length;
  const won = await atLastBlock(() =>
    publicClient.getContractEvents({ address: contract, abi, eventName: 'Won', args: { gameId }, fromBlock: started.receipt.blockNumber, toBlock: lastBlock }));
  const checks = [
    [sunk.every(Boolean), `only ${sunk.filter(Boolean).length} of 4 ships sank`],
    [hits.every((h, sector) => h.length === shipLength(sector)), `hits per sector ${hits.map((h) => h.length).join('/')}`],
    [sunkMask === 15, `contract sunkMask is ${sunkMask}`],
    [hitCount === 12, `contract recorded ${hitCount} hits, expected 12`],
    [Number(shots) === totals.length && !pending, `contract recorded ${shots} shots (pending ${pending}), played ${totals.length}`],
    [(shotMask & hitMask) === hitMask, 'contract hitMask has cells that were never fired at'],
    [won.length === 1, `contract emitted ${won.length} Won events`],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, message]) => message);
  if (failed.length) throw new Error(`fleet check failed: ${failed.join('; ')}`);

  const sorted = [...totals].sort((a, b) => a - b);
  log(`won in ${totals.length} shots, fleet checked; median shot ${secs(sorted[Math.floor(sorted.length / 2)])} s, ` +
      `whole game ${secs(performance.now() - gameStart)} s`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`[${name}] failed:`, error.shortMessage ?? error.message ?? error);
  process.exit(1);
});
