import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  logLevel: 'info',
  legalComments: 'none',
};

await build({
  ...shared,
  entryPoints: ['src/probe/entry.ts'],
  format: 'iife',
  outfile: 'dist/probe/runtime.bundle.js',
  banner: {
    js: '/* livesay probe — injected before page scripts; records ariaNotify calls and live-region mutations. */',
  },
});

await build({
  ...shared,
  entryPoints: ['src/announcer/browser-entry.ts'],
  format: 'iife',
  globalName: 'Livesay',
  outfile: 'dist/browser/livesay.js',
  banner: {
    js: '/* livesay — createStreamingAnnouncer, sinks and the simulator, for <script> tags and the demo. */',
  },
});

process.stdout.write('bundles written to dist/probe/runtime.bundle.js and dist/browser/livesay.js\n');
