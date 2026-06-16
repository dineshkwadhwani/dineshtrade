import { build } from 'esbuild'

await build({
  entryPoints: ['lib/cron.ts'],
  outfile: 'dist/cron-runtime.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  logLevel: 'info',
})