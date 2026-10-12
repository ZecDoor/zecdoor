import '@fontsource-variable/manrope';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// @solana/web3.js and spl-token expect Node's Buffer.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

// Both chunks in parallel: one round trip fewer before the first paint.
const [{ AppProvider }, { App }] = await Promise.all([import('./ui/state'), import('./ui/App')]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
