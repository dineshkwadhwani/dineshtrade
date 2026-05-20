// Runtime strategy.json overlay. Same pattern as watchlistStore: bundled
// `config/strategy.json` is the seed; once the Settings UI saves an edit, we
// write to `~/dineshtrade/data/strategy.json` and prefer that file going
// forward. Survives deploys (data/ is never wiped). Read is sync + cached so
// hot paths (cron tick, etc.) don't pay the file-read cost; cache is
// invalidated on every save.

import { promises as fs, readFileSync, existsSync } from 'fs'
import * as path from 'path'
import bundled from '@/config/strategy.json'

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || ''
const RUNTIME_PATH = STATE_FILE_PATH ? path.join(path.dirname(STATE_FILE_PATH), 'strategy.json') : ''

let cache: any = null

// Migrate legacy strategy ids. Currently: rename 'oscillator' → 'accumulator'
// (the universal "keeper" strategy that everything hands off to). One-shot
// at first read after this refactor; subsequent saves persist the new id.
function migrateLegacyIds(cfg: any): { changed: boolean; cfg: any } {
  if (!cfg || !Array.isArray(cfg.strategies)) return { changed: false, cfg }
  let changed = false
  const strategies = cfg.strategies.map((s: any) => {
    if (s && s.id === 'oscillator') {
      changed = true
      const newName = typeof s.name === 'string' && /oscillator/i.test(s.name) ? 'Accumulator' : s.name
      return { ...s, id: 'accumulator', name: newName }
    }
    return s
  })
  if (!changed) return { changed: false, cfg }
  return { changed: true, cfg: { ...cfg, strategies } }
}

export function getRuntimeStrategyConfig(): any {
  if (cache) return cache
  if (RUNTIME_PATH && existsSync(RUNTIME_PATH)) {
    try {
      const raw = readFileSync(RUNTIME_PATH, 'utf8')
      const parsed = JSON.parse(raw)
      const m = migrateLegacyIds(parsed)
      if (m.changed) console.log('[strategyConfigStore] migrated legacy id oscillator → accumulator')
      cache = m.cfg
      return cache
    } catch (err) {
      console.warn('[strategyConfigStore] runtime read failed, falling back to bundled:', String(err).slice(0, 200))
    }
  }
  cache = migrateLegacyIds(bundled).cfg
  return cache
}

export async function saveRuntimeStrategyConfig(next: any): Promise<void> {
  if (!RUNTIME_PATH) throw new Error('STATE_FILE_PATH not configured — cannot persist strategy.json changes in this environment')
  const dir = path.dirname(RUNTIME_PATH)
  await fs.mkdir(dir, { recursive: true })
  const tmp = RUNTIME_PATH + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, RUNTIME_PATH)
  cache = next   // immediate cache update so the next sync read sees the change
}

export function invalidateStrategyConfigCache(): void {
  cache = null
}
