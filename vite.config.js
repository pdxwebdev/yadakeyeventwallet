// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  resolve: {
    alias: {
      crypto: "crypto-browserify",
      '@tabler/icons-react': '@tabler/icons-react/dist/esm/icons/index.mjs',
    },
  },
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    nodePolyfills({
      // To add only specific polyfills, add them here. If no option is passed, adds all polyfills
      include: [
        "crypto", // For ethers.js crypto operations
        "stream", // Dependency of crypto-browserify
        "util",   // For inherits and other utils
        "buffer", // For Buffer polyfill
        "path",   // Already included
      ],
      // To exclude specific polyfills, add them to this list. Note: if include is provided, this has no effect
      exclude: [
        "http", // Excludes the polyfill for `http` and `node:http`.
      ],
      // Whether to polyfill specific globals.
      globals: {
        Buffer: true, // can also be 'build', 'dev', or false
        global: true,
        process: true,
      },
      // Override the default polyfills for specific modules.
      overrides: {
        // Since `fs` is not supported in browsers, we can use the `memfs` package to polyfill it.
        fs: "memfs",
      },
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      jsx: "automatic",
    },
  },

  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: 'index.html',
        background: 'src/background.js',
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  base: '/wallet/',
});
