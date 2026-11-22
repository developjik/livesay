/**
 * Browser entry for the probe bundle. esbuild turns this into
 * `dist/probe/runtime.js` (IIFE), which the CLI injects with
 * `page.addInitScript({ content })` before any page script runs.
 */

import { installProbeRuntime } from './runtime.js';

installProbeRuntime(window as unknown as Window & typeof globalThis);
