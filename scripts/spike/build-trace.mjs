// Bundle scripts/spike/<name>.ts with every engine import of ./tracker.js redirected to the
// recording wrapper (scripts/spike/tracker-traced.ts); the wrapper's own import of it resolves to
// the real tracker.ts. Production bundles are untouched.
import { build } from 'esbuild'
import { resolve } from 'node:path'

const src = resolve('packages/engine/src')
const redirect = {
  name: 'trace-tracker',
  setup(b) {
    b.onResolve({ filter: /tracker\.js$/ }, (args) => {
      if (resolve(args.resolveDir, args.path) !== resolve(src, 'tracker.js')) return undefined
      if (args.importer.endsWith('tracker-traced.ts')) return { path: resolve(src, 'tracker.ts') }
      return { path: resolve('scripts/spike/tracker-traced.ts') }
    })
  },
}
for (const name of process.argv.slice(2)) {
  await build({
    entryPoints: [`scripts/spike/${name}.ts`], bundle: true, platform: 'node', format: 'esm', target: 'node22',
    outfile: `dist-spike/${name}.mjs`, sourcemap: true, logLevel: 'warning', plugins: [redirect],
  })
}
