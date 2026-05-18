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
import type { DailyReport } from './retrospective'

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
export function sendEmail(type: 'daily_report',   data: DailyReport):       Promise<EmailResult>
export function sendEmail(type: 'monthly_report', data: MonthlyReportData): Promise<EmailResult>
export function sendEmail(type: 'test',           data?: undefined):        Promise<EmailResult>
export function sendEmail(type: string, data?: any): Promise<EmailResult> {
  switch (type) {
    case 'trade_executed': return deliver(executedSubject(data), executedBody(data))
    case 'trade_failed':   return deliver(failedSubject(data),   failedBody(data))
    case 'eod_summary':    return deliver(eodSubject(data),      eodBody(data))
    case 'daily_report':   return deliver(dailyReportSubject(data), dailyReportText(data), dailyReportHTML(data))
    case 'monthly_report': return deliver(monthlyReportSubject(data), monthlyReportText(data), monthlyReportHTML(data))
    case 'test':           return deliver('[DineshTrade] SMTP test — wiring works', testBody())
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

// ──────── DELIVERY ────────

async function deliver(subject: string, text: string, html?: string): Promise<EmailResult> {
  const tx = getTransport()
  if (!tx) {
    console.warn('[email] SMTP not configured — skipping:', subject)
    return { ok: false, skipped: true, error: 'SMTP not configured' }
  }
  const from = process.env.SMTP_USER!
  const to = process.env.NOTIFY_TO || from
  try {
    const info = await tx.sendMail({ from: `DineshTrade <${from}>`, to, subject, text, ...(html ? { html } : {}) })
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

// ──────── DAILY REPORT (HTML) ────────

function dailyReportSubject(d: DailyReport): string {
  const pnl = d.totalPnl >= 0 ? `+₹${Math.round(d.totalPnl).toLocaleString('en-IN')}` : `-₹${Math.round(Math.abs(d.totalPnl)).toLocaleString('en-IN')}`
  const wr = `${d.wins}/${d.tradesCount} wins`
  return `DineshTrade · Daily Report · ${d.displayDate.split(' (')[0]} · ${pnl} · ${wr}`
}

function dailyReportText(d: DailyReport): string {
  // Plain-text fallback for clients that don't render HTML
  const lines: string[] = []
  lines.push(`DineshTrade — Daily Retrospective — ${d.displayDate}`)
  lines.push('')
  lines.push(`Trades: ${d.tradesCount}   Wins: ${d.wins}   P&L: ${signedRupees(d.totalPnl)}   Capital: ${rupees(d.capitalDeployed)}`)
  lines.push('')
  for (const t of d.trades) {
    lines.push(`  ${t.symbol.padEnd(10)} ${t.qty}sh   ₹${t.entryPrice.toFixed(2)} → ₹${t.exitPrice.toFixed(2)}   ${signedRupees(t.pnlRupees)} (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%)   [${t.verdict.toUpperCase()}]`)
  }
  if (d.missedSignals.length > 0) {
    lines.push('')
    lines.push('Missed signals:')
    for (const m of d.missedSignals) {
      lines.push(`  ${m.time} ${m.symbol.padEnd(10)} ${m.reasonSkipped} → ${m.outcome.toUpperCase().replace('_', ' ')}`)
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
  return `<tr>
    <td style="font-size:10px; color:${COL.textM}; font-family:'JetBrains Mono',monospace; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${m.time}</td>
    <td style="font-size:11px; color:${COL.textD}; font-family:'JetBrains Mono',monospace; font-weight:600; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${m.symbol}</td>
    <td style="font-size:10px; color:${COL.textM}; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">${m.reasonSkipped}</td>
    <td align="right" style="padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="background:${outColor}22; color:${outColor}; border:1px solid ${outColor}66; padding:2px 6px; border-radius:3px; font-size:8px; font-weight:600; letter-spacing:0.15em; font-family:'JetBrains Mono',monospace;">${outLabel}</span>
    </td>
  </tr>`
}

function dailyReportHTML(d: DailyReport): string {
  const totalPnlColor = d.totalPnl >= 0 ? COL.green : COL.red
  const winRate = d.tradesCount > 0 ? `${Math.round(100 * d.wins / d.tradesCount)}%` : '—'

  const heroStats = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        ${statCard('Trades', String(d.tradesCount), COL.gold)}
        ${statCard('Win Rate', winRate, COL.gold)}
        ${statCard('Total P&L', signedRupees(d.totalPnl), totalPnlColor)}
        ${statCard('Capital', rupees(d.capitalDeployed), COL.gold)}
      </tr>
    </table>`

  const tradesSection = d.trades.length === 0 ? '' : `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Trade-by-trade</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${d.trades.map(tradeCard).join('')}</table>
    </td></tr>`

  const missedSection = d.missedSignals.length === 0 ? '' : `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Missed signals (${d.missedSignals.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COL.card}; border:1px solid ${COL.borderD}; border-radius:8px;">
        <tr>
          <th align="left" style="font-size:9px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; padding:10px 6px; border-bottom:1px solid ${COL.borderD};">Time</th>
          <th align="left" style="font-size:9px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; padding:10px 6px; border-bottom:1px solid ${COL.borderD};">Symbol</th>
          <th align="left" style="font-size:9px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; padding:10px 6px; border-bottom:1px solid ${COL.borderD};">Reason</th>
          <th align="right" style="font-size:9px; color:${COL.textL}; letter-spacing:0.2em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; padding:10px 6px; border-bottom:1px solid ${COL.borderD};">Outcome</th>
        </tr>
        ${d.missedSignals.map(missedRow).join('')}
      </table>
    </td></tr>`

  const r = d.rolling30
  const wrColor = r.winRate === null ? COL.textM : (r.winRate >= 70 ? COL.green : r.winRate >= 50 ? COL.amber : COL.red)
  const agColor = r.avgGainPct === null ? COL.textM : (r.avgGainPct >= 1.5 ? COL.green : r.avgGainPct >= 0.5 ? COL.amber : COL.red)
  const healthSection = `
    <tr><td style="padding-top:28px;">
      <div style="font-size:11px; color:${COL.goldM}; letter-spacing:0.25em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-bottom:12px;">Strategy health (30-day rolling${r.sampleSize > 0 ? `, n=${r.sampleSize}` : ''})</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCard('Win Rate (target 70%)', r.winRate === null ? '—' : `${r.winRate.toFixed(0)}%`, wrColor)}
          ${statCard('Avg Gain/Trade', r.avgGainPct === null ? '—' : `${r.avgGainPct >= 0 ? '+' : ''}${r.avgGainPct.toFixed(2)}%`, agColor)}
          ${statCard('Delivery Open', String(r.deliveryOpen), r.deliveryOpen > 5 ? COL.amber : COL.gold)}
          ${statCard('Capital Eff.', r.capitalEfficiency === null ? '—' : `${r.capitalEfficiency >= 0 ? '+' : ''}${r.capitalEfficiency.toFixed(2)}%`, r.capitalEfficiency === null ? COL.textM : (r.capitalEfficiency >= 0 ? COL.green : COL.red))}
        </tr>
      </table>
    </td></tr>`

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

  <!-- Header -->
  <tr><td>
    <div style="color:${COL.gold}; font-size:32px; font-family:'Cormorant Garamond',Georgia,serif; font-weight:300; letter-spacing:0.02em; line-height:1;">DW</div>
    <div style="color:${COL.goldM}; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; font-family:'JetBrains Mono',monospace; margin-top:4px;">DineshTrade · Daily Retrospective</div>
    <div style="color:${COL.textM}; font-size:14px; margin-top:10px;">${d.displayDate}</div>
  </td></tr>

  <!-- Hero -->
  <tr><td style="padding-top:24px;">${heroStats}</td></tr>

  ${tradesSection}
  ${missedSection}
  ${healthSection}
  ${tuningSection}

  <!-- Footer -->
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
