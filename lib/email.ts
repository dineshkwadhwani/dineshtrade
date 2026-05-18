// Email notifications via Gmail SMTP (nodemailer + Google App Password).
//
// Unified dispatcher: sendEmail(type, data)
//   type='trade_executed'  data: TradeExecutedData
//   type='trade_failed'    data: TradeFailedData
//   type='eod_summary'     data: EODSummaryData
//   type='test'            data: undefined
//
// Required env (only USER + PASS are mandatory; HOST/PORT default to Gmail):
//   SMTP_USER=dinesh.k.wadhwani@gmail.com
//   SMTP_PASS=<16-char Google App Password>
//   NOTIFY_TO=dinesh.k.wadhwani@gmail.com   (optional, defaults to SMTP_USER)
//   SMTP_HOST=smtp.gmail.com                (optional, default shown)
//   SMTP_PORT=587                           (optional, default shown)
//
// All sends are best-effort: if SMTP is not configured, calls return
// {ok:false, skipped:true} so callers can fire-and-forget without try/catch.

import nodemailer, { Transporter } from 'nodemailer'

let cached: Transporter | null = null

function getTransport(): Transporter | null {
  if (cached) return cached
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) return null
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  cached = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass },
  })
  return cached
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

export interface EmailResult {
  ok: boolean
  error?: string
  skipped?: boolean
  messageId?: string
}

// ──────── DATA TYPES ────────

export interface TradeExecutedData {
  account: string
  accountDisplayName?: string
  symbol: string
  symbolName?: string
  side: 'BUY' | 'SELL'
  quantity: number
  price?: number          // approx, used for capital calc
  target1?: number
  target2?: number
  stopLoss?: number
  orderId?: string
  source?: string         // e.g. "ICICI Direct" or "Manual Execute"
  reason?: string         // strategy reason / broker rec text
  mode?: 'auto' | 'manual'
}

export interface TradeFailedData {
  account: string
  accountDisplayName?: string
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  price?: number
  failedAt: 'preflight' | 'kite'
  gate?: string           // preflight gate name when failedAt === 'preflight'
  reason: string
  mode?: 'auto' | 'manual'
}

export interface EODLineItem {
  time?: string            // HH:MM IST
  account: string
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  price?: number
  orderId?: string
  pnl?: number             // realised P&L on this leg (SELLs only)
  reason?: string          // for skipped/failed: the gate or Kite error
}

export interface EODSummaryData {
  date: string             // "18 May 2026 (Monday)"
  mode?: string            // "Catalyst" / "Dip" / "Circuit"
  giftNiftyChange?: string // "+0.3%"
  scans: number
  executed: EODLineItem[]
  failed: EODLineItem[]
  skipped: EODLineItem[]   // preflight rejects
  delivery: EODLineItem[]  // Strategy-2 positions taken to delivery at 3 PM
  realizedPnl?: Record<string, number>   // per-account realized P&L for the day
}

// ──────── DISPATCH ────────

export function sendEmail(type: 'trade_executed', data: TradeExecutedData): Promise<EmailResult>
export function sendEmail(type: 'trade_failed',   data: TradeFailedData):   Promise<EmailResult>
export function sendEmail(type: 'eod_summary',    data: EODSummaryData):    Promise<EmailResult>
export function sendEmail(type: 'test',           data?: undefined):        Promise<EmailResult>
export function sendEmail(type: string, data?: any): Promise<EmailResult> {
  switch (type) {
    case 'trade_executed': return deliver(executedSubject(data), executedBody(data))
    case 'trade_failed':   return deliver(failedSubject(data),   failedBody(data))
    case 'eod_summary':    return deliver(eodSubject(data),      eodBody(data))
    case 'test':           return deliver('[DineshTrade] SMTP test — wiring works', testBody())
    default: return Promise.resolve({ ok: false, error: `Unknown email type: ${type}` })
  }
}

// ──────── ERGONOMIC WRAPPERS ────────

export const sendTradeExecuted = (d: TradeExecutedData) => sendEmail('trade_executed', d)
export const sendTradeFailed   = (d: TradeFailedData)   => sendEmail('trade_failed', d)
export const sendEODSummary    = (d: EODSummaryData)    => sendEmail('eod_summary', d)
export const sendTestEmail     = ()                     => sendEmail('test')

// ──────── DELIVERY ────────

