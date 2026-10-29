import { useEffect, useRef, useState } from 'react';
import { useBattle } from './battle.js';
import { Board, Fleet, Stopwatch, secs } from './components.jsx';
import { BoardIcon, Diamond, Dumbbell, Pill, Ring, Sparkle } from './icons.jsx';
import { NETWORKS } from './networks.js';
import { toast } from './toast.jsx';
import { LOW_BALANCE } from './game.js';

export const COVERS = { 'arbitrum-sepolia': 'var(--game-arbitrum)', 'ethereum-sepolia': 'var(--game-ethereum)' };
const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// ---------- hub ----------

const CONFETTI = [
  { el: <Pill color="var(--confetti-purple)" />, x: 30, y: 40, dx: -18, dy: -14, rot: 40 },
  { el: <Dumbbell color="var(--confetti-blue)" />, x: 70, y: 30, dx: 16, dy: -16, rot: -30 },
  { el: <Pill color="var(--confetti-yellow)" />, x: 78, y: 70, dx: 20, dy: 10, rot: 70 },
  { el: <Diamond />, x: 18, y: 72, dx: -16, dy: 12, rot: 90 },
  { el: <Sparkle />, x: 52, y: 14, dx: 4, dy: -14, rot: 45 },
  { el: <Ring />, x: 88, y: 46, dx: 14, dy: -4, rot: 0 },
  { el: <Dumbbell color="var(--confetti-green)" />, x: 12, y: 22, dx: -12, dy: -10, rot: 60 },
  { el: <Pill color="var(--confetti-lilac)" />, x: 46, y: 84, dx: -6, dy: 14, rot: -50 },
  { el: <Sparkle />, x: 90, y: 16, dx: 10, dy: -10, rot: 30 },
  { el: <Ring />, x: 6, y: 50, dx: -10, dy: 2, rot: 0 },
];

