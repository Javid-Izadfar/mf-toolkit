import { defineConfig } from 'vite'

// No React plugin needed: the playground uses createElement directly (no JSX),
// so esbuild transpiles the TS as-is. dedupe keeps a single React copy — the
// packages resolve up to the hoisted workspace-root node_modules.
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5199, strictPort: true },
})