async function deliver(subject: string, text: string): Promise<EmailResult> {
  const tx = getTransport()
  if (!tx) {
    console.warn('[email] SMTP not configured — skipping:', subject)
    return { ok: false, skipped: true, error: 'SMTP not configured' }
  }
  const from = process.env.SMTP_USER!
  const to = process.env.NOTIFY_TO || from
  try {
    const info = await tx.sendMail({ from: `DineshTrade <${from}>`, to, subject, text })
    console.log('[email] sent:', subject, '→', info.messageId)
    return { ok: true, messageId: info.messageId }
  } catch (e) {
    const msg = String(e).slice(0, 300)
    console.error('[email] send failed:', msg)
    return { ok: false, error: msg }
  }
}

// ──────── FORMATTERS ────────

function nowIST(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }) + ' IST'
}

function rupees(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}₹${Math.abs(Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

function signedRupees(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  const abs = Math.abs(Math.round(n)).toLocaleString('en-IN')
  return n >= 0 ? `+₹${abs}` : `-₹${abs}`
}

function row(label: string, value: string, width = 14): string {
  return `  ${(label + ':').padEnd(width)} ${value}`
}

function divider(title: string): string {
  return `\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length - 4))}`
}

// ── Trade Executed ──

function executedSubject(d: TradeExecutedData): string {
  return `[DineshTrade] ✓ ${d.side} ${d.symbol} × ${d.quantity} @ ${rupees(d.price)} — ${d.account}`
}

function executedBody(d: TradeExecutedData): string {
  const capital = d.price !== undefined ? d.price * d.quantity : undefined
  const accLabel = d.accountDisplayName ? `${d.account} (${d.accountDisplayName})` : d.account
  const sym = d.symbolName ? `${d.symbol} — ${d.symbolName}` : d.symbol
  const lines = [
    '✓ ORDER PLACED',
    '',
    row('Account',  accLabel),
    row('Symbol',   sym),
    row('Side',     d.side),
    row('Quantity', `${d.quantity} share${d.quantity === 1 ? '' : 's'}`),
    row('Price',    rupees(d.price)),
    capital !== undefined ? row('Capital', rupees(capital)) : '',
  ]
  if (d.side === 'BUY' && (d.target1 || d.target2 || d.stopLoss)) {
    lines.push(divider('Targets'))
    if (d.target1) lines.push(row('T1 (+1.5%)', `${rupees(d.target1)}  → sell 50% on hit`))
    if (d.target2) lines.push(row('T2 (+2.0%)', `${rupees(d.target2)}  → sell remaining`))
    if (d.stopLoss) lines.push(row('Stop Loss',  `${rupees(d.stopLoss)}  (−1.5%)`))
  }
  lines.push(divider('Context'))
  if (d.source)  lines.push(row('Source',   d.source))
  if (d.reason)  lines.push(row('Reason',   d.reason))
  if (d.orderId) lines.push(row('Order ID', d.orderId))
  lines.push(row('Mode',     d.mode === 'auto' ? 'Auto (cron)' : 'Manual Execute'))
  lines.push(row('Placed',   nowIST()))
  lines.push('')
  lines.push('View in Kite → https://kite.zerodha.com/orders')
  return lines.filter(l => l !== '').join('\n')
}

// ── Trade Failed ──

function failedSubject(d: TradeFailedData): string {
  const prefix = d.failedAt === 'preflight' ? '✗ Skipped' : '✗ Failed'
  return `[DineshTrade] ${prefix}: ${d.side} ${d.symbol} × ${d.quantity} — ${d.account}`
}

function failedBody(d: TradeFailedData): string {
  const capital = d.price !== undefined ? d.price * d.quantity : undefined
  const accLabel = d.accountDisplayName ? `${d.account} (${d.accountDisplayName})` : d.account
  const lines = [
    d.failedAt === 'preflight' ? '✗ TRADE NOT PLACED (preflight gate blocked it)' : '✗ KITE ORDER REJECTED',
    '',
    row('Account',  accLabel),
    row('Symbol',   d.symbol),
    row('Side',     d.side),
    row('Quantity', `${d.quantity} share${d.quantity === 1 ? '' : 's'}`),
    d.price !== undefined ? row('Approx',   rupees(d.price)) : '',
    capital !== undefined ? row('Capital',  rupees(capital)) : '',
    '',
    row('Failed at', d.failedAt === 'preflight' ? `preflight (${d.gate || 'unknown'} gate)` : 'Kite API'),
    row('Reason',   d.reason),
    '',
    row('Mode',     d.mode === 'auto' ? 'Auto (cron)' : 'Manual Execute'),
    row('Time',     nowIST()),
    '',
    d.failedAt === 'preflight'
      ? 'No order was sent to Zerodha — this is a controlled skip by the rules engine.'
      : 'The trade passed our preflight but Kite refused it. Check Kite Console for details.',
    '',
    'View in Kite → https://kite.zerodha.com/orders',
  ]
  return lines.filter(l => l !== '').join('\n')
}

// ── EOD Summary ──

function eodSubject(d: EODSummaryData): string {
  const pieces = [`Scans ${d.scans}`, `Executed ${d.executed.length}`]
  if (d.failed.length)   pieces.push(`Failed ${d.failed.length}`)
  if (d.delivery.length) pieces.push(`Delivery ${d.delivery.length}`)
  return `[DineshTrade] EOD ${d.date.split(' (')[0]} — ${pieces.join(' · ')}`
}

function eodBody(d: EODSummaryData): string {
  const lines: string[] = [
    'DAILY TRADING SUMMARY',
    '═'.repeat(50),
    row('Date',  d.date),
    d.mode             ? row('Mode',           d.mode)                : '',
    d.giftNiftyChange  ? row('GIFT Nifty',     d.giftNiftyChange)     : '',
    '',
    row('Scans',           String(d.scans)),
    row('Executed',        String(d.executed.length)),
    row('Failed',          String(d.failed.length)),
    row('Preflight skips', String(d.skipped.length)),
    row('To delivery',     String(d.delivery.length)),
  ]

  // Realized P&L block
  if (d.realizedPnl && Object.keys(d.realizedPnl).length) {
    const total = Object.values(d.realizedPnl).reduce((s, v) => s + (v || 0), 0)
    lines.push(divider('Realized P&L'))
    for (const [acc, pnl] of Object.entries(d.realizedPnl)) {
      lines.push(row(acc, signedRupees(pnl)))
    }
    lines.push(row('Total', signedRupees(total)))
  }

  const fmt = (e: EODLineItem) => {
    const t = e.time ? e.time.padEnd(6) : ''
    const acc = e.account.padEnd(8)
    const side = e.side.padEnd(4)
    const sym = e.symbol.padEnd(12)
    const qty = `× ${e.quantity}`.padEnd(6)
    const price = e.price !== undefined ? `@ ${rupees(e.price)}` : ''
    const tail = e.orderId ? `  [${e.orderId}]` : (e.reason ? `  — ${e.reason}` : '')
    const pnl = e.pnl !== undefined ? `  ${signedRupees(e.pnl)}` : ''
    return `  ${t}${acc} ${side} ${sym} ${qty} ${price}${pnl}${tail}`
  }

  lines.push(divider(`Executed (${d.executed.length})`))
  lines.push(d.executed.length ? d.executed.map(fmt).join('\n') : '  (none)')

  if (d.failed.length) {
    lines.push(divider(`Failed at Kite (${d.failed.length})`))
    lines.push(d.failed.map(fmt).join('\n'))
  }

  if (d.delivery.length) {
    lines.push(divider(`Taken to Delivery — Strategy 2 → 1 handoff (${d.delivery.length})`))
    lines.push(d.delivery.map(fmt).join('\n'))
  }

  if (d.skipped.length) {
    lines.push(divider(`Preflight Skips (${d.skipped.length})`))
    lines.push(d.skipped.map(fmt).join('\n'))
  }

  lines.push('')
  lines.push('View all orders → https://kite.zerodha.com/orders')

  return lines.filter(l => l !== '').join('\n')
}

// ── Test ──

function testBody(): string {
  return [
    'SMTP wiring works.',
    '',
    row('From',      process.env.SMTP_USER || '(unset)'),
    row('To',        process.env.NOTIFY_TO || process.env.SMTP_USER || '(unset)'),
    row('Host',      process.env.SMTP_HOST || 'smtp.gmail.com (default)'),
    row('Port',      process.env.SMTP_PORT || '587 (default)'),
    row('Time',      nowIST()),
    '',
    'You can safely ignore this email. It confirms that DineshTrade can send mail',
    'on your behalf using the Google App Password in .env.local.',
  ].join('\n')
}
