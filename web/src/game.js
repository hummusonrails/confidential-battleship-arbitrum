// The game on one chain: a burner account that signs every transaction without a wallet popup, a CoFHE client for
// decrypting shot results, and a stopwatch on each stage of every shot.

import { createPublicClient, createWalletClient, custom, encodeFunctionData, formatEther, http, parseEther, parseEventLogs } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web';
import abi from './battleship-abi.json';
import deployments from './deployments.json';
import { NETWORKS } from './networks.js';
import { createSender, decryptPublic } from './tx.js';

export const MISS = 0;
export const HIT = 1;
export const SUNK = 2;
export const SHIP_LENGTHS = [4, 3, 3, 2];
export const sectorOf = (cell) => Math.floor(cell / 32) * 2 + Math.floor((cell % 8) / 4);
export const cellName = (cell) => `${'ABCDEFGH'[cell % 8]}${Math.floor(cell / 8) + 1}`;
export const TOP_UP = '0.005';
// Below this the burner may not cover a game start and a few shots, so the UI asks for a top up.
export const LOW_BALANCE = 0.0005;

// The board as the contract records it: null for untouched cells, else MISS, HIT or SUNK.
export function boardFromMasks({ shotMask, hitMask, sunkMask }) {
  return Array.from({ length: 64 }, (_, cell) => {
    const bit = 1n << BigInt(cell);
    if (!(shotMask & bit)) return null;
    if (!(hitMask & bit)) return MISS;
    return sunkMask & (1 << sectorOf(cell)) ? SUNK : HIT;
  });
}

const BURNER_KEY = 'battleship-burner-key';

// One burner key for every chain, kept in this browser. It only ever holds a few cents of testnet ETH.
export function burnerKey() {
  let key;
  try { key = localStorage.getItem(BURNER_KEY); } catch {}
  if (!key) {
    key = generatePrivateKey();
    try { localStorage.setItem(BURNER_KEY, key); } catch {}
  }
  return key;
}

export function createGame(networkKey) {
  const net = NETWORKS[networkKey];
  const contract = deployments[networkKey];
  const account = privateKeyToAccount(burnerKey());
  // The sync send waits for the block, which is 12 s on Ethereum, past viem's 10 s default.
  const transport = http(net.rpc, { retryCount: 6, retryDelay: 500, timeout: 60_000 });
  const publicClient = createPublicClient({ chain: net.chain, transport });
  const walletClient = createWalletClient({ chain: net.chain, transport, account });
  const send = createSender({ publicClient, walletClient });
  const call = (functionName, args) => ({ to: contract, data: encodeFunctionData({ abi, functionName, args }) });

  let cofhe;
  async function cofheClient() {
    if (!cofhe) {
      const client = createCofheClient(createCofheConfig({ supportedChains: [net.cofhe] }));
      await client.connect(publicClient, walletClient);
      cofhe = client;
    }
    return cofhe;
  }

  // Connects CoFHE and estimates fire's gas on a cell not yet fired at, so the first shot is as fast as the rest.
  async function warm(gameId) {
    const { shotMask } = await readGame(gameId);
    const cell = [...Array(64).keys()].find((c) => !(shotMask & (1n << BigInt(c))));
    await Promise.all([cofheClient(), cell === undefined ? null : send.warm(call('fire', [gameId, cell])).catch(() => {})]);
  }

  async function readGame(gameId) {
    const [player, shotMask, hitMask, sunkMask, shots, pending, pendingCell, pendingResult] =
      await publicClient.readContract({ address: contract, abi, functionName: 'getGame', args: [gameId] });
    return { gameId, player, shotMask, hitMask, sunkMask, shots, pending, pendingCell, pendingResult };
  }

  return {
    networkKey,
    net,
    contract,
    address: account.address,

    async balance() {
      return formatEther(await publicClient.getBalance({ address: account.address }));
    },

    // The player's latest game, or null. A shot left waiting for its reveal (the tab closed mid-shot) is finished.
    async resume() {
      const latest = await publicClient.readContract({ address: contract, abi, functionName: 'latestGame', args: [account.address] });
      if (latest === 0n) return null;
      const game = await readGame(latest - 1n);
      if (game.sunkMask === 15) return null;
      if (game.pending) {
        const decrypted = await decryptPublic(await cofheClient(), game.pendingResult);
        await send(call('reveal', [game.gameId, Number(decrypted.decryptedValue), decrypted.signature]));
      }
      const current = game.pending ? await readGame(game.gameId) : game;
      warm(game.gameId).catch(() => {});
      return { ...current, cells: boardFromMasks(current) };
    },

    // Finishes a shot the contract is still waiting to reveal (a step failed after fire landed). Returns that
    // shot's cell and result, or null when nothing was pending.
    async recover(gameId) {
      const game = await readGame(gameId);
      if (!game.pending) return null;
      const decrypted = await decryptPublic(await cofheClient(), game.pendingResult);
      const result = Number(decrypted.decryptedValue);
      const { receipt } = await send(call('reveal', [gameId, result, decrypted.signature]));
      const won = parseEventLogs({ abi, logs: receipt.logs, eventName: 'Won' }).length > 0;
      return { cell: game.pendingCell, result, won };
    },

    async newGame() {
      const { ms, receipt } = await send(call('newGame', []));
      const [event] = parseEventLogs({ abi, logs: receipt.logs, eventName: 'GameStarted' });
      warm(event.args.gameId).catch(() => {});
      return { gameId: event.args.gameId, ms };
    },

    // fire, then decrypt, then reveal. onStage(stage, elapsedMs) runs as each stage starts and ends, so the UI can
    // run a live stopwatch.
    async fire(gameId, cell, onStage = () => {}) {
      const started = performance.now();
      const times = {};
      onStage('fire', 0);
      const fired = await send(call('fire', [gameId, cell]));
      times.fire = fired.ms;
      const [event] = parseEventLogs({ abi, logs: fired.receipt.logs, eventName: 'Shot' });

      onStage('decrypt', performance.now() - started);
      const decryptStart = performance.now();
      const decrypted = await decryptPublic(await cofheClient(), event.args.result);
      times.decrypt = performance.now() - decryptStart;
      const result = Number(decrypted.decryptedValue);

      onStage('reveal', performance.now() - started);
      const revealed = await send(call('reveal', [gameId, result, decrypted.signature]));
      times.reveal = revealed.ms;
      times.total = performance.now() - started;
      onStage('done', times.total);
      const won = parseEventLogs({ abi, logs: revealed.receipt.logs, eventName: 'Won' }).length > 0;
      return { cell, result, times, won, txs: [fired.receipt.transactionHash, revealed.receipt.transactionHash] };
    },
  };
}

// Tops up the burner from the player's own wallet (MetaMask or any injected wallet): one popup per chain.
export async function topUp(networkKey, to) {
  const net = NETWORKS[networkKey];
  if (!window.ethereum) throw new Error('No browser wallet found. Send testnet ETH to the burner address instead.');
  const [from] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chainId = `0x${net.chain.id.toString(16)}`;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
      chainId, chainName: net.label, rpcUrls: [net.rpc], blockExplorerUrls: [net.explorer],
      nativeCurrency: net.chain.nativeCurrency,
    }] });
  }
  const wallet = createWalletClient({ chain: net.chain, transport: custom(window.ethereum), account: from });
  const hash = await wallet.sendTransaction({ to, value: parseEther(TOP_UP) });
  const publicClient = createPublicClient({ chain: net.chain, transport: http(net.rpc) });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
