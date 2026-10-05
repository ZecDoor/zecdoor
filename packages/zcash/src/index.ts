export * from './lightwalletd.js';
export * from './wallet.js';

/** Public gRPC-web proxy for lightwalletd (zec.rocks). Browser access needs gRPC-web. */
export const MAINNET_GRPC_WEB = 'https://zjs.zec.rocks/mainnet';

// Types only: importing worker.ts itself would install a message handler on this thread.
export type { ArrivalRequest, WorkerReply } from './worker.js';
