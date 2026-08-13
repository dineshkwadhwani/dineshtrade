// Load .env.local before anything else — cron-runtime needs these vars at module init time
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') })

const { createServer } = require('http')
const next = require('next')
const { parse } = require('url')

const { startCron } = require('./dist/cron-runtime.cjs')

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOST || '0.0.0.0'
const port = Number.parseInt(process.env.PORT || '3000', 10)

function logStartupEnv() {
  const rawCustomerIds = (process.env.CUSTOMER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const snapshot = {
    nodeEnv: process.env.NODE_ENV || null,
    host: process.env.HOST || null,
    port: process.env.PORT || null,
    zerodhaEnvironment: process.env.ZERODHA_ENVIRONMENT || null,
    cronEnabledRaw: process.env.CRON_ENABLED ?? null,
    cronEnabledNormalized: String(process.env.CRON_ENABLED || '').trim().toLowerCase() === 'true',
    cronRouteBootstrap: process.env.CRON_ROUTE_BOOTSTRAP ?? null,
    heartbeatDbEnabled: process.env.HEARTBEAT_DB_ENABLED ?? null,
    strategyScanDbEnabled: process.env.STRATEGY_SCAN_DB_ENABLED ?? null,
    customerIdsCount: rawCustomerIds.length,
    primaryCustomerIdSuffix: rawCustomerIds[0] ? rawCustomerIds[0].slice(-6) : null,
  }

  console.log('[server] startup env snapshot (non-sensitive):', snapshot)
}

async function main() {
  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()

  await app.prepare()
  logStartupEnv()
  // startCron() is async (Phase 5 — reads Fixed Rules before scheduling) and
  // throws if CRON_ENABLED=true but CUSTOMER_ID is unset. Await it here so a
  // misconfigured customer EC2 fails fast at startup, before the HTTP server
  // ever accepts a request, instead of crashing later via an unhandled
  // rejection once the first tick would have fired.
  await startCron()

  createServer((req, res) => {
    const parsedUrl = parse(req.url || '/', true)
    handle(req, res, parsedUrl).catch(err => {
      console.error('[server] request handling failed:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    })
  }).listen(port, hostname, () => {
    console.log(`[server] listening on http://${hostname}:${port} · env=${process.env.NODE_ENV || 'development'}`)
  })
}

main().catch(err => {
  console.error('[server] failed to start:', err)
  process.exit(1)
})