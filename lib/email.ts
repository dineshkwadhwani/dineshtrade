// Email notifications via Resend (https://resend.com).
//
// Unified dispatcher: sendEmail(type, data)
//   type='trade_executed'  data: TradeExecutedData
//   type='trade_failed'    data: TradeFailedData
//   type='eod_summary'     data: EODSummaryData
//   type='test'            data: undefined
//
// Required env:
//   RESEND_API_KEY=<Resend API key>
//   FROM_EMAIL=contact@dalgo.online
//   FROM_NAME=DAlgo Trade                   (optional, defaults to 'DineshTrade')
//   NOTIFY_TO=dinesh.k.wadhwani@gmail.com    (optional, defaults to FROM_EMAIL)
//
// All sends are best-effort: if Resend is not configured, calls return
// {ok:false, skipped:true} so callers can fire-and-forget without try/catch.

import { Resend } from 'resend'
import type { DailyReport } from './retrospective'

// Lazily constructed — Resend's constructor THROWS if no API key is
// available (`if (!this.key) throw new Error('Missing API key...')`), so
// this must not run eagerly at module load: lib/email.ts is imported from
// the entire order-placement pipeline (zerodha/route.ts, cronBuy.ts,
// cronEOD.ts, strategy1/2.ts, pivotal.ts), none of which should crash just
// because email isn't configured in a given environment.
let resendClient: Resend | null = null

function getResendClient(): Resend | null {
  if (resendClient) return resendClient
  if (!process.env.RESEND_API_KEY) return null
  resendClient = new Resend(process.env.RESEND_API_KEY)
  return resendClient
}

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.FROM_EMAIL)
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

// Phase 7, Task 7.10 — public /contact form submission.
export interface ContactFormData {
  name: string
  email: string
  message: string
}

// ──────── DISPATCH ────────
//
// Keeps returning Promise<EmailResult> — app/api/health/route.ts,
// app/api/email/test/route.ts, and lib/cronEOD.ts all read
// .ok/.error/.skipped/.messageId from it. Calls sendViaResend() directly
// (not deliver()) to get that real outcome — deliver() further down is
// intentionally void/error-swallowing and is used only by the Phase 3
// registration emails, which are genuinely fire-and-forget with no caller
// that needs a result back.

export function sendEmail(type: 'trade_executed', data: TradeExecutedData): Promise<EmailResult>
export function sendEmail(type: 'trade_failed',   data: TradeFailedData):   Promise<EmailResult>
export function sendEmail(type: 'eod_summary',    data: EODSummaryData):    Promise<EmailResult>
export function sendEmail(type: 'daily_report',   data: DailyReport):       Promise<EmailResult>
export function sendEmail(type: 'monthly_report', data: MonthlyReportData): Promise<EmailResult>
export function sendEmail(type: 'test',           data?: undefined):        Promise<EmailResult>
export function sendEmail(type: 'contact_form',   data: ContactFormData):    Promise<EmailResult>
export function sendEmail(type: string, data?: any): Promise<EmailResult> {
  const to = process.env.NOTIFY_TO || process.env.FROM_EMAIL || ''
  switch (type) {
    case 'trade_executed': return sendViaResend(to, executedSubject(data), executedBody(data))
    case 'trade_failed':   return sendViaResend(to, failedSubject(data),   failedBody(data))
    case 'eod_summary':    return sendViaResend(to, eodSubject(data),      eodBody(data))
    case 'daily_report':   return sendViaResend(to, dailyReportSubject(data), dailyReportText(data), dailyReportHTML(data))
    case 'monthly_report': return sendViaResend(to, monthlyReportSubject(data), monthlyReportText(data), monthlyReportHTML(data))
    case 'test':           return sendViaResend(to, '[DineshTrade] Resend test — wiring works', testBody())
    // Contact form's `to` is always the same NOTIFY_TO / FROM_EMAIL fallback
    // as every other admin-facing email above — spec §7.10 asks for
    // dinesh.k.wadhwani@gmail.com specifically, which is already what
    // NOTIFY_TO resolves to in every deployed environment.
    case 'contact_form':   return sendViaResend(to, contactFormSubject(data), contactFormBody(data))
    default: return Promise.resolve({ ok: false, error: `Unknown email type: ${type}` })
  }
}

// ──────── ERGONOMIC WRAPPERS ────────

export const sendTradeExecuted = (d: TradeExecutedData) => sendEmail('trade_executed', d)
export const sendTradeFailed   = (d: TradeFailedData)   => sendEmail('trade_failed', d)
export const sendEODSummary    = (d: EODSummaryData)    => sendEmail('eod_summary', d)
export const sendDailyReport   = (d: DailyReport)       => sendEmail('daily_report', d)
export const sendMonthlyReport = (d: MonthlyReportData) => sendEmail('monthly_report', d)
export const sendTestEmail     = ()                     => sendEmail('test')
export const sendContactForm   = (d: ContactFormData)   => sendEmail('contact_form', d)

// ──────── DELIVERY ────────

