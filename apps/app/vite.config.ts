import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // The anti-phishing notice names the one domain ZecDoor lives on; a production build
  // without it would show the wrong thing, so it is required.
  if (mode === 'production' && !env.VITE_DOMAIN) {
    throw new Error('Set VITE_DOMAIN (the production domain) to build the app.');
  }
  // The e2e mode lets tests supply their own quote-signing key; it must never ship.
  if (mode === 'production' && env.VITE_E2E) throw new Error('VITE_E2E must not be set for a production build.');
  return {
    base: '/app/',
    plugins: [react()],
    worker: { format: 'es' },
    build: { target: 'es2022', sourcemap: true },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
