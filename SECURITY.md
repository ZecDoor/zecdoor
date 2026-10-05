# Security

ZecDoor builds Solana transactions in the user's browser and asks Phantom to sign them, so a flaw in what the page
builds or checks matters. Thank you for looking.

## Reporting a problem

Please do not post exploit details in a public issue.

Email **jagadeesh26062002@gmail.com** with the details. If you prefer GitHub, open an issue titled **"Security: private contact
request"** with no details of the problem, and we reply there with a private channel. Fixes are made in private before
anything is published.

The live site lists the current contact at `/.well-known/security.txt`.

## What is in scope

- The transaction checks: quote-signature verification, the instruction allowlist and the simulation
  (`packages/solana`), and anything that would let a page or a quote get a user to sign something else.
- The in-browser wallet: seed generation, the backup check, viewing-key storage and the arrival scan
  (`crates/zecdoor-wasm`, `packages/zcash`, `apps/app`).
- The server (`apps/server`): anything that would let it learn or store an address, or count something it should not.
- The site's Content Security Policy and headers (`deploy/site/_headers`).

Out of scope: NEAR Intents, Jupiter, Phantom and the public RPC and lightwalletd services themselves. Please report
those to their own teams.