// The only place that actually calls the Resend API. Returns a real
// EmailResult (ok/error/messageId) — Resend's SDK does NOT throw for
// API-level failures (bad domain, invalid key, etc.), it returns them as
// `{ error }`, so that field must be checked explicitly rather than relying
// on try/catch alone to detect a failed send.
async function sendViaResend(to: string, subject: string, text: string, html?: string, cc?: string[]): Promise<EmailResult> {
  const resend = getResendClient()
  const fromEmail = process.env.FROM_EMAIL
  if (!resend || !fromEmail) {
    console.warn('[email] Resend not configured — skipping:', subject)
    console.warn('[email] ensure RESEND_API_KEY and FROM_EMAIL are set in the server environment')
    return { ok: false, skipped: true, error: 'Resend not configured' }
  }
  const from = `${process.env.FROM_NAME || 'DineshTrade'} <${fromEmail}>`
  try {
    const { data, error } = await resend.emails.send({ from, to, subject, text, ...(html ? { html } : {}), ...(cc && cc.length ? { cc } : {}) })
    if (error) {
      console.error('[email] send failed:', error.message)
      return { ok: false, error: error.message }
    }
    console.log('[email] sent:', subject, '→', data?.id)
    return { ok: true, messageId: data?.id }
  } catch (e) {
    const msg = String(e).slice(0, 300)
    console.error('[email] send failed:', msg)
    return { ok: false, error: msg }
  }
}

