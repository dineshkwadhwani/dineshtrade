const { createServer } = require('http')
const next = require('next')
const { parse } = require('url')
const { register } = require('tsx/cjs/api')

const tsxScope = register({ namespace: 'dineshtrade-server' })
const { startCron } = tsxScope.require('./lib/cron.ts', __filename)

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOST || '0.0.0.0'
const port = Number.parseInt(process.env.PORT || '3000', 10)

async function main() {
  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()

  await app.prepare()
  startCron()

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