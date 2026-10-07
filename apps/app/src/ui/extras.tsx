// The desktop footer. What used to sit beside the action (how a move works, our first mainnet move, fees,
// common questions, the counter) now lives in the docs, on the proof page and on the counter page; the footer
// links to them.

import { DOCS_URL, PRIVACY_URL, SOURCE_URL, TERMS_URL } from '../config';

/**
 * Desktop footer, slim, at the bottom of the window. It carries what left the app screen: how a move
 * works and common questions (docs), fees, what is public, and the proof of our own mainnet moves.
 */
export function Footer() {
  return (
    <footer className="foot">
      <span>ZecDoor · open source (MIT) · no token</span>
      <span className="grow" />
      <a href={`${DOCS_URL}how-it-works`}>How it works</a>
      <a href={`${DOCS_URL}what-is-public`}>What is public</a>
      <a href={`${DOCS_URL}fees`}>Fees</a>
      <a href="#/proof">Proof</a>
      {SOURCE_URL ? (
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          Source
        </a>
      ) : null}
      <a href="https://x.com/ZecDoor" target="_blank" rel="noreferrer">
        @ZecDoor
      </a>
      <a href={TERMS_URL}>Terms</a>
      <a href={PRIVACY_URL}>Privacy</a>
    </footer>
  );
}
