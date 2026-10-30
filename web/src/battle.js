import { useCallback, useEffect, useRef, useState } from 'react';
import { cellName, createGame, sectorOf, MISS, HIT, SUNK } from './game.js';
import { recordGame, recordShot } from './stats.js';
import { toast } from './toast.jsx';

// One engine per chain for the whole page, so the local nonce and CoFHE client survive navigation.
const engines = {};
export const engine = (networkKey) => (engines[networkKey] ??= createGame(networkKey));

// The shot each chain has in flight. A board mounted mid-shot (the player navigated away and back) waits for it, so
// it reads the game after that shot lands.
const inflight = {};
const settled = (networkKey) => (inflight[networkKey] ?? Promise.resolve()).catch(() => {});

// Fired by the wallet after a top up, so every board refreshes its balance.
export const FUNDED_EVENT = 'battleship-funded';

const NAMES = { [MISS]: 'miss', [HIT]: 'hit', [SUNK]: 'sunk' };
const emptyCells = () => Array(64).fill(null);

function cellsFromChain(values) {
  return values.map((value) => (value === null ? null : NAMES[value]));
}

// Marks every hit in a sector as sunk: the sector holds exactly one ship, so its hits are that ship.
function sinkSector(cells, sector) {
  return cells.map((state, cell) => (state === 'hit' && sectorOf(cell) === sector ? 'sunk' : state));
}

export function sunkSectors(cells) {
  const sunk = [false, false, false, false];
  cells.forEach((state, cell) => { if (state === 'sunk') sunk[sectorOf(cell)] = true; });
  return sunk;
}

