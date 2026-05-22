import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // @reineira-os/sdk hardcodes the Node entry of @cofhe/sdk. In a browser
      // build the web entry is the correct, bundleable one (the app already
      // uses @cofhe/sdk/web for its own FHE flows).
      '@cofhe/sdk/node': '@cofhe/sdk/web',
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['tfhe', 'node-tfhe'],
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    headers: {
      // Required for TFHE WASM SharedArrayBuffer
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
