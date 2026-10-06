import { ASSET, type MoveKind } from '@zecdoor/solana';
import { PublicKey } from '@solana/web3.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { exitMinimum, oneClick, type Destination, type TopUpPlan } from '../lib/move';
import { getPhantom } from '../lib/phantom';
import type { WalletSnapshot } from '../lib/wallet';
import { geo as fetchGeo, health as fetchHealth, type Geo, type Health } from '../lib/server';
import { readBalances, type Balances } from '../lib/solana';
import { getWallet, type BrowserWallet, type MoveRecord, listMoves } from '../lib/store';

/** What the user is about to do, built up across screens. Lives in memory only. */
export interface Draft {
  kind: MoveKind;
  amount: bigint;
  topUp?: TopUpPlan;
  /** Buy: what the user pays with and how much, in base units. */
  pay?: { symbol: 'USDC' | 'SOL'; amount: bigint };
  dest?: Destination;
}

export interface Prices {
  zec?: number;
  sol?: number;
  usdc?: number;
}

/** Shown once on the home screen when the wallet switched accounts while something was under way. */
export interface Notice {
  from: string;
  to: string;
}

interface AppState {
  wallet$: WalletSnapshot;
  owner: PublicKey | null;
  connect(name: string): Promise<void>;
  disconnect(): Promise<void>;
  signAndSend: typeof import('../lib/wallet').signAndSend;
  notice: Notice | null;
  clearNotice(): void;
  balances: Balances | null;
  balanceError: string | null;
  refreshBalances(): Promise<void>;
  minimum: bigint | null;
  wallet: BrowserWallet | null;
  reloadWallet(): Promise<void>;
  moves: MoveRecord[];
  reloadMoves(): Promise<void>;
  health: Health | null;
  geo: Geo | null;
  prices: Prices;
  draft: Draft | null;
  setDraft(d: Draft | null): void;
  /** The 24 words between the backup screen and the check. Never stored. */
  seed: React.MutableRefObject<{ mnemonic: string; ufvk: string; birthday: number } | null>;
}

const Ctx = createContext<AppState | null>(null);

/**
 * Before the wallet layer has loaded, what the page can tell at once: whether Phantom injected
 * itself. The first screen is drawn from this, so nothing moves when the layer arrives.
 */
const firstGuess = (): WalletSnapshot => ({
  ready: false,
  options: getPhantom() ? [{ name: 'Phantom', icon: null, supported: true, legacy: true }] : [],
  connected: null,
  connecting: false,
});

/**
 * The wallet layer is loaded after the first paint, so the page shows without waiting for it.
 * Every caller awaits this one promise.
 */
let walletModule: Promise<typeof import('../lib/wallet')> | null = null;
const loadWallet = () => (walletModule ??= import('../lib/wallet'));

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [wallet$, setWallet$] = useState<WalletSnapshot>(firstGuess);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [minimum, setMinimum] = useState<bigint | null>(null);
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [prices, setPrices] = useState<Prices>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const seed = useRef<AppState['seed']['current']>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  useEffect(() => {
    let off = () => {};
    let live = true;
    void loadWallet().then((w) => {
      if (!live) return;
      off = w.subscribeWallet(() => setWallet$(w.getWalletSnapshot()));
      setWallet$(w.getWalletSnapshot());
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  const address = wallet$.connected?.address ?? null;
  const owner = useMemo(() => (address ? new PublicKey(address) : null), [address]);

  // A different account means different balances, and nothing prepared for the old one may be signed.
  const last = useRef<string | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = address;
    if (prev === address) return;
    setBalances(null);
    setMinimum(null);
    if (prev && address && draftRef.current) setNotice({ from: prev, to: address });
    setDraft(null);
  }, [address]);

  const connect = useCallback(async (name: string) => (await loadWallet()).connectWallet(name), []);
  const disconnect = useCallback(async () => {
    await (await loadWallet()).disconnectWallet();
    setDraft(null);
  }, []);
  const signAndSend = useCallback<AppState['signAndSend']>(async (tx, expected) => (await loadWallet()).signAndSend(tx, expected), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  const refreshBalances = useCallback(async () => {
    if (!owner) return;
    try {
      setBalances(await readBalances(owner));
      setBalanceError(null);
    } catch (e) {
      setBalanceError((e as Error).message);
    }
  }, [owner]);

  const reloadWallet = useCallback(async () => setWallet((await getWallet()) ?? null), []);
  const reloadMoves = useCallback(async () => setMoves(await listMoves()), []);

  useEffect(() => {
    void reloadWallet();
    void reloadMoves();
    void fetchHealth().then(setHealth);
    void fetchGeo().then(setGeo);
    void oneClick
      .tokens()
      .then((ts) => {
        const p = (id: string) => ts.find((t) => t.assetId === id)?.price;
        setPrices({ zec: p(ASSET.zec), sol: p(ASSET.sol), usdc: p(ASSET.solanaUsdc) });
      })
      .catch(() => {});
    const t = setInterval(() => void fetchHealth().then(setHealth), 60_000);
    return () => clearInterval(t);
  }, [reloadWallet, reloadMoves]);

  useEffect(() => {
    if (!owner) return;
    void refreshBalances();
    void exitMinimum(owner).then(setMinimum);
  }, [owner, refreshBalances]);

  const value = useMemo<AppState>(
    () => ({
      wallet$,
      owner,
      connect,
      disconnect,
      signAndSend,
      notice,
      clearNotice,
      balances,
      balanceError,
      refreshBalances,
      minimum,
      wallet,
      reloadWallet,
      moves,
      reloadMoves,
      health,
      geo,
      prices,
      draft,
      setDraft,
      seed,
    }),
    [wallet$, owner, connect, disconnect, signAndSend, notice, clearNotice, balances, balanceError, refreshBalances, minimum, wallet, reloadWallet, moves, reloadMoves, health, geo, prices, draft],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