export function useBattle(networkKey) {
  const game = engine(networkKey);
  const [state, setState] = useState({
    phase: 'loading', // loading | splash | starting | playing | won | error
    gameId: null,
    cells: emptyCells(),
    shots: 0,
    active: null, // { cell, stage, startedAt, marks: { fire, decrypt, reveal } }
    last: null, // { cell, result, times }
    queued: 0,
    balance: null,
    error: null,
  });
  const queue = useRef([]);
  const busy = useRef(false);
  const live = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  // The game shots belong to, set as soon as it changes. A shot that lands after the player moved to another game is
  // ignored.
  const gameIdRef = useRef(null);

  const update = useCallback((patch) => {
    if (!live.current) return;
    setState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  }, []);

  const refreshBalance = useCallback(async () => {
    try {
      const balance = Number(await game.balance());
      update({ balance });
      return balance;
    } catch {
      return stateRef.current.balance;
    }
  }, [game, update]);

  useEffect(() => {
    window.addEventListener(FUNDED_EVENT, refreshBalance);
    return () => window.removeEventListener(FUNDED_EVENT, refreshBalance);
  }, [refreshBalance]);

  useEffect(() => {
    live.current = true;
    (async () => {
      try {
        await settled(networkKey);
        const [balance, resumed] = await Promise.all([game.balance(), game.resume()]);
        gameIdRef.current = resumed?.gameId ?? null;
        update({
          phase: 'splash',
          balance: Number(balance),
          gameId: resumed?.gameId ?? null,
          cells: resumed ? cellsFromChain(resumed.cells) : emptyCells(),
          shots: resumed?.shots ?? 0,
        });
      } catch (error) {
        update({ phase: 'splash', error: error.shortMessage ?? error.message });
      }
    })();
    return () => { live.current = false; };
  }, [game, networkKey, update]);

  const start = useCallback(async ({ fresh = false } = {}) => {
    const current = stateRef.current;
    if (current.gameId !== null && !fresh && current.phase !== 'won') {
      update({ phase: 'playing' });
      return true;
    }
    // Cells queued for the old game are never fired, and its shot still in flight is ignored when it lands.
    const previous = gameIdRef.current;
    queue.current = [];
    gameIdRef.current = null;
    update({ phase: 'starting', error: null, active: null, queued: 0 });
    try {
      const { gameId } = await game.newGame();
      gameIdRef.current = gameId;
      update({ phase: 'playing', gameId, cells: emptyCells(), shots: 0, last: null, active: null });
      refreshBalance();
      return true;
    } catch (error) {
      gameIdRef.current = previous;
      update({ phase: 'splash', error: error.shortMessage ?? error.message });
      return false;
    }
  }, [game, update, refreshBalance]);

  const finish = useCallback((shots) => {
    recordGame(networkKey, shots);
    // Cells picked after the winning shot are never fired; clear their queued marks.
    const dropped = new Set(queue.current);
    queue.current = [];
    update((prev) => ({ phase: 'won', queued: 0, cells: prev.cells.map((s, i) => (dropped.has(i) ? null : s)) }));
  }, [networkKey, update]);

  const process = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length && live.current) {
      const cell = queue.current.shift();
      const gameId = gameIdRef.current;
      const current = () => live.current && gameIdRef.current === gameId;
      const marks = {};
      update((prev) => ({
        queued: queue.current.length,
        cells: prev.cells.map((s, i) => (i === cell ? 'pending' : s)),
        active: { cell, stage: 'fire', startedAt: performance.now(), marks },
      }));
      const work = game.fire(gameId, cell, (stage, at) => {
        marks[stage] = at;
        if (current()) update((prev) => ({ active: prev.active && { ...prev.active, stage, marks: { ...marks } } }));
      });
      inflight[networkKey] = work;
      try {
        const shot = await work;
        recordShot(networkKey, shot.times);
        if (!current()) continue;
        const shots = stateRef.current.shots + 1;
        update((prev) => {
          let cells = prev.cells.map((s, i) => (i === cell ? NAMES[shot.result] : s));
          if (shot.result === SUNK) cells = sinkSector(cells, sectorOf(cell));
          return { cells, shots, active: null, last: shot };
        });
        if (shot.won) finish(shots);
        refreshBalance();
      } catch (error) {
        const message = error.shortMessage ?? error.message;
        console.error(`[${networkKey}] shot at ${cell} failed:`, message);
        // The contract's record decides what the board shows: the shot may have landed, or been revealed, before the
        // step that failed.
        let synced = null;
        try {
          const work = game.sync(gameId);
          inflight[networkKey] = work;
          synced = await work;
        } catch (syncError) {
          console.error(`[${networkKey}] could not read the game back:`, syncError.shortMessage ?? syncError.message);
        }
        if (!current()) continue;
        if (/insufficient funds/i.test(message)) {
          toast('Out of testnet ETH. Top up the burner.');
          queue.current = [];
        }
        const waiting = new Set(queue.current);
        if (synced) {
          const cells = cellsFromChain(synced.cells).map((s, i) => (s === null && waiting.has(i) ? 'queued' : s));
          update({ cells, shots: Number(synced.shots), active: null });
          if (synced.won) finish(Number(synced.shots));
          else if (synced.cells[cell] === null && !/insufficient funds/i.test(message)) toast(`Shot at ${cellName(cell)} failed. Pick it again.`);
        } else {
          update((prev) => ({ cells: prev.cells.map((s, i) => (i === cell || (s === 'queued' && !waiting.has(i)) ? null : s)), active: null }));
          if (!/insufficient funds/i.test(message)) toast(`Shot at ${cellName(cell)} failed. Pick it again.`);
        }
      }
      update({ queued: queue.current.length });
    }
    busy.current = false;
  }, [game, networkKey, update, refreshBalance, finish]);

  // Returns false when the cell cannot be fired at, so the board can shake.
  const fire = useCallback((cell) => {
    const current = stateRef.current;
    if (current.phase !== 'playing' || current.cells[cell] !== null) return false;
    queue.current.push(cell);
    update((prev) => ({ cells: prev.cells.map((s, i) => (i === cell ? 'queued' : s)), queued: queue.current.length }));
    process();
    return true;
  }, [process, update]);

  return { ...state, networkKey, net: game.net, address: game.address, start, fire, refreshBalance, update };
}