// Fire-and-forget sender for the Phase 3 registration/onboarding emails
// below — never throws, returns nothing, logs only. Internally still goes
// through sendViaResend() so the Resend call + config/error handling isn't
// duplicated (and so a Resend-side {error} response isn't silently missed).
async function deliver(to: string, subject: string, text: string): Promise<void> {
  const result = await sendViaResend(to, subject, text)
  if (!result.ok) {
    console.error('[email] send failed:', subject, result.error)
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
  if (d.side === 'BUY' && (d.target1 || d.target2)) {
    lines.push(divider('Targets'))
    if (d.target1) lines.push(row('T1 (+1.5%)', `${rupees(d.target1)}  → sell 50% on hit`))
    if (d.target2) lines.push(row('T2 (+2.0%)', `${rupees(d.target2)}  → sell remaining`))
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

// ──────── DAILY REPORT (HTML) ────────

function dailyReportSubject(d: DailyReport): string {
  const orders = d.activityToday.length
  const open = d.openPositions.length
  const pnl = d.totalPnl !== 0
    ? (d.totalPnl >= 0 ? `+₹${Math.round(d.totalPnl).toLocaleString('en-IN')}` : `-₹${Math.round(Math.abs(d.totalPnl)).toLocaleString('en-IN')}`)
    : null
  const parts = [`${orders} orders`, `${open} open`]
  if (pnl) parts.push(pnl)
  return `DineshTrade · ${d.displayDate.split(' (')[0]} · ${parts.join(' · ')}`
}

function dailyReportText(d: DailyReport): string {
  const lines: string[] = []
  lines.push(`DineshTrade — Daily Retrospective — ${d.displayDate}`)
  lines.push('')
  const buys = d.activityToday.filter(a => a.side === 'BUY').length
  const sells = d.activityToday.filter(a => a.side === 'SELL').length
  lines.push(`Orders today: ${d.activityToday.length} (${buys} BUY · ${sells} SELL) · Deployed ${rupees(d.capitalDeployedToday)}`)
  lines.push(`Open positions: ${d.openPositions.length} · Realized P&L (closed trades today): ${d.totalPnl !== 0 ? signedRupees(d.totalPnl) : '— (no exits)'}`)
  if (d.capitalStatus) {
    lines.push(`Capital: ${rupees(d.capitalStatus.available)} available · ${rupees(d.capitalStatus.deployedNow)} deployed (${d.capitalStatus.pctDeployed.toFixed(0)}% of cap) · ${rupees(d.capitalStatus.remainingDeployable)} headroom`)
  }
  if (d.activityToday.length > 0) {
    lines.push('')
    lines.push('Activity:')
    for (const a of d.activityToday) {
      lines.push(`  ${a.time}  ${a.side.padEnd(4)} ${a.symbol.padEnd(12)} × ${a.qty}  @ ₹${a.price.toFixed(2)}  [${a.tag || '—'}]`)
    }
  }
  if (d.openPositions.length > 0) {
    lines.push('')
    lines.push('Open positions:')
    for (const p of d.openPositions) {
      lines.push(`  ${p.symbol.padEnd(12)} × ${p.qty}  avg ₹${p.avgPrice.toFixed(2)}  LTP ₹${p.ltp.toFixed(2)}  ${signedRupees(p.pnl)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%)  [${p.strategySource.toUpperCase()}]${p.pyramidStatus ? ' ' + p.pyramidStatus : ''}${p.s2HandoffIn !== undefined ? ` · handoff in ${p.s2HandoffIn}d` : ''}`)
    }
  }
  if (d.strategyHealth.length > 0) {
    lines.push('')
    lines.push('Strategy health (30d):')
    for (const s of d.strategyHealth) {
      const last = s.daysSinceLastSignal === null ? 'never' : `${s.daysSinceLastSignal}d ago`
      lines.push(`  ${s.name.padEnd(20)} ${s.active ? 'ACTIVE' : 'inactive'}  scans:${s.scans30d}  signals:${s.signals30d}  execs:${s.executions30d}  last signal: ${last}${s.warning ? '  ⚠ ' + s.warning : ''}`)
    }
  }
  if (d.missedSignals.length > 0) {
    lines.push('')
    lines.push('Missed signals:')
    for (const m of d.missedSignals) {
      const when = m.count > 1 ? `${m.firstTime}–${m.lastTime} ×${m.count}` : m.firstTime
      lines.push(`  ${when.padEnd(16)} ${m.symbol.padEnd(10)} ${m.reasonSkipped} → ${m.outcome.toUpperCase().replace('_', ' ')}`)
    }
  }
  return lines.join('\n')
}

// Color palette — must match the in-app Obsidian Gold theme
const COL = {
  bg:      '#080604',
  card:    '#100e0a',
  border:  'rgba(201,168,76,0.15)',
  borderD: 'rgba(255,255,255,0.08)',
  textD:   'rgba(255,255,255,0.85)',
  textM:   'rgba(255,255,255,0.55)',
  textL:   'rgba(255,255,255,0.35)',
  gold:    '#c9a84c',
  goldL:   '#e8c97a',
  goldM:   'rgba(201,168,76,0.5)',
  green:   '#52b788',
  red:     '#e05a5e',
  blue:    '#60a5fa',
  amber:   '#f59e0b',
}

function verdictColor(v: string): string {
  if (v === 'correct_exit') return COL.green
  if (v === 'early_exit')   return COL.amber
  if (v === 'delivery')     return COL.blue
  return COL.textM
}
function verdictLabel(v: string): string {
  if (v === 'correct_exit') return 'CORRECT EXIT'
  if (v === 'early_exit')   return 'EARLY EXIT'
  if (v === 'delivery')     return 'DELIVERY'
  if (v === 'manual')       return 'MANUAL'
  return v.toUpperCase()
}

function statCard(label: string, value: string, color: string): string {
  return `<td width="25%" valign="top" style="padding:6px;">
    <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:rgba(201,168,76,0.04); border:1px solid ${COL.border}; border-radius:8px;">
      <tr><td>
        <div style="font-size:9px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">${label}</div>
        <div style="font-size:22px; font-weight:600; color:${color}; font-family:'JetBrains Mono',monospace; margin-top:6px;">${value}</div>
      </td></tr>
    </table>
  </td>`
}

function tradeCard(t: DailyReport['trades'][number]): string {
  const pnlColor = t.pnlRupees >= 0 ? COL.green : COL.red
  const vColor = verdictColor(t.verdict)
  const vLabel = verdictLabel(t.verdict)
  const leftOnTable = (t.finalLeftOnTable ?? t.leftOnTable) || 0
  const dayHigh = t.finalDayHigh ?? t.dayHighAfterEntry
  const heldMin = t.entryTime && t.exitTime
    ? Math.max(0, Math.round((new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 60000))
    : null
  return `
  <tr><td style="padding:8px 0;">
    <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:${COL.card}; border:1px solid ${COL.borderD}; border-radius:8px;">
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="top">
              <div style="font-size:16px; font-weight:700; color:${COL.textD}; font-family:'JetBrains Mono',monospace;">${t.symbol}</div>
              <div style="font-size:10px; color:${COL.textL}; margin-top:2px;">${t.account} · ${t.qty} sh · ${t.strategy}${heldMin !== null ? ' · ' + heldMin + ' min' : ''}</div>
            </td>
            <td valign="top" align="right">
              <span style="background:${vColor}22; color:${vColor}; border:1px solid ${vColor}66; padding:3px 8px; border-radius:4px; font-size:9px; font-weight:600; letter-spacing:0.15em; font-family:'JetBrains Mono',monospace;">${vLabel}</span>
            </td>
          </tr>
          <tr><td colspan="2" style="padding-top:12px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="50%" style="font-size:11px; color:${COL.textM}; font-family:'JetBrains Mono',monospace;">
                  Entry  <span style="color:${COL.textD};">₹${t.entryPrice.toFixed(2)}</span>
                </td>
                <td width="50%" style="font-size:11px; color:${COL.textM}; font-family:'JetBrains Mono',monospace;">
                  Exit   <span style="color:${COL.textD};">₹${t.exitPrice.toFixed(2)}</span>
                </td>
              </tr>
              <tr>
                <td style="font-size:11px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding-top:4px;">
                  P&L    <span style="color:${pnlColor}; font-weight:600;">${signedRupees(t.pnlRupees)} (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%)</span>
                </td>
                <td style="font-size:11px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding-top:4px;">
                  Day high  <span style="color:${COL.textD};">₹${dayHigh.toFixed(2)}</span>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="font-size:11px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding-top:4px;">
                  Left on table  <span style="color:${leftOnTable > 0 ? COL.amber : COL.textL};">${leftOnTable > 0 ? '₹' + leftOnTable.toFixed(2) : '—'}</span>
                </td>
              </tr>
              ${t.notes ? `<tr><td colspan="2" style="font-size:10px; color:${COL.textL}; padding-top:6px; font-style:italic;">${t.notes}</td></tr>` : ''}
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>`
}

function missedRow(m: DailyReport['missedSignals'][number]): string {
  const outColor = m.outcome === 'missed_opportunity' ? COL.amber : COL.green
  const outLabel = m.outcome === 'missed_opportunity' ? 'MISSED OPPORTUNITY' : m.outcome === 'good_miss' ? 'GOOD MISS' : 'UNKNOWN'
  const timeCell = m.count > 1
    ? `${m.firstTime}–${m.lastTime}<div style="font-size:9px; color:${COL.textL}; margin-top:2px;">×${m.count} times</div>`
    : m.firstTime
  return `<tr>
    <td style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:top;">${timeCell}</td>
    <td style="font-size:11px; color:${COL.textD}; font-family:'JetBrains Mono',monospace; font-weight:600; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:top;">${m.symbol}</td>
    <td style="font-size:10px; color:${COL.textM}; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:top;">${m.reasonSkipped}</td>
    <td align="right" style="padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:top;">
      <span style="background:${outColor}22; color:${outColor}; border:1px solid ${outColor}66; padding:2px 6px; border-radius:3px; font-size:8px; font-weight:600; letter-spacing:0.15em; font-family:'JetBrains Mono',monospace;">${outLabel}</span>
    </td>
  </tr>`
}

function dailyReportHTML(d: DailyReport): string {
  const totalPnlColor = d.totalPnl >= 0 ? COL.green : COL.red
  const buys = d.activityToday.filter(a => a.side === 'BUY').length
  const sells = d.activityToday.filter(a => a.side === 'SELL').length

  // ── HERO ── 4 cards: Orders Today · Open Positions · Capital Deployed · Realized P&L
  const heroStats = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        ${statCardSub('Orders Today', String(d.activityToday.length), `${buys} BUY · ${sells} SELL`, COL.gold)}
        ${statCardSub('Open Positions', String(d.openPositions.length), rupees(d.openPositionValue), COL.gold)}
        ${statCardSub('Deployed Today', rupees(d.capitalDeployedToday), 'BUY notional', COL.gold)}
        ${statCardSub('Realized P&L', d.totalPnl !== 0 ? signedRupees(d.totalPnl) : '—', d.totalPnl !== 0 ? `${d.wins}/${d.tradesCount} wins` : 'no exits today', totalPnlColor)}
      </tr>
    </table>`

  // ── ACTIVITY TODAY ── all today's orders
  const activitySection = d.activityToday.length === 0 ? '' : `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Activity today (${d.activityToday.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COL.card}; border:1px solid ${COL.borderD}; border-radius:8px;">
        <tr>
          ${tableHeader('Time')}${tableHeader('Symbol')}${tableHeader('Side')}${tableHeader('Qty', 'right')}${tableHeader('Price', 'right')}${tableHeader('Tag', 'right')}
        </tr>
        ${d.activityToday.map(activityRowHTML).join('')}
      </table>
    </td></tr>`

  // ── OPEN POSITIONS ── carry-forward + today's holdings
  const openSection = d.openPositions.length === 0 ? '' : `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Open positions (${d.openPositions.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COL.card}; border:1px solid ${COL.borderD}; border-radius:8px;">
        <tr>
          ${tableHeader('Symbol')}${tableHeader('Source')}${tableHeader('Qty', 'right')}${tableHeader('Avg', 'right')}${tableHeader('LTP', 'right')}${tableHeader('P&L', 'right')}${tableHeader('Note', 'right')}
        </tr>
        ${d.openPositions.map(openPosRowHTML).join('')}
      </table>
    </td></tr>`

  // ── CAPITAL STATUS ──
  const capSection = !d.capitalStatus ? '' : (() => {
    const c = d.capitalStatus
    const depColor = c.pctDeployed > 90 ? COL.red : c.pctDeployed > 75 ? COL.amber : COL.green
    return `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Capital status</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCardSub('Available', rupees(c.available), 'from Kite', COL.gold)}
          ${statCardSub('Deployed', rupees(c.deployedNow), `${c.pctDeployed.toFixed(0)}% of cap`, depColor)}
          ${statCardSub('Reserve', rupees(c.available - c.maxDeployable), 'buffer', COL.textM)}
          ${statCardSub('Headroom', rupees(c.remainingDeployable), 'for new entries', c.remainingDeployable > 0 ? COL.green : COL.textM)}
        </tr>
      </table>
    </td></tr>`
  })()

  // ── PER-STRATEGY HEALTH ── replaces the old aggregate 30d block
  const strategySection = d.strategyHealth.length === 0 ? '' : `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Strategy health (30 days)</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${d.strategyHealth.map(strategyHealthCard).join('')}</table>
    </td></tr>`

  // ── TRADE-BY-TRADE (existing) ──
  const tradesSection = d.trades.length === 0 ? '' : `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Completed trades today (${d.trades.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${d.trades.map(tradeCard).join('')}</table>
    </td></tr>`

  // ── MISSED SIGNALS (existing) ──
  const missedSection = d.missedSignals.length === 0 ? '' : `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Missed signals (${d.missedSignals.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COL.card}; border:1px solid ${COL.borderD}; border-radius:8px;">
        <tr>
          ${tableHeader('Time')}${tableHeader('Symbol')}${tableHeader('Reason')}${tableHeader('Outcome', 'right')}
        </tr>
        ${d.missedSignals.map(missedRow).join('')}
      </table>
    </td></tr>`

  // ── FINE-TUNING (existing) ──
  const tuningSection = d.fineTuning.length === 0 ? '' : `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Fine-tuning signals</div>
      <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:${COL.card}; border:1px solid ${COL.borderD}; border-radius:8px;">
        <tr><td>
          <ul style="margin:0; padding-left:20px; color:${COL.textD};">
            ${d.fineTuning.map(b => `<li style="margin-bottom:8px; font-size:12px; line-height:1.5;">${b}</li>`).join('')}
          </ul>
        </td></tr>
      </table>
    </td></tr>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${dailyReportSubject(d)}</title></head>
<body style="margin:0; padding:0; background:${COL.bg}; color:${COL.textD}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COL.bg};">
<tr><td align="center" style="padding:32px 16px;">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px; width:100%;">
  <tr><td>
    <div style="color:${COL.gold}; font-size:32px; font-family:'Cormorant Garamond',Georgia,serif; font-weight:300; letter-spacing:0.02em; line-height:1;">DW</div>
    <div style="color:${COL.goldM}; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-top:4px;">DineshTrade · Daily Retrospective</div>
    <div style="color:${COL.textM}; font-size:14px; margin-top:10px;">${d.displayDate}</div>
  </td></tr>
  <tr><td style="padding-top:24px;">${heroStats}</td></tr>
  ${activitySection}
  ${openSection}
  ${capSection}
  ${strategySection}
  ${tradesSection}
  ${missedSection}
  ${tuningSection}
  <tr><td style="padding-top:32px; padding-bottom:8px;">
    <div style="border-top:1px solid ${COL.borderD}; padding-top:16px; font-size:10px; color:${COL.textL}; letter-spacing:0.1em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; text-align:center;">
      Sent ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · DineshTrade
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

// ──── helper renderers for the new sections ────

function statCardSub(label: string, value: string, sub: string, color: string): string {
  return `<td width="25%" valign="top" style="padding:6px;">
    <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:rgba(201,168,76,0.04); border:1px solid ${COL.border}; border-radius:8px;">
      <tr><td>
        <div style="font-size:9px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">${label}</div>
        <div style="font-size:20px; font-weight:600; color:${color}; font-family:'JetBrains Mono',monospace; margin-top:6px;">${value}</div>
        <div style="font-size:9px; color:${COL.textL}; margin-top:4px; font-family:'JetBrains Mono',monospace;">${sub}</div>
      </td></tr>
    </table>
  </td>`
}

function tableHeader(label: string, align: 'left' | 'right' = 'left'): string {
  return `<th align="${align}" style="font-size:9px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; padding:10px 6px; border-bottom:1px solid ${COL.borderD};">${label}</th>`
}

function activityRowHTML(a: DailyReport['activityToday'][number]): string {
  const sideColor = a.side === 'BUY' ? COL.green : COL.red
  return `<tr>
    <td style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${a.time}</td>
    <td style="font-size:11px; color:${COL.textD}; font-family:'JetBrains Mono',monospace; font-weight:600; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${a.symbol}</td>
    <td style="font-size:10px; color:${sideColor}; font-family:'JetBrains Mono',monospace; font-weight:600; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${a.side === 'BUY' ? '▲ BUY' : '▼ SELL'}</td>
    <td align="right" style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">× ${a.qty}</td>
    <td align="right" style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">₹${a.price.toFixed(2)}</td>
    <td align="right" style="font-size:9px; color:rgba(96,165,250,0.7); font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${a.tag || '—'}</td>
  </tr>`
}

function openPosRowHTML(p: DailyReport['openPositions'][number]): string {
  const pnlColor = p.pnl >= 0 ? COL.green : COL.red
  const srcColor = p.strategySource === 's1' ? COL.gold : p.strategySource === 's2' ? '#60a5fa' : p.strategySource === 'mixed' ? COL.amber : COL.textM
  const note = [p.pyramidStatus, p.s2HandoffIn !== undefined ? `handoff in ${p.s2HandoffIn}d` : null].filter(Boolean).join(' · ')
  return `<tr>
    <td style="font-size:11px; color:${COL.textD}; font-family:'JetBrains Mono',monospace; font-weight:600; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${p.symbol}</td>
    <td style="padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="background:${srcColor}22; color:${srcColor}; border:1px solid ${srcColor}55; padding:2px 6px; border-radius:3px; font-size:8px; font-weight:600; letter-spacing:0.15em; font-family:'JetBrains Mono',monospace;">${p.strategySource.toUpperCase()}</span>
    </td>
    <td align="right" style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${p.qty}</td>
    <td align="right" style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">₹${p.avgPrice.toFixed(2)}</td>
    <td align="right" style="font-size:10px; color:${COL.textD}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">₹${p.ltp.toFixed(2)}</td>
    <td align="right" style="font-size:10px; color:${pnlColor}; font-family:'JetBrains Mono',monospace; font-weight:600; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${signedRupees(p.pnl)}<br><span style="font-size:9px; opacity:0.7;">${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%</span></td>
    <td align="right" style="font-size:9px; color:${COL.textL}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${note || '—'}</td>
  </tr>`
}

function strategyHealthCard(s: DailyReport['strategyHealth'][number]): string {
  const statusColor = !s.active ? COL.textL : s.warning ? COL.amber : COL.green
  const lastSignal = s.daysSinceLastSignal === null ? 'never' : s.daysSinceLastSignal === 0 ? 'today' : `${s.daysSinceLastSignal}d ago`
  return `<tr><td style="padding:8px 0;">
    <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:${COL.card}; border:1px solid ${s.warning ? 'rgba(245,158,11,0.3)' : COL.borderD}; border-radius:8px;">
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td><span style="font-size:14px; font-weight:600; color:${COL.textD};">${s.name}</span></td>
            <td align="right">
              <span style="background:${statusColor}22; color:${statusColor}; border:1px solid ${statusColor}55; padding:3px 8px; border-radius:4px; font-size:9px; font-weight:600; letter-spacing:0.15em; font-family:'JetBrains Mono',monospace;">${s.active ? 'ACTIVE' : 'INACTIVE'}</span>
            </td>
          </tr>
          <tr><td colspan="2" style="padding-top:10px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace;">Scans (30d) <span style="color:${COL.textD};">${s.scans30d}</span></td>
                <td style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace;">Signals <span style="color:${COL.textD};">${s.signals30d}</span></td>
                <td style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace;">Executions <span style="color:${COL.textD};">${s.executions30d}</span></td>
                <td style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace;">Last signal <span style="color:${COL.textD};">${lastSignal}</span></td>
              </tr>
            </table>
          </td></tr>
          ${s.warning ? `<tr><td colspan="2" style="padding-top:10px;"><div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.3); border-radius:6px; padding:8px 10px; font-size:11px; color:${COL.amber};">⚠ ${s.warning}</div></td></tr>` : ''}
        </table>
      </td></tr>
    </table>
  </td></tr>`
}

// ──────── MONTHLY ROLLUP ────────

export interface MonthlyReportData {
  monthLabel: string           // "May 2026"
  totalTrades: number
  wins: number
  totalPnl: number
  best?: { symbol: string; pnl: number; pct: number; date: string }
  worst?: { symbol: string; pnl: number; pct: number; date: string }
  avgDailyReturn: number       // percent
  signalsMissed: number
  recommendation?: string
}

function monthlyReportSubject(m: MonthlyReportData): string {
  const pnl = m.totalPnl >= 0 ? `+₹${Math.round(m.totalPnl).toLocaleString('en-IN')}` : `-₹${Math.round(Math.abs(m.totalPnl)).toLocaleString('en-IN')}`
  return `DineshTrade · Monthly Report · ${m.monthLabel} · ${pnl} · ${m.wins}/${m.totalTrades} wins`
}

function monthlyReportText(m: MonthlyReportData): string {
  const lines = [
    `DineshTrade — Monthly Rollup — ${m.monthLabel}`,
    '',
    `Total trades: ${m.totalTrades}    Wins: ${m.wins} (${m.totalTrades > 0 ? Math.round(100 * m.wins / m.totalTrades) : 0}%)`,
    `Total P&L:    ${signedRupees(m.totalPnl)}`,
    `Avg daily:    ${m.avgDailyReturn >= 0 ? '+' : ''}${m.avgDailyReturn.toFixed(2)}%`,
    `Best:         ${m.best ? `${m.best.symbol} ${signedRupees(m.best.pnl)} (${m.best.pct >= 0 ? '+' : ''}${m.best.pct.toFixed(2)}%) on ${m.best.date}` : '—'}`,
    `Worst:        ${m.worst ? `${m.worst.symbol} ${signedRupees(m.worst.pnl)} (${m.worst.pct >= 0 ? '+' : ''}${m.worst.pct.toFixed(2)}%) on ${m.worst.date}` : '—'}`,
    `Signals missed: ${m.signalsMissed}`,
    ...(m.recommendation ? ['', 'Recommendation: ' + m.recommendation] : []),
  ]
  return lines.join('\n')
}

function monthlyReportHTML(m: MonthlyReportData): string {
  const totalPnlColor = m.totalPnl >= 0 ? COL.green : COL.red
  const winRate = m.totalTrades > 0 ? `${Math.round(100 * m.wins / m.totalTrades)}%` : '—'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0; padding:0; background:${COL.bg}; color:${COL.textD}; font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COL.bg};">
<tr><td align="center" style="padding:32px 16px;">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px; width:100%;">

  <tr><td>
    <div style="color:${COL.gold}; font-size:32px; font-family:'Cormorant Garamond',Georgia,serif; font-weight:300; line-height:1;">DW</div>
    <div style="color:${COL.goldM}; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-top:4px;">DineshTrade · Monthly Rollup</div>
    <div style="color:${COL.textM}; font-size:14px; margin-top:10px;">${m.monthLabel}</div>
  </td></tr>

  <tr><td style="padding-top:24px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${statCard('Trades', String(m.totalTrades), COL.gold)}
      ${statCard('Win Rate', winRate, COL.gold)}
      ${statCard('Total P&L', signedRupees(m.totalPnl), totalPnlColor)}
      ${statCard('Avg Daily', `${m.avgDailyReturn >= 0 ? '+' : ''}${m.avgDailyReturn.toFixed(2)}%`, m.avgDailyReturn >= 0 ? COL.green : COL.red)}
    </tr></table>
  </td></tr>

  <tr><td style="padding-top:24px;">
    <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:${COL.card}; border:1px solid ${COL.borderD}; border-radius:8px;">
      <tr><td style="font-size:12px; color:${COL.textM}; padding:8px 0;">
        <div style="font-size:10px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:6px;">Best trade</div>
        ${m.best ? `<span style="color:${COL.textD}; font-family:'JetBrains Mono',monospace;">${m.best.symbol}</span> &nbsp;<span style="color:${COL.green}; font-family:'JetBrains Mono',monospace;">${signedRupees(m.best.pnl)} (${m.best.pct >= 0 ? '+' : ''}${m.best.pct.toFixed(2)}%)</span> &nbsp;<span style="color:${COL.textL};">on ${m.best.date}</span>` : '<span style="color:'+COL.textL+';">—</span>'}
      </td></tr>
      <tr><td style="font-size:12px; color:${COL.textM}; padding:8px 0; border-top:1px solid ${COL.borderD};">
        <div style="font-size:10px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:6px;">Worst trade</div>
        ${m.worst ? `<span style="color:${COL.textD}; font-family:'JetBrains Mono',monospace;">${m.worst.symbol}</span> &nbsp;<span style="color:${COL.red}; font-family:'JetBrains Mono',monospace;">${signedRupees(m.worst.pnl)} (${m.worst.pct >= 0 ? '+' : ''}${m.worst.pct.toFixed(2)}%)</span> &nbsp;<span style="color:${COL.textL};">on ${m.worst.date}</span>` : '<span style="color:'+COL.textL+';">—</span>'}
      </td></tr>
      <tr><td style="font-size:12px; color:${COL.textM}; padding:8px 0; border-top:1px solid ${COL.borderD};">
        <div style="font-size:10px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:6px;">Signals missed</div>
        <span style="color:${COL.textD}; font-family:'JetBrains Mono',monospace;">${m.signalsMissed}</span>
      </td></tr>
    </table>
  </td></tr>

  ${m.recommendation ? `
  <tr><td style="padding-top:24px;">
    <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:rgba(201,168,76,0.06); border:1px solid ${COL.border}; border-radius:8px;">
      <tr><td>
        <div style="font-size:10px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:8px;">Recommendation</div>
        <div style="font-size:13px; color:${COL.textD}; line-height:1.5;">${m.recommendation}</div>
      </td></tr>
    </table>
  </td></tr>` : ''}

</table>
</td></tr>
</table>
</body></html>`
}

// ── Test ──

function testBody(): string {
  return [
    'Resend wiring works.',
    '',
    row('From',      process.env.FROM_EMAIL || '(unset)'),
    row('From name', process.env.FROM_NAME || 'DineshTrade (default)'),
    row('To',        process.env.NOTIFY_TO || process.env.FROM_EMAIL || '(unset)'),
    row('Time',      nowIST()),
    '',
    'You can safely ignore this email. It confirms that DineshTrade can send mail',
    'on your behalf using the Resend API key in .env.local.',
  ].join('\n')
}

// ── Contact form (Phase 7, Task 7.10) ──

function contactFormSubject(d: ContactFormData): string {
  return `DAlgo Contact Form: ${d.name}`
}

function contactFormBody(d: ContactFormData): string {
  return [
    row('Name',  d.name),
    row('Email', d.email),
    divider('Message'),
    d.message,
  ].join('\n')
}

// ──────── DALGO REGISTRATION/ONBOARDING EMAILS (Phase 3) ────────
//
// Fire-and-forget via deliver() — recipients here are individual
// customers/Account Managers (explicit `to`), not the fixed NOTIFY_TO
// address the V1 functions above use.

export async function sendRegistrationConfirmation(to: string, name: string): Promise<void> {
  const subject = 'Your DAlgo application has been submitted'
  const text =
    `Thank you ${name}. Your application is under review. ` +
    `We will notify you within 1–2 business days. ` +
    `Contact support@dalgo.online with questions.`
  await deliver(to, subject, text)
}

export async function sendRegistrationAssigned(to: string, customerName: string, customerEmail: string): Promise<void> {
  const subject = `New registration assigned to you: ${customerName}`
  const text =
    `A new registration has been assigned to you for review.\n` +
    `Customer: ${customerName} (${customerEmail})\n` +
    `Log in to review at www.dalgo.online/manager/registrations`
  await deliver(to, subject, text)
}

export async function sendIdentityApproved(to: string, name: string): Promise<void> {
  const subject = 'Identity verified — complete your DAlgo setup'
  const text =
    `Hi ${name}, your identity has been verified. ` +
    `Please log in to complete your broker setup.`
  await deliver(to, subject, text)
}

export async function sendIdentityRejected(to: string, name: string, reason: string): Promise<void> {
  const subject = 'Action required: Your DAlgo application needs attention'
  const text =
    `Hi ${name}, your application could not be approved.\n` +
    `Reason: ${reason}\n` +
    `Please contact support@dalgo.online for assistance.`
  await deliver(to, subject, text)
}

export async function sendAccountActivated(to: string, name: string, instanceUrl: string): Promise<void> {
  const subject = 'Your DAlgo trading account is now active!'
  const text =
    `Hi ${name}, your account is active. ` +
    `Log in at www.dalgo.online — we will redirect you to your trading dashboard at ${instanceUrl}.`
  await deliver(to, subject, text)
}

// ── Token missing alert (Phase 5, spec §5.9 / §12) ──
// Sent at 9:00 AM IST on weekdays when this customer's Kite token is missing
// or expired — CC'd to the assigned Account Manager when one exists. Uses
// sendViaResend() directly (not deliver()) so the caller (lib/tokenAlert.ts)
// can log the real send outcome.
export async function sendTokenMissingAlert(to: string, customerName: string, amEmail?: string): Promise<EmailResult> {
  const firstName = customerName.split(' ')[0]
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dalgo.online'
  const logoUrl = `${appUrl}/logolight.png`
  const subject = 'Action Required: Reconnect Your Zerodha Account to Resume Trading'

  const text =
    `Dear ${customerName},\n\n` +
    `We noticed that your Zerodha broker connection has not been verified today. ` +
    `As a result, your automated trading strategies are currently paused and no orders will be placed on your behalf until your session is reconnected.\n\n` +
    `What you need to do:\n` +
    `1. Log in to your DAlgo dashboard at ${appUrl}\n` +
    `2. Go to Settings → Broker Connection\n` +
    `3. Click "Login with Kite" to authorise today's session\n\n` +
    `Once reconnected, your strategies will resume automatically.\n\n` +
    `NSE trading hours are 9:15 AM – 3:30 PM IST. Please reconnect before the market opens to avoid missing any opportunities.\n\n` +
    `If you need any assistance, please write to us at support@dalgo.online and we will be happy to help.\n\n` +
    `Warm regards,\nTeam DAlgo\n${appUrl}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#F8FAFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFF;">
<tr><td align="center" style="padding:40px 16px 32px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;border:1px solid #BFDBFE;box-shadow:0 4px 24px rgba(30,58,138,0.06);">

  <!-- Header / Logo -->
  <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #EFF6FF;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td>
        <img src="${logoUrl}" alt="DAlgo" width="100" height="auto" style="display:block;border:0;" />
      </td>
      <td align="right" style="vertical-align:middle;">
        <span style="font-size:11px;color:#94A3B8;letter-spacing:0.06em;text-transform:uppercase;font-family:monospace;">Automated Trading Platform</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- Alert banner -->
  <tr><td style="padding:0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0;font-size:13px;font-weight:700;color:#92400E;">⚠&nbsp; Action Required — Broker Session Expired</p>
        <p style="margin:6px 0 0;font-size:12px;color:#B45309;line-height:1.5;">Your Zerodha connection has not been verified today. Trading is currently paused.</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 40px 0;">
    <p style="margin:0 0 16px;font-size:16px;color:#1E3A8A;font-weight:600;">Dear ${firstName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.7;">
      We noticed that your Zerodha broker connection has not been verified for today's trading session.
      As a result, <strong style="color:#1E3A8A;">your automated strategies are currently paused</strong> and no orders
      will be placed on your behalf until you reconnect.
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7;">
      NSE trading hours are <strong style="color:#1E3A8A;">9:15 AM – 3:30 PM IST</strong>. Please reconnect before the market opens to ensure your strategies run without interruption.
    </p>
  </td></tr>

  <!-- Steps -->
  <tr><td style="padding:0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EFF6FF;border-radius:10px;border:1px solid #BFDBFE;">
      <tr><td style="padding:20px 24px;">
        <p style="margin:0 0 14px;font-size:12px;font-weight:700;color:#1E3A8A;letter-spacing:0.06em;text-transform:uppercase;">How to reconnect</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:6px 0;">
            <table cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="width:28px;height:28px;background:#3B82F6;border-radius:50%;text-align:center;vertical-align:middle;">
                <span style="font-size:12px;font-weight:700;color:#fff;">1</span>
              </td>
              <td style="padding-left:12px;font-size:13px;color:#475569;">Log in to your DAlgo dashboard</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:6px 0;">
            <table cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="width:28px;height:28px;background:#3B82F6;border-radius:50%;text-align:center;vertical-align:middle;">
                <span style="font-size:12px;font-weight:700;color:#fff;">2</span>
              </td>
              <td style="padding-left:12px;font-size:13px;color:#475569;">Navigate to <strong style="color:#1E3A8A;">Settings → Broker Connection</strong></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:6px 0;">
            <table cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="width:28px;height:28px;background:#3B82F6;border-radius:50%;text-align:center;vertical-align:middle;">
                <span style="font-size:12px;font-weight:700;color:#fff;">3</span>
              </td>
              <td style="padding-left:12px;font-size:13px;color:#475569;">Click <strong style="color:#1E3A8A;">Login with Kite</strong> to authorise today's session</td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- CTA button -->
  <tr><td style="padding:28px 40px 0;text-align:center;">
    <a href="${appUrl}/settings" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#3B82F6,#1D4ED8);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.02em;">
      Reconnect My Broker →
    </a>
  </td></tr>

  <!-- Support -->
  <tr><td style="padding:28px 40px 0;">
    <p style="margin:0;font-size:13px;color:#475569;line-height:1.7;">
      If you need any assistance, our team is here to help. Write to us at
      <a href="mailto:support@dalgo.online" style="color:#3B82F6;text-decoration:none;font-weight:600;">support@dalgo.online</a>
      and we will respond promptly.
    </p>
  </td></tr>

  <!-- Signature -->
  <tr><td style="padding:28px 40px 0;">
    <p style="margin:0;font-size:14px;color:#1E3A8A;font-weight:600;">Warm regards,</p>
    <p style="margin:4px 0 0;font-size:14px;color:#1E3A8A;font-weight:700;">Team DAlgo</p>
    <a href="${appUrl}" style="font-size:12px;color:#3B82F6;text-decoration:none;">${appUrl}</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 40px 32px;margin-top:24px;border-top:1px solid #EFF6FF;margin:24px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #EFF6FF;padding-top:20px;">
      <tr><td>
        <p style="margin:0;font-size:11px;color:#94A3B8;line-height:1.6;">
          This is an automated notification from DAlgo. You are receiving this because your account is set up for automated trading.
          If you believe this is an error, please contact us at
          <a href="mailto:support@dalgo.online" style="color:#94A3B8;">support@dalgo.online</a>.
        </p>
        <p style="margin:8px 0 0;font-size:11px;color:#CBD5E1;">© ${new Date().getFullYear()} DAlgo. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`

  return sendViaResend(to, subject, text, html, amEmail ? [amEmail] : undefined)
}

// ── Phase 6 — Admin/Account Manager dashboard emails ──
// Same fire-and-forget deliver() pattern as the Phase 3 emails above, except
// sendCustomerReassigned() which needs a CC recipient (the old AM) and so
// goes through sendViaResend() directly, same as sendTokenMissingAlert().

export async function sendAccountManagerWelcome(
  to: string,
  name: string,
  tempPassword: string
): Promise<void> {
  const subject = 'Welcome to DAlgo — set your password'
  const text =
    `You have been added as an Account Manager on DAlgo.\n` +
    `Log in at www.dalgo.online with your email and temporary password: ${tempPassword} ` +
    `— please change this immediately.`
  await deliver(to, subject, text)
}

export async function sendStrategyUpdated(to: string, strategyName: string): Promise<void> {
  const subject = `Your ${strategyName} strategy has been updated by DAlgo`
  const text =
    `Your ${strategyName} strategy parameters have been updated by the DAlgo platform team. ` +
    `Please review in your Strategies page within 48 hours.`
  await deliver(to, subject, text)
}

export async function sendCustomerReassigned(
  newAmEmail: string,
  customerName: string,
  oldAmEmail?: string
): Promise<EmailResult> {
  const subject = `Customer ${customerName} has been assigned to you`
  const text =
    `Customer ${customerName} has been reassigned to you as their Account Manager.\n` +
    `Log in at www.dalgo.online/manager/customers to view their details.`
  return sendViaResend(newAmEmail, subject, text, undefined, oldAmEmail ? [oldAmEmail] : undefined)
}
