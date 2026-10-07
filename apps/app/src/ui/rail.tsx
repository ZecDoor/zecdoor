// Small shared pieces for the desktop layout: the 768 px breakpoint, the bridge fee label and rows of
// figures. (The old context rail beside the action was removed with the single-card desktop.)

import { useEffect, useState, type ReactNode } from 'react';
import { DOCS_URL } from '../config';
import { zec } from '../lib/format';
import { Explain } from './parts';

/** Our first mainnet move, where the payout cost less than the quote's figure. */
const FEE_RUN_URL = `${DOCS_URL}testing#mainnet-transactions`;

/** True from 768 px, where the rail is shown; used to skip work the phone layout never shows. */
export function useWide(): boolean {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

export function NetworkFeeLabel() {
  return (
    <span className="with-explain">
      Bridge network{' '}
      <span className="fee-max">
        fee
        <Explain label="the bridge network fee">
          The most NEAR Intents charges to pay out on Zcash, as set in its quote. It can cost less: on our first mainnet move the payout cost 0.00025
          ZEC against 0.00032 in the quote, so more arrived than the minimum. <a href={FEE_RUN_URL}>The run</a>. What you are promised is the minimum
          shown.
        </Explain>
      </span>
    </span>
  );
}

export const networkFee = (withdrawFee?: string) => (withdrawFee ? <span className="fee-max">up to {zec(BigInt(withdrawFee), 0)}</span> : '—');

/** A list of label/value rows inside a panel. */
export function PanelRows({ rows, plain }: { rows: Array<[ReactNode, ReactNode]>; plain?: boolean }) {
  return (
    <dl className={`prows${plain ? ' plain' : ''}`}>
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- recent moves