function RaceArt() {
  return (
    <div className="feature-card__art" aria-hidden="true">
      <div className="cluster">
        <div className="cluster__item" style={{ left: '22%', top: '22%' }}><BoardIcon size={58} /></div>
        <div className="cluster__item" style={{ left: '52%', top: '12%' }}>
          <BoardIcon size={50} fills={{ 0: '#787c7e', 5: '#fff', 6: '#c9b458', 7: '#fff', 9: '#6aaa64', 13: '#6aaa64' }} />
        </div>
        <div className="cluster__item" style={{ left: '44%', top: '52%' }}>
          <BoardIcon size={54} fills={{ 5: '#fff', 6: '#fff', 7: '#fff', 2: '#787c7e', 11: '#c9b458', 15: '#6aaa64' }} />
        </div>
      </div>
      {CONFETTI.map((c, i) => (
        <span key={i} className="confetti"
          style={{ left: `${c.x}%`, top: `${c.y}%`, '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, '--rot': `${c.rot}deg`, animationDelay: `${(i % 5) * 0.45}s` }}>
          {c.el}
        </span>
      ))}
    </div>
  );
}

function NetworkCard({ networkKey, badge, children, navigate, onHelp }) {
  return (
    <div className="game-card" style={{ '--cover': COVERS[networkKey] }}>
      {badge && <span className="badge">{badge}</span>}
      <div className="game-card__cover">
        <div className="game-card__icon"><BoardIcon /></div>
        <h3 className="game-card__name">{NETWORKS[networkKey].label}</h3>
      </div>
      <div className="game-card__content">
        <p className="game-card__desc">{children}</p>
        <button className="pill" type="button" onClick={() => navigate(`/play/${networkKey}`)} aria-label={`Play on ${NETWORKS[networkKey].label}`}>Play</button>
        <button className="pill" type="button" onClick={onHelp}>How to play</button>
      </div>
    </div>
  );
}

export function Hub({ navigate, onHelp }) {
  return (
    <main className="hub">
      <div className="hub__intro">
        <h1 className="hub__title">Battleship, encrypted.</h1>
        <p className="hub__lede">Nobody can see the house fleet, not even the contract. Fhenix CoFHE computes every shot under FHE.</p>
      </div>
      <h2 className="section-header">Pick a chain</h2>
      <div className="hub-grid">
        <div className="feature-card">
          <span className="badge">New</span>
          <RaceArt />
          <div className="feature-card__content">
            <h3 className="feature-card__title">Race the Chains</h3>
            <p className="feature-card__desc">Fire the same shots on Arbitrum Sepolia and Ethereum Sepolia at once and watch both stopwatches.</p>
            <button className="pill pill--dark" type="button" onClick={() => navigate('/race')}>Start a race</button>
          </div>
        </div>
        <NetworkCard networkKey="arbitrum-sepolia" badge="250 ms blocks" navigate={navigate} onHelp={onHelp}>
          <strong>About 2 s a shot.</strong> Fire, decrypt and reveal all land before you pick the next cell.
        </NetworkCard>
        <NetworkCard networkKey="ethereum-sepolia" navigate={navigate} onHelp={onHelp}>
          <strong>About 26 s a shot.</strong> Fire and reveal each wait for a 12 s block.
        </NetworkCard>
      </div>
    </main>
  );
}

// ---------- one chain: splash, then the game ----------

export function PlayPage({ networkKey, onHelp, onWallet, onStats, registerBalance }) {
  const battle = useBattle(networkKey);
  const [view, setView] = useState('splash');
  const net = NETWORKS[networkKey];

  useEffect(() => { registerBalance(networkKey, battle.balance); }, [battle.balance, networkKey, registerBalance]);

  const wonShown = useRef(false);
  useEffect(() => {
    if (battle.phase === 'won' && !wonShown.current) {
      wonShown.current = true;
      toast(`Fleet sunk in ${battle.shots} shots`, { win: true });
      setTimeout(() => onStats(networkKey, () => { wonShown.current = false; battle.start({ fresh: true }); }), 2200);
    }
  }, [battle.phase, battle.shots, networkKey, onStats, battle]);

  const play = async (fresh = false) => {
    if (battle.balance !== null && battle.balance < LOW_BALANCE) {
      toast('Fund the burner to play');
      onWallet();
      return;
    }
    if (await battle.start({ fresh })) setView('game');
  };

  if (view === 'splash' || battle.phase === 'loading' || battle.phase === 'starting') {
    const returning = battle.gameId !== null && battle.phase !== 'won';
    return (
      <main className="splash" style={{ '--cover': COVERS[networkKey] }}>
        <div className="splash__icon"><BoardIcon /></div>
        <h1 className="splash__title">{returning ? 'Welcome Back' : 'Battleship'}</h1>
        <p className="splash__sub">
          {returning ? `You have fired ${battle.shots} of 64 shots.` : 'Sink the hidden fleet. Every shot stays encrypted.'}
        </p>
        {battle.phase === 'loading' || battle.phase === 'starting' ? (
          <>
            <div className="spinner" role="status" aria-label="Loading" />
            {battle.phase === 'starting' && <p className="splash__meta">Placing an encrypted fleet on {net.label}…</p>}
          </>
        ) : (
          <div className="splash__buttons">
            <button className="btn btn--primary" type="button" onClick={() => play(false)}>{returning ? 'Continue' : 'Play'}</button>
            {returning && <button className="btn btn--secondary" type="button" onClick={() => play(true)}>New game</button>}
            <button className="btn btn--secondary" type="button" onClick={onWallet}>Wallet</button>
            <button className="btn btn--secondary" type="button" onClick={onHelp}>How to play</button>
          </div>
        )}
        {battle.error && <p className="splash__meta" role="alert">{battle.error.slice(0, 140)}</p>}
        <p className="splash__date">{today()}</p>
        <p className="splash__meta">{net.label}</p>
        <p className="splash__meta">Burner <code>{short(battle.address)}</code> · {battle.balance === null ? '…' : `${battle.balance.toFixed(4)} ETH`}</p>
      </main>
    );
  }

  return (
    <main className="game-page">
      <p className="game-page__net">{net.label} · Game {String(battle.gameId)}</p>
      <Fleet cells={battle.cells} />
      <Board cells={battle.cells} onFire={battle.fire} disabled={battle.phase !== 'playing'} />
      <Stopwatch active={battle.active} last={battle.last} />
      <p className="hint">
        {battle.queued > 0 ? `${battle.queued} shot${battle.queued > 1 ? 's' : ''} queued. ` : ''}
        Cells you pick while a shot is in flight are queued and fired in order.
      </p>
    </main>
  );
}

// ---------- race: the same shots on both chains ----------

const RACE = ['arbitrum-sepolia', 'ethereum-sepolia'];

function RaceColumn({ battle, startedAt }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, [startedAt]);
  const done = battle.phase === 'won';
  // The clock runs while this chain has shots in flight and stops when its last one lands.
  const busy = battle.active !== null || battle.queued > 0;
  const idleSince = useRef(null);
  if (busy) idleSince.current = null;
  else if (idleSince.current === null && battle.last) idleSince.current = performance.now();
  useEffect(() => { idleSince.current = null; }, [startedAt]);
  const elapsed = startedAt ? (busy || idleSince.current === null ? performance.now() : idleSince.current) - startedAt : 0;
  return (
    <section className="race-col" aria-label={battle.net.label}>
      <div className="race-col__head" style={{ '--cover': COVERS[battle.networkKey] }}>
        <span className="race-col__name">{battle.net.label}</span>
        <span className="race-col__stat">
          {battle.shots} shots{battle.queued ? ` · ${battle.queued} queued` : ''}<br />
          {done ? `sunk in ${secs(elapsed)}` : startedAt ? (busy ? `${secs(elapsed)} and counting` : `all in by ${secs(elapsed)}`) : battle.phase === 'starting' ? 'placing fleet…' : 'ready'}<br />
          <span className={`race-col__bal${battle.balance !== null && battle.balance < LOW_BALANCE ? ' low' : ''}`}>
            {battle.balance === null ? '… ETH' : `${battle.balance.toFixed(4)} ETH`}
          </span>
        </span>
      </div>
      <Fleet cells={battle.cells} />
      <Board cells={battle.cells} onFire={battle.fire} disabled={battle.phase !== 'playing'} />
      <Stopwatch active={battle.active} last={battle.last} idleLabel={battle.phase === 'starting' ? 'Placing the fleet' : 'Waiting for a shot'} />
    </section>
  );
}

export function RacePage({ onWallet, registerBalance }) {
  const arb = useBattle(RACE[0]);
  const eth = useBattle(RACE[1]);
  const battles = [arb, eth];
  const [startedAt, setStartedAt] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => { registerBalance(RACE[0], arb.balance); }, [arb.balance, registerBalance]);
  useEffect(() => { registerBalance(RACE[1], eth.balance); }, [eth.balance, registerBalance]);

  const ready = arb.phase !== 'loading' && eth.phase !== 'loading';
  const racing = arb.phase === 'playing' || eth.phase === 'playing' || arb.phase === 'won' || eth.phase === 'won';

  const start = async () => {
    if (battles.some((b) => b.balance !== null && b.balance < LOW_BALANCE)) {
      toast('Fund the burner on both chains to race');
      onWallet();
      return;
    }
    setStarting(true);
    const ok = await Promise.all(battles.map((b) => b.start({ fresh: true })));
    setStarting(false);
    if (ok.every(Boolean)) setStartedAt(null);
  };

  // One click fires the same cell on both chains. The clock starts with the first shot.
  const fireBoth = (cell) => {
    const results = battles.map((b) => b.fire(cell));
    if (results.some(Boolean) && !startedAt) setStartedAt(performance.now());
    return results.some(Boolean);
  };

  const wired = battles.map((b) => ({ ...b, fire: fireBoth }));
  const arbWonToast = useRef(false);
  useEffect(() => {
    if (arb.phase === 'won' && !arbWonToast.current) {
      arbWonToast.current = true;
      toast(`Arbitrum Sepolia sank the fleet in ${arb.shots} shots`, { win: true });
    }
  }, [arb.phase, arb.shots]);

  return (
    <main className="race">
      <div className="race__intro">
        <h1 className="race__title">Race the Chains</h1>
        <p className="race__sub">Every cell you pick is fired on both chains. Each has its own hidden fleet, so the answers differ; the clocks are the point.</p>
        {(!racing || arb.phase === 'won') && (
          <div style={{ marginTop: 16 }}>
            <button className="btn btn--primary" type="button" disabled={!ready || starting} onClick={start}>
              {starting ? 'Placing fleets…' : racing ? 'Race again' : 'Start the race'}
            </button>
          </div>
        )}
      </div>
      {wired.map((b) => <RaceColumn key={b.networkKey} battle={b} startedAt={startedAt} />)}
    </main>
  );
}
