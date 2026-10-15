import { isAbsolute } from 'node:path';
import { build } from 'esbuild';

// Workspace packages (@orbit/*) ship TypeScript sources and are bundled here;
// every other package stays external and is resolved from node_modules at runtime.
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'external-npm-packages',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (
            args.kind === 'entry-point' ||
            isAbsolute(args.path) ||
            args.path.startsWith('@orbit/')
          ) {
            return undefined;
          }
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
