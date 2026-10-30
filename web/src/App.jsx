import { useCallback, useEffect, useState } from 'react';
import { engine, FUNDED_EVENT } from './battle.js';
import { HelpModal, InfoModal, SettingsModal, StatsModal, WalletModal } from './components.jsx';
import { burnerKey, LOW_BALANCE } from './game.js';
import { GitHubIcon, HelpIcon, InfoIcon, SettingsIcon, SmallBoardIcon, StatsIcon } from './icons.jsx';
import { NETWORKS } from './networks.js';
import { Hub, PlayPage, RacePage } from './pages.jsx';
import { Toaster } from './toast.jsx';
import { privateKeyToAccount } from 'viem/accounts';

export const REPO_URL = 'https://github.com/hummusonrails/confidential-battleship-arbitrum';

function useRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [route, (to) => { window.location.hash = to; }];
}

function useSettings() {
  const [settings, setSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('battleship-settings')) ?? {}; } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('battleship-settings', JSON.stringify(settings)); } catch {}
    const root = document.documentElement;
    // Unset follows the system; once toggled, the choice sticks either way.
    if (settings.dark === undefined) delete root.dataset.theme; else root.dataset.theme = settings.dark ? 'dark' : 'light';
    if (settings.contrast) root.dataset.contrast = 'high'; else delete root.dataset.contrast;
  }, [settings]);
  return [settings, setSettings];
}

const address = privateKeyToAccount(burnerKey()).address;

export default function App() {
  const [route, navigate] = useRoute();
  const [settings, setSettings] = useSettings();
  const [modal, setModal] = useState(null); // { type, networkKey?, onPlayAgain? }
  const [balances, setBalances] = useState({});

  const playMatch = route.match(/^\/play\/([a-z-]+)$/);
  const networkKey = playMatch && NETWORKS[playMatch[1]] ? playMatch[1] : null;
  const statsNetwork = networkKey ?? 'arbitrum-sepolia';

  const registerBalance = useCallback((key, value) => {
    if (value !== null && value !== undefined) setBalances((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);
  const refreshBalances = useCallback(() => {
    Object.keys(NETWORKS).forEach((key) => engine(key).balance().then((b) => registerBalance(key, Number(b))).catch(() => {}));
  }, [registerBalance]);
  useEffect(() => { if (modal?.type === 'wallet') refreshBalances(); }, [modal, refreshBalances]);
  // Both balances stay current on every page; game pages also report theirs after each shot.
  useEffect(() => {
    refreshBalances();
    const timer = setInterval(refreshBalances, 30_000);
    return () => clearInterval(timer);
  }, [refreshBalances]);

  const open = (type, extra = {}) => setModal({ type, ...extra });
  const close = () => setModal(null);
  const onStats = useCallback((key, onPlayAgain) => setModal({ type: 'stats', networkKey: key, onPlayAgain }), []);
  const walletLabel = Object.entries(NETWORKS)
    .map(([key, net]) => `${net.label} ${balances[key] === undefined ? 'loading' : `${balances[key].toFixed(4)} ETH`}`)
    .join(', ');

  return (
    <div className="app">
      <header className="toolbar">
        <a className="toolbar__brand" href="#/" aria-label="Battleship home">
          <SmallBoardIcon size={28} />
          <span>
            <span className="toolbar__title">Battleship</span><br />
            <span className="toolbar__sub">Confidential, on Fhenix CoFHE</span>
          </span>
        </a>
        <button className="icon-btn" type="button" aria-label="About CoFHE and Arbitrum" onClick={() => open('info')}><InfoIcon /></button>
        <button className="icon-btn" type="button" aria-label="Help" onClick={() => open('help')}><HelpIcon /></button>
        <button className="icon-btn" type="button" aria-label="Statistics" onClick={() => open('stats', { networkKey: statsNetwork })}><StatsIcon /></button>
        <button className="icon-btn" type="button" aria-label="Settings" onClick={() => open('settings')}><SettingsIcon /></button>
        <button className="wallet-pill" type="button" onClick={() => open('wallet')} aria-label={`Wallet: ${walletLabel}`}>
          {Object.entries(NETWORKS).map(([key, net]) => (
            <span key={key} className={`wallet-pill__net${key === networkKey ? ' current' : ''}`}>
              <span className={`wallet-pill__dot${balances[key] !== undefined && balances[key] < LOW_BALANCE ? ' empty' : ''}`} />
              <span className="wallet-pill__name">{net.short}</span>
              <span className="wallet-pill__bal">{balances[key] === undefined ? '…' : `${balances[key].toFixed(4)} ETH`}</span>
            </span>
          ))}
        </button>
      </header>

      {networkKey ? (
        <PlayPage key={networkKey} networkKey={networkKey} onHelp={() => open('help')} onWallet={() => open('wallet')}
          onStats={onStats} registerBalance={registerBalance} />
      ) : route === '/race' ? (
        <RacePage onWallet={() => open('wallet')} registerBalance={registerBalance} />
      ) : (
        <Hub navigate={navigate} onHelp={() => open('help')} />
      )}

      <footer className="footer">
        <span>Designed with ❤️ by the Arbitrum DevRel team</span>
        <span className="footer__divider" aria-hidden="true" />
        <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub"><GitHubIcon /><span>GitHub</span></a>
      </footer>

      <Toaster />
      {modal?.type === 'info' && <InfoModal onClose={close} />}
      {modal?.type === 'help' && <HelpModal onClose={close} />}
      {modal?.type === 'stats' && (
        <StatsModal networkKey={modal.networkKey} onClose={close}
          onPlayAgain={modal.onPlayAgain && (() => { close(); modal.onPlayAgain(); })} />
      )}
      {modal?.type === 'settings' && <SettingsModal settings={settings} setSettings={setSettings} onClose={close} />}
      {modal?.type === 'wallet' && <WalletModal address={address} balances={balances} onClose={close}
          onFunded={() => { refreshBalances(); window.dispatchEvent(new Event(FUNDED_EVENT)); }} />}
    </div>
  );
}
