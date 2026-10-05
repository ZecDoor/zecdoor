import { ONE_CLICK_SIGNING_KEY } from '@zecdoor/solana';
import { MAINNET_GRPC_WEB } from '@zecdoor/zcash';

/** The one domain ZecDoor is served from. Required at build time (vite.config.ts). */
export const DOMAIN: string = import.meta.env.VITE_DOMAIN || location.hostname;

/** Our server (health, geo, sanctions list, counter). Same origin in production. */
export const API: string = import.meta.env.VITE_API ?? '/api';

/**
 * Solana RPC endpoints that answer browser requests without a key (checked 5 Oct 2026:
 * api.mainnet-beta.solana.com refuses any request carrying a browser Origin). Tried in order.
 * Every RPC sees the wallet address it is asked about; none of these are ours.
 */
export const SOLANA_RPCS: string[] = (import.meta.env.VITE_SOLANA_RPCS ?? 'https://rpc.solanatracker.io/public,https://public.rpc.solanavibestation.com')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

/** gRPC-web lightwalletd used for the in-browser arrival check (zec.rocks). */
export const LIGHTWALLETD: string = import.meta.env.VITE_LIGHTWALLETD ?? MAINNET_GRPC_WEB;

/** This app's own URL, for the Phantom deeplink and QR code. */
export const APP_URL = `${location.origin}${import.meta.env.BASE_URL}`;
export const DOCS_URL = '/docs/';
export const TERMS_URL = '/terms';
export const PRIVACY_URL = '/privacy';
export const SOURCE_URL = 'https://github.com/ZecDoor/zecdoor';
export const NEAR_SUPPORT_URL = 'https://t.me/near_intents';

export const WALLET_APPS = {
  zodl: 'https://zodl.com',
  zkool: 'https://hhanh00.github.io/zkool2/', // project homepage per github.com/hhanh00/zkool2
} as const;

/** A move that has not reached the next step after this long is "taking longer than usual". */
export const SLOW_AFTER_MS = 10 * 60_000;
/** A real quote not signed within this long is discarded (research p1-oneclick §A.5 #4). */
export const QUOTE_FRESH_MS = 10 * 60_000;
export const STATUS_POLL_MS = 5_000;

/**
 * The key 1Click signs quotes with. Only the e2e test build (`vite --mode e2e`, never a
 * production build: see vite.config.ts) may replace it, so tests can sign their own quotes.
 */
export const QUOTE_KEY: string =
  (import.meta.env.VITE_E2E === '1' && (window as unknown as { __ZECDOOR_E2E__?: { quoteKey?: string } }).__ZECDOOR_E2E__?.quoteKey) ||
  ONE_CLICK_SIGNING_KEY;
