/// <reference types="vite/client" />

/**
 * Absolute path to the developer's project checkout, injected by
 * `vite.config.ts` via `define`. Empty string in production builds — see
 * `src/lib/vscode-url.ts` for the consumer.
 */
declare const __PROJECT_ROOT__: string;
