import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { cellName, sectorOf, SHIP_LENGTHS, TOP_UP, topUp } from './game.js';
import { NETWORKS } from './networks.js';
import { sunkSectors } from './battle.js';
import { BUCKETS, bucketOf, loadStats, median } from './stats.js';
import { toast } from './toast.jsx';
import { CloseIcon, CopyIcon, HitMark, MissMark, TargetMark } from './icons.jsx';

export const secs = (ms) => `${(ms / 1000).toFixed(2)} s`;
const COLS = 'ABCDEFGH';
const LABELS = { null: 'empty', queued: 'queued', pending: 'waiting for CoFHE', miss: 'miss', hit: 'hit', sunk: 'sunk' };

// ---------- board ----------

// A cell keeps showing its old state until the flip reaches edge on, then swaps, like a tile reveal. A sinking
// ship's cells flip one after another (300 ms apart), then bounce together with 100 ms offsets.
function Cell({ cell, state, onFire, disabled, flipDelay = 0, bounceDelay = null }) {
  const [shown, setShown] = useState(state);
  const [animation, setAnimation] = useState(null);
  const previous = useRef(state);
  const next = useRef(state);

  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (before === state) return;
    next.current = state;
    if (state === null || state === 'pending') { setShown(state); if (state === null) setAnimation(null); return; }
    if (state === 'queued') { setShown(state); setAnimation('pop'); return; }
    const timer = setTimeout(() => setAnimation('flip-in'), flipDelay);
    return () => clearTimeout(timer);
  }, [state, flipDelay]);

  const onAnimationEnd = () => {
    if (animation === 'flip-in') {
      setShown(next.current);
      setAnimation('flip-out');
    } else if (animation === 'flip-out' && next.current === 'sunk' && bounceDelay !== null) {
      setAnimation(null);
      setTimeout(() => setAnimation('bounce'), bounceDelay);
    } else {
      setAnimation(null);
    }
  };

  const mark = shown === 'miss' ? <MissMark /> : shown === 'hit' || shown === 'sunk' ? <HitMark /> : shown ? <TargetMark /> : null;
  return (
    <button
      type="button"
      className="cell"
      data-state={shown ?? undefined}
      data-animation={animation ?? undefined}
      disabled={disabled}
      onClick={() => onFire(cell)}
      onAnimationEnd={onAnimationEnd}
      aria-label={`${cellName(cell)}, ${LABELS[shown]}`}
    >
      {mark}
    </button>
  );
}

export function Board({ cells, onFire, disabled }) {
  const [shakeRow, setShakeRow] = useState(null);
  const sunkBefore = useRef(sunkSectors(cells));
  const [sinking, setSinking] = useState({});

  // When a sector sinks, its other hit cells flip in order, then the whole ship bounces.
  useEffect(() => {
    const now = sunkSectors(cells);
    const plan = {};
    now.forEach((sunk, sector) => {
      if (!sunk || sunkBefore.current[sector]) return;
      const ship = cells.map((s, c) => (s === 'sunk' && sectorOf(c) === sector ? c : -1)).filter((c) => c >= 0);
      ship.forEach((c, i) => { plan[c] = { flipDelay: i * 300, bounceDelay: (ship.length - 1 - i) * 300 + i * 100 }; });
    });
    sunkBefore.current = now;
    if (Object.keys(plan).length) setSinking((prev) => ({ ...prev, ...plan }));
  }, [cells]);

  const fire = useCallback((cell) => {
    if (onFire(cell) === false) {
      setShakeRow(Math.floor(cell / 8));
      toast(cells[cell] ? 'Already fired there' : 'Not ready yet');
    }
  }, [onFire, cells]);

  const rows = [];
  for (let row = 0; row < 8; row++) {
    if (row === 4) rows.push(<div key="gap" className="board-gap" aria-hidden="true" />);
    const items = [<div key="label" className="board-label" aria-hidden="true">{row + 1}</div>];
    for (let col = 0; col < 8; col++) {
      if (col === 4) items.push(<div key="gap" aria-hidden="true" />);
      const cell = row * 8 + col;
      items.push(
        <Cell key={cell} cell={cell} state={cells[cell]} onFire={fire} disabled={disabled}
          flipDelay={sinking[cell]?.flipDelay} bounceDelay={sinking[cell]?.bounceDelay ?? null} />,
      );
    }
    rows.push(
      <div key={row} role="group" aria-label={`Row ${row + 1}`}
        className={`board-row${shakeRow === row ? ' shake' : ''}`} onAnimationEnd={(e) => { if (e.target === e.currentTarget) setShakeRow(null); }}>
        {items}
      </div>,
    );
  }
  return (
    <div className="board-wrap">
      <div className="board-labels-cols" aria-hidden="true">
        <div />
        {[...COLS].map((c, i) => (
          <Fragment key={c}>{i === 4 && <div />}<div className="board-label">{c}</div></Fragment>
        ))}
      </div>
      <div className="board">{rows}</div>
    </div>
  );
}

