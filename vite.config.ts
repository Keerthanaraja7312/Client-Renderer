import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The client renderer shares the builder's plugin runtime. That runtime's
// registry.ts imports the module-federation virtual module `__federation__`
// (used by the builder to load *remote* plugins). The viewer has no remotes,
// so it is aliased to a harmless stub. If your pages use a remote plugin,
// add @originjs/vite-plugin-federation here the same way the builder does
// and remove the alias.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      __federation__: path.resolve(__dirname, 'src/client/federationStub.ts'),
    },
  },
  server: { port: 5175, strictPort: true, host: true },
});