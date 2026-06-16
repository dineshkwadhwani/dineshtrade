// Cron is started by server.ts so PM2 owns a single long-lived scheduler.
// Keep the instrumentation hook as a no-op to avoid duplicate startup from
// transient Next.js runtime contexts.

export async function register() {
  return
}
