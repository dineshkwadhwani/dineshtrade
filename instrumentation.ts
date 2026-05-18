// Next.js instrumentation hook — runs ONCE per server startup.
// We use it to register node-cron in the long-lived Node.js process.
// (Edge runtime is skipped — no persistent process, no cron.)

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCron } = await import('@/lib/cron')
    startCron()
  }
}
