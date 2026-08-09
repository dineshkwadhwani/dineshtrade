const { createServer } = require('http')
const next = require('next')
const { parse } = require('url')

const { startCron } = require('./dist/cron-runtime.cjs')

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOST || '0.0.0.0'
const port = Number.parseInt(process.env.PORT || '3000', 10)

async function main() {
  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()

  await app.prepare()
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