export function Fleet({ cells }) {
  const sunk = sunkSectors(cells);
  return (
    <div className="fleet" aria-label={`${sunk.filter(Boolean).length} of 4 ships sunk`}>
      {SHIP_LENGTHS.map((length, sector) => (
        <div key={sector} className={`fleet__ship${sunk[sector] ? ' sunk' : ''}`}>
          {Array.from({ length }, (_, i) => <span key={i} className="fleet__seg" />)}
        </div>
      ))}
    </div>
  );
}

// ---------- stopwatch ----------

const STAGE_LABEL = { fire: 'Firing onchain', decrypt: 'CoFHE decrypting', reveal: 'Publishing result', done: 'Done' };

export function Stopwatch({ active, last, idleLabel = 'Pick a cell to fire' }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (!active) return;
    let frame;
    const tick = () => { setNow(performance.now()); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  let elapsed = 0;
  let parts;
  let label = idleLabel;
  if (active) {
    elapsed = now - active.startedAt;
    const m = active.marks;
    const end = elapsed;
    parts = {
      fire: (m.decrypt ?? end) - 0,
      decrypt: m.decrypt === undefined ? 0 : (m.reveal ?? end) - m.decrypt,
      reveal: m.reveal === undefined ? 0 : end - m.reveal,
    };
    label = `${cellName(active.cell)} · ${STAGE_LABEL[active.stage]}`;
  } else if (last) {
    elapsed = last.times.total;
    // Wall time per stage, so the three bars add up to the total the player waited.
    parts = { fire: last.times.total - last.times.decrypt - last.times.reveal, decrypt: last.times.decrypt, reveal: last.times.reveal };
    label = `${cellName(last.cell)} · ${['Miss', 'Hit', 'Sunk'][last.result]}`;
  }
  return (
    <div className="stopwatch" aria-live="off">
      <div className="stopwatch__head">
        <div className="stopwatch__time">{secs(elapsed)}</div>
        <div className="stopwatch__label">{label}</div>
      </div>
      <div className="stages" aria-hidden="true">
        {['fire', 'decrypt', 'reveal'].map((stage) => (
          <div key={stage} className={`stage ${stage}${active?.stage === stage ? ' active' : ''}`}
            style={{ flexGrow: parts ? Math.max(parts[stage], 1) : 1 }}>
            {parts && parts[stage] > 300 ? secs(parts[stage]) : ''}
          </div>
        ))}
      </div>
      <div className="stage-legend">
        <span><b>fire</b> shot included onchain</span>
        <span><b>decrypt</b> CoFHE computes and decrypts</span>
        <span><b>reveal</b> result published onchain</span>
      </div>
    </div>
  );
}

// ---------- modals ----------

export function Modal({ title, onClose, children, label }) {
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setClosing(true), []);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [close]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={ref} className={`modal${closing ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? title} tabIndex={-1}
        onAnimationEnd={() => { if (closing) onClose(); }}>
        <button className="modal__close" type="button" aria-label="Close" onClick={close}><CloseIcon /></button>
        {title && <h2 className="modal__title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

function ExampleCell({ state }) {
  const mark = state === 'miss' ? <MissMark /> : state === 'pending' ? <TargetMark /> : <HitMark />;
  return <div className="cell" data-state={state}>{mark}</div>;
}

export function HelpModal({ onClose }) {
  return (
    <Modal title="How To Play" onClose={onClose}>
      <p className="modal__subheading">Sink the hidden fleet. Nobody can see it, not even the contract.</p>
      <ul>
        <li>The board is four 4x4 sectors with one ship in each: lengths 4, 3, 3 and 2.</li>
        <li>Ships run straight, across or down, and stay inside their sector.</li>
        <li>Each shot is a transaction. Fhenix CoFHE checks it against the encrypted fleet and reveals only miss, hit or sunk.</li>
      </ul>
      <p><strong>Examples</strong></p>
      <div className="examples">
        <div className="example"><ExampleCell state="pending" /><span>Fired. The answer is being computed under FHE.</span></div>
        <div className="example"><ExampleCell state="miss" /><span>Miss: open water.</span></div>
        <div className="example"><ExampleCell state="hit" /><span>Hit: part of a ship.</span></div>
        <div className="example"><ExampleCell state="sunk" /><span>Sunk: every cell of that ship is hit.</span></div>
      </div>
      <hr />
      <p className="footnote">
        Every shot is three steps: <b>fire</b> (the shot lands onchain), <b>decrypt</b> (CoFHE computes the answer and
        signs its decryption) and <b>reveal</b> (the signed answer is published onchain). The stopwatch times each one.
        Shots are signed by a burner key kept in this browser, so there are no wallet popups.
      </p>
    </Modal>
  );
}

const ARBITRUM_DOCS = [
  { href: 'https://docs.arbitrum.io/welcome/arbitrum-gentle-introduction', label: 'A gentle introduction to Arbitrum' },
  { href: 'https://docs.arbitrum.io/build-decentralized-apps/arbitrum-vs-ethereum/block-numbers-and-time', label: 'Block numbers and time on Arbitrum' },
  { href: 'https://docs.arbitrum.io/how-arbitrum-works/sequencer', label: 'The Sequencer' },
  { href: 'https://docs.arbitrum.io/build-decentralized-apps/public-chains', label: 'Arbitrum chains overview' },
];
const FHENIX_DOCS = [
  { href: 'https://cofhe-docs.fhenix.zone/cofhe/get-started/introduction/what-is-cofhe', label: 'What is CoFHE?' },
  { href: 'https://cofhe-docs.fhenix.zone/cofhe/fhe-library/core-concepts/data-evaluation', label: 'How FHE operations run for chains like Arbitrum One' },
  { href: 'https://cofhe-docs.fhenix.zone/cofhe/fhe-library/introduction/quick-start', label: 'Quick start: deploy to Arbitrum Sepolia and Arbitrum One' },
  { href: 'https://cofhe-docs.fhenix.zone/cofhe/get-started/introduction/compatibility', label: 'Supported networks, including Arbitrum Sepolia' },
  { href: 'https://cofhe-docs.fhenix.zone/cofhe/deep-dive/data-flows/decryption-request-flow', label: 'The decryption flow' },
];

function LinkList({ links }) {
  return (
    <ul className="link-list">
      {links.map((link) => <li key={link.href}><a href={link.href} target="_blank" rel="noreferrer">{link.label}</a></li>)}
    </ul>
  );
}

export function InfoModal({ onClose }) {
  return (
    <Modal title="About This Game" onClose={onClose}>
      <p className="modal__subheading">Battleship where the fleet is encrypted onchain and every shot is computed without decrypting it.</p>

      <h3 className="eyebrow">What is FHE?</h3>
      <p>
        Fully homomorphic encryption lets a computer run math on encrypted data and get an encrypted answer, without
        ever seeing the data. A contract can check a shot against a fleet that stays encrypted the whole time.
      </p>

      <h3 className="eyebrow">What is CoFHE?</h3>
      <p>
        CoFHE is the FHE coprocessor from Fhenix. Contracts written with <code>FHE.sol</code> hold small handles to
        encrypted values, and CoFHE runs the FHE math offchain. When an app needs an answer in the clear, CoFHE decrypts
        just that value and signs it, and the contract verifies the signature before it uses the result.
      </p>

      <h3 className="eyebrow">How it works on Arbitrum</h3>
      <p>
        CoFHE attaches to Arbitrum, so a confidential contract is an ordinary Solidity contract on Arbitrum One or
        Arbitrum Sepolia. Here, a new game places four ships with encrypted randomness. Each shot then takes three steps:
      </p>
      <ul>
        <li><b>Fire:</b> the shot lands in an Arbitrum block.</li>
        <li><b>Decrypt:</b> CoFHE works out miss, hit or sunk on the encrypted fleet and decrypts only that answer.</li>
        <li><b>Reveal:</b> the signed answer is published in another Arbitrum block.</li>
      </ul>
      <p>
        Arbitrum produces a block about every 250 ms, so both onchain steps take well under a second and a whole shot
        lands in about 2 seconds. Multi-step confidential flows like this one feel interactive on Arbitrum.
      </p>

      <h3 className="eyebrow">Arbitrum docs</h3>
      <LinkList links={ARBITRUM_DOCS} />
      <h3 className="eyebrow">Fhenix docs</h3>
      <LinkList links={FHENIX_DOCS} />
    </Modal>
  );
}

export function StatsModal({ networkKey, onClose, onPlayAgain }) {
  const stats = loadStats(networkKey);
  const totals = stats.shots.map((s) => s.total);
  const last = totals[totals.length - 1];
  const counts = BUCKETS.map(() => 0);
  totals.forEach((t) => { counts[bucketOf(t)] += 1; });
  const max = Math.max(1, ...counts);
  const wins = stats.wins;
  const others = Object.keys(NETWORKS).map((key) => {
    const s = loadStats(key).shots;
    return { key, label: NETWORKS[key].label, n: s.length, median: median(s.map((x) => x.total)) };
  });
  const share = async () => {
    const m = median(totals);
    const text = `Confidential Battleship on ${NETWORKS[networkKey].label}: ${totals.length} encrypted shots, median ${m ? secs(m) : 'n/a'} per shot.`;
    try { await navigator.clipboard.writeText(text); toast('Copied results to clipboard', { duration: 2000 }); } catch { toast('Could not copy'); }
  };
  return (
    <Modal onClose={onClose} label="Statistics">
      <h3 className="eyebrow">Statistics · {NETWORKS[networkKey].label}</h3>
      <div className="stats-row">
        <div className="stat"><div className="stat__num">{totals.length}</div><div className="stat__label">Shots fired</div></div>
        <div className="stat"><div className="stat__num">{totals.length ? (median(totals) / 1000).toFixed(1) : '0'}</div><div className="stat__label">Median shot (s)</div></div>
        <div className="stat"><div className="stat__num">{wins.length}</div><div className="stat__label">Fleets sunk</div></div>
        <div className="stat"><div className="stat__num">{wins.length ? Math.round(wins.reduce((a, b) => a + b, 0) / wins.length) : '0'}</div><div className="stat__label">Avg shots to win</div></div>
      </div>
      <h3 className="eyebrow">Shot latency</h3>
      <div className="histogram">
        {BUCKETS.map((bucket, i) => (
          <div className="histogram-row" key={bucket.label}>
            <div className="histogram-row__label">{bucket.label}</div>
            <div className={`histogram-bar${last !== undefined && bucketOf(last) === i ? ' highlight' : ''}`}
              style={{ width: `${(counts[i] / max) * 100}%` }}>{counts[i]}</div>
          </div>
        ))}
      </div>
      <h3 className="eyebrow">Median shot by network (this browser)</h3>
      <div className="compare">
        {others.map((o) => (
          <Fragment key={o.key}><b>{o.label}</b><span className="num">{o.median ? secs(o.median) : 'n/a'}</span><span className="num">{o.n} shots</span></Fragment>
        ))}
      </div>
      <hr />
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {onPlayAgain && <button className="btn btn--secondary" type="button" onClick={onPlayAgain}>Play again</button>}
        <button className="btn btn--primary" type="button" onClick={share}>Share</button>
      </div>
    </Modal>
  );
}

export function SettingsModal({ settings, setSettings, onClose }) {
  const rows = [
    { key: 'dark', title: 'Dark Theme', desc: 'Starts from your system setting' },
    { key: 'contrast', title: 'High Contrast Mode', desc: 'Contrast and colorblindness improvements' },
  ];
  const effective = (key) => settings[key] ?? (key === 'dark' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <Modal onClose={onClose} label="Settings">
      <h2 className="modal__caps">Settings</h2>
      {rows.map((row) => (
        <div className="setting" key={row.key}>
          <div><div className="setting__title">{row.title}</div><div className="setting__desc">{row.desc}</div></div>
          <button type="button" role="switch" className="switch" aria-checked={effective(row.key)} aria-label={row.title}
            onClick={() => setSettings({ ...settings, [row.key]: !effective(row.key) })}>
            <span className="switch__knob" />
          </button>
        </div>
      ))}
      <p className="footnote" style={{ marginTop: 16 }}>Animations follow your system's reduced motion setting.</p>
    </Modal>
  );
}

export function WalletModal({ address, balances, onClose, onFunded }) {
  const [busy, setBusy] = useState(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); toast('Address copied', { duration: 2000 }); } catch {}
  };
  const fund = async (key) => {
    setBusy(key);
    try {
      await topUp(key, address);
      toast(`Sent ${TOP_UP} ETH on ${NETWORKS[key].label}`, { duration: 2000 });
      onFunded?.(key);
    } catch (error) {
      toast(error.code === 4001 ? 'Top up cancelled' : (error.shortMessage ?? error.message).slice(0, 80), { duration: 2000 });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Wallet" onClose={onClose}>
      <p className="modal__subheading">A burner key in this browser signs every shot, so play never stops for a popup.</p>
      <div className="address"><span style={{ flex: 1 }}>{address}</span><button type="button" aria-label="Copy address" onClick={copy}><CopyIcon /></button></div>
      <p className="footnote">Keep only testnet ETH here. A shot costs a fraction of a cent of testnet gas.</p>
      {Object.entries(NETWORKS).map(([key, net]) => (
        <div className="wallet-net" key={key}>
          <div className="wallet-net__row">
            <span className="wallet-net__name">{net.label}</span>
            <span className="wallet-net__bal">{balances[key] === undefined || balances[key] === null ? '...' : `${balances[key].toFixed(4)} ETH`}</span>
          </div>
          <div className="wallet-net__actions">
            <button className="btn btn--primary" type="button" disabled={busy !== null} onClick={() => fund(key)}>
              {busy === key ? 'Confirm in your wallet' : `Top up ${TOP_UP} ETH from your wallet`}
            </button>
            <a className="btn btn--secondary" href={net.faucet} target="_blank" rel="noreferrer">Faucet</a>
          </div>
        </div>
      ))}
    </Modal>
  );
}
