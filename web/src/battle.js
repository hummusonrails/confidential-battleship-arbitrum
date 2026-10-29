import { useCallback, useEffect, useRef, useState } from 'react';
import { createGame, sectorOf, MISS, HIT, SUNK } from './game.js';
import { recordGame, recordShot } from './stats.js';
import { toast } from './toast.jsx';

// One engine per chain for the whole page, so the local nonce and CoFHE client survive navigation.
const engines = {};
export const engine = (networkKey) => (engines[networkKey] ??= createGame(networkKey));

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

  const update = useCallback((patch) => {
    if (!live.current) return;
    setState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  }, []);

  const refreshBalance = useCallback(async () => {
    try { update({ balance: Number(await game.balance()) }); } catch {}
  }, [game, update]);

  useEffect(() => {
    live.current = true;
    (async () => {
      try {
        const [balance, resumed] = await Promise.all([game.balance(), game.resume()]);
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
  }, [game, update]);

  const start = useCallback(async ({ fresh = false } = {}) => {
    const current = stateRef.current;
    if (current.gameId !== null && !fresh && current.phase !== 'won') {
      update({ phase: 'playing' });
      return true;
    }
    update({ phase: 'starting', error: null });
    try {
      const { gameId } = await game.newGame();
      update({ phase: 'playing', gameId, cells: emptyCells(), shots: 0, last: null, active: null });
      refreshBalance();
      return true;
    } catch (error) {
      update({ phase: 'splash', error: error.shortMessage ?? error.message });
      return false;
    }
  }, [game, update, refreshBalance]);

  const process = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length && live.current) {
      const cell = queue.current.shift();
      const { gameId } = stateRef.current;
      const marks = {};
      update((prev) => ({
        queued: queue.current.length,
        cells: prev.cells.map((s, i) => (i === cell ? 'pending' : s)),
        active: { cell, stage: 'fire', startedAt: performance.now(), marks },
      }));
      try {
        const shot = await game.fire(gameId, cell, (stage, at) => {
          marks[stage] = at;
          update((prev) => ({ active: prev.active && { ...prev.active, stage, marks: { ...marks } } }));
        });
        recordShot(networkKey, shot.times);
        update((prev) => {
          let cells = prev.cells.map((s, i) => (i === cell ? NAMES[shot.result] : s));
          if (shot.result === SUNK) cells = sinkSector(cells, sectorOf(cell));
          return { cells, shots: prev.shots + 1, active: null, last: shot, phase: shot.won ? 'won' : prev.phase };
        });
        if (shot.won) {
          recordGame(networkKey, stateRef.current.shots);
          queue.current = [];
        }
        refreshBalance();
      } catch (error) {
        const message = error.shortMessage ?? error.message;
        update((prev) => ({ cells: prev.cells.map((s, i) => (i === cell ? null : s)), active: null }));
        toast(/insufficient funds/i.test(message) ? 'Out of testnet ETH. Top up the burner.' : 'Shot failed. Try again.');
        console.error(`[${networkKey}] shot at ${cell} failed:`, message);
        queue.current.forEach((c) => update((prev) => ({ cells: prev.cells.map((s, i) => (i === c ? null : s)) })));
        queue.current = [];
      }
      update({ queued: queue.current.length });
    }
    busy.current = false;
  }, [game, networkKey, update, refreshBalance]);

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


