// Per-chain stats kept in this browser: every shot's stage times, and games won with their shot counts.

const KEY = (networkKey) => `battleship-stats-${networkKey}`;
const MAX_SHOTS = 500;

export function loadStats(networkKey) {
  try {
    const stats = JSON.parse(localStorage.getItem(KEY(networkKey)));
    if (stats && Array.isArray(stats.shots)) return stats;
  } catch {}
  return { shots: [], wins: [] };
}

function save(networkKey, stats) {
  try { localStorage.setItem(KEY(networkKey), JSON.stringify(stats)); } catch {}
}

export function recordShot(networkKey, times) {
  const stats = loadStats(networkKey);
  stats.shots.push({ fire: Math.round(times.fire), decrypt: Math.round(times.decrypt), reveal: Math.round(times.reveal), total: Math.round(times.total) });
  stats.shots = stats.shots.slice(-MAX_SHOTS);
  save(networkKey, stats);
}

export function recordGame(networkKey, shots) {
  const stats = loadStats(networkKey);
  stats.wins.push(shots);
  save(networkKey, stats);
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const BUCKETS = [
  { label: '< 1 s', max: 1000 },
  { label: '1 to 2 s', max: 2000 },
  { label: '2 to 3 s', max: 3000 },
  { label: '3 to 10 s', max: 10000 },
  { label: '10 to 20 s', max: 20000 },
  { label: '> 20 s', max: Infinity },
];

export const bucketOf = (ms) => BUCKETS.findIndex((bucket) => ms < bucket.max);
