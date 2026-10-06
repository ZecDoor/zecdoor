/** Errors from the wallet layer, kept apart so code that only checks them does not load it. */
export class WalletError extends Error {
  constructor(
    readonly code: 'cancelled' | 'busy' | 'account_changed' | 'unsupported' | 'not_connected' | 'failed',
    message: string,
  ) {
    super(message);
  }
}
