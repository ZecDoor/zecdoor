import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { APP_URL } from '../config';
import { short } from '../lib/format';
import { isMobile, phantomBrowseLink } from '../lib/phantom';
import type { WalletOption } from '../lib/wallet';
import { Qr } from './parts';
import { useApp } from './state';

// ---------------------------------------------------------------- picker open state

let pickerOpen = false;
const pickerListeners = new Set<() => void>();
const setPicker = (v: boolean) => {
  pickerOpen = v;
  pickerListeners.forEach((l) => l());
};
export const openPicker = () => setPicker(true);
const usePickerOpen = () =>
  useSyncExternalStore(
    (l) => {
      pickerListeners.add(l);
      return () => pickerListeners.delete(l);
    },
    () => pickerOpen,
  );

// ---------------------------------------------------------------- pieces

export function WalletIcon({ icon, size = 20 }: { icon: string | null; size?: number }) {
  if (icon) return <img className="wlogo" src={icon} alt="" width={size} height={size} />;
  return (
    <svg className="wlogo" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M15.5 12.5h3" />
    </svg>
  );
}

/**
 * A menu in the top layer (popover), so no card or scroll box can clip it. Arrow keys move between
 * items, Escape or a click outside closes it and focus returns to the button.
 */
export function Menu({ button, label, items }: { button: (p: { onClick: () => void; 'aria-expanded': boolean; 'aria-controls': string; ref: React.Ref<HTMLButtonElement> }) => ReactNode; label: string; items: Array<{ label: string; onSelect: () => void; danger?: boolean }> }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (isOpen) {
        const r = btn.current!.getBoundingClientRect();
        el.style.top = `${r.bottom + 8}px`;
        el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
        el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
      }
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, []);

  const close = () => {
    pop.current?.hidePopover();
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const all = Array.from(pop.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') all[(i + 1) % all.length]?.focus();
    else if (e.key === 'ArrowUp') all[(i - 1 + all.length) % all.length]?.focus();
    else if (e.key === 'Home') all[0]?.focus();
    else if (e.key === 'End') all[all.length - 1]?.focus();
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
  };

  return (
    <>
      {button({ onClick: () => pop.current?.togglePopover(), 'aria-expanded': open, 'aria-controls': id, ref: btn })}
      <div ref={pop} id={id} popover="auto" className="menu" role="menu" aria-label={label} onKeyDown={onKey}>
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className={it.danger ? 'danger' : undefined}
            onClick={() => {
              close();
              it.onSelect();
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}

export function useWalletMenuItems(): Array<{ label: string; onSelect: () => void; danger?: boolean }> {
  const app = useApp();
  const address = app.wallet$.connected?.address;
  return [
    { label: 'Copy address', onSelect: () => void (address && navigator.clipboard.writeText(address).catch(() => {})) },
    { label: 'Change wallet', onSelect: openPicker },
    { label: 'Disconnect', onSelect: () => void app.disconnect(), danger: true },
  ];
}

/** The wallet control in the top bar (768 px and wider). */
export function WalletButton() {
  const app = useApp();
  const w = app.wallet$;
  const items = useWalletMenuItems();
  if (!w.ready) return <span className="wbtn ghost" aria-hidden="true" />;
  if (!w.connected)
    return (
      <button type="button" className="wbtn primary" onClick={openPicker} disabled={w.connecting}>
        {w.connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  const c = w.connected;
  return (
    <Menu
      label="Wallet"
      items={items}
      button={(p) => (
        <button type="button" className="wbtn" aria-label={`${c.name} wallet ${short(c.address, 4, 3)}, open wallet menu`} {...p}>
          <span className="dot" />
          <WalletIcon icon={c.icon} />
          <span className="mono">{short(c.address, 4, 3)}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
    />
  );
}

// ---------------------------------------------------------------- the picker

/** Connect a wallet: a dialog in the top layer on computers, a bottom sheet on phones. */
export function WalletPicker() {
  const open = usePickerOpen();
  const app = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const pick = async (o: WalletOption) => {
    setError(null);
    setBusy(o.name);
    try {
      await app.connect(o.name);
      setPicker(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const supported = app.wallet$.options.filter((o) => o.supported);
  const others = app.wallet$.options.filter((o) => !o.supported);
  const link = phantomBrowseLink(APP_URL);

  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={() => setPicker(false)} onClick={(e) => e.target === ref.current && setPicker(false)}>
      <div className="sheet-head">
        <h2 id={titleId}>Connect a wallet</h2>
        <button type="button" className="x" aria-label="Close" onClick={() => setPicker(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <p className="sub">Connecting shares only your public Solana address with this page. Nothing is signed.</p>
      {supported.length ? (
        <ul className="wl">
          {supported.map((o) => (
            <li key={o.name}>
              <button type="button" className="wi rec" onClick={() => void pick(o)} disabled={!!busy}>
                <WalletIcon icon={o.icon} size={24} />
                {busy === o.name ? `Waiting for ${o.name}…` : o.name}
                <span className="chip amb">Recommended</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="state info" role="status">
          <div className="state-body">
            <strong>You need a Solana wallet</strong>
            <span>Phantom is the one we support and test against. Install it, then reload this page{isMobile() ? ', or open this page inside Phantom.' : '.'}</span>
            <a className="btn sm" href={isMobile() ? link : 'https://phantom.com/download'} target={isMobile() ? undefined : '_blank'} rel="noreferrer">
              {isMobile() ? 'Open in Phantom' : 'Get Phantom'}
            </a>
          </div>
        </div>
      )}
      {others.length ? (
        <div className="grp">
          <span className="cap">Detected, not supported yet</span>
          <ul className="wl">
            {others.map((o) => (
              <li key={o.name} className="wi off">
                <WalletIcon icon={o.icon} size={24} />
                {o.name}
                <span className="tag">Not tested end to end yet</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p className="err" role="alert" style={{ margin: 0, fontSize: 14 }}>
          {error}
        </p>
      ) : null}
      {!isMobile() ? (
        <div className="sheet-foot">
          <Qr text={link} label="QR code that opens ZecDoor in Phantom on your phone" />
          <span className="sub">On a phone? Scan to open this page inside Phantom.</span>
        </div>
      ) : null}
    </dialog>
  );
}
