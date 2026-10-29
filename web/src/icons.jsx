// Inline icons. Game glyphs follow one style: 3px black outlines and flat fills.

const SUNK = '#6aaa64';
const HIT = '#c9b458';
const MISS = '#787c7e';

// A 4x4 board in a rounded frame: a sunk ship, a hit and a miss.
export function BoardIcon({ size = 64, fills = {} }) {
  const colors = { 5: SUNK, 6: SUNK, 7: SUNK, 10: HIT, 13: MISS, ...fills };
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const x = 4 + (i % 4) * 14;
    const y = 4 + Math.floor(i / 4) * 14;
    cells.push(<rect key={i} x={x} y={y} width="14" height="14" fill={colors[i] ?? '#fff'} />);
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2.5" y="2.5" width="59" height="59" rx="6" fill="#fff" />
      {cells}
      <path d="M18 4v56M32 4v56M46 4v56M4 18h56M4 32h56M4 46h56" stroke="#121212" strokeWidth="2.5" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="6" fill="none" stroke="#121212" strokeWidth="3" />
    </svg>
  );
}

export function SmallBoardIcon({ size = 28 }) {
  return <BoardIcon size={size} />;
}

export function MissMark() {
  return (
    <svg className="cell__mark" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4" fill="currentColor" /></svg>
  );
}

export function HitMark() {
  return (
    <svg className="cell__mark" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function TargetMark() {
  return (
    <svg className="cell__mark" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M10 1v5M10 14v5M1 10h5M14 10h5" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
    </svg>
  );
}

export function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z" />
    </svg>
  );
}

export function StatsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M16 11V3H8v6H2v12h20V11h-6zm-6-6h4v14h-4V5zm-6 6h4v8H4v-8zm16 8h-4v-6h4v6z" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
    </svg>
  );
}

export function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// Confetti pieces for the featured card, in the hub palette.
export function Pill({ color }) {
  return <svg width="18" height="8" viewBox="0 0 18 8"><rect x="1" y="1" width="16" height="6" rx="3" fill={color} stroke="#121212" strokeWidth="1.5" /></svg>;
}
export function Dumbbell({ color }) {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10">
      <path d="M5 5h12" stroke="#121212" strokeWidth="2" />
      <circle cx="4.5" cy="5" r="3.5" fill={color} stroke="#121212" strokeWidth="1.5" />
      <circle cx="17.5" cy="5" r="3.5" fill={color} stroke="#121212" strokeWidth="1.5" />
    </svg>
  );
}
export function Diamond() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 1l4 4-4 4-4-4z" fill="none" stroke="#121212" strokeWidth="1.5" /></svg>;
}
export function Sparkle() {
  return <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 0l1.4 4.6L12 6l-4.6 1.4L6 12l-1.4-4.6L0 6l4.6-1.4z" fill="#121212" /></svg>;
}
export function Ring() {
  return <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="2.8" fill="none" stroke="#121212" strokeWidth="1.3" /></svg>;
}
