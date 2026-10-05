import '@fontsource-variable/manrope';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// @solana/web3.js and spl-token expect Node's Buffer.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

const { AppProvider } = await import('./ui/state');
const { App } = await import('./ui/App');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
