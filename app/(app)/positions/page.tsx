// Open Positions: today's Kite day positions when connected, tracked customer_positions when offline.
export const dynamic = 'force-dynamic'

import RefreshBar from '@/components/ui/RefreshBar'

import { getProfile } from '@/lib/dalgoAuth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { loadBrokerAccountCreds, getPositions, getQuotes } from '@/lib/kite'
import StrategyTagButton from '@/components/app/StrategyTagButton'
import OrderButton from '@/components/app/OrderButton'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

function isTokenValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt) > new Date()
}

export default async function PositionsPage() {
  const profile = await getProfile()
  if (!profile) return null
  const customerId = profile.id
  const admin = getSupabaseAdmin()
  const primaryCustomerId = (process.env.CUSTOMER_IDS || '').split(',')[0]?.trim() || customerId

  const [brokerRes, strategyRes] = await Promise.all([
    admin.from('broker_accounts')
      .select('access_token_enc, api_key_enc, token_expires_at')
      .eq('customer_id', customerId).eq('broker_name', 'zerodha').eq('active', true)
      .maybeSingle(),
    admin.from('customer_strategies')
      .select('strategy_key, name, color, active').eq('customer_id', customerId),
  ])

  const activeStrategies = ((strategyRes.data ?? []) as any[])
    .filter(s => s.active)
    .map(s => ({ id: s.strategy_key as string, label: s.name as string, color: (s.color as string) || '#6B7280' }))

  const broker = brokerRes.data
  const tokenValid = broker?.access_token_enc && isTokenValid(broker.token_expires_at)

  // ── Mode 1: Kite live day positions ─────────────────────────────────────
  if (tokenValid && broker) {
    try {
      const envKey = process.env[`${process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'}_ZERODHA_API_KEY_${process.env.ZERODHA_ENVIRONMENT === 'PROD' ? process.env['PROD_ZERODHA_ACCOUNT1'] : process.env['TEST_ZERODHA_ACCOUNT1']}` || ''] || ''
      const { decrypt } = await import('@/lib/encryption')
      const accessToken = decrypt(broker.access_token_enc!)
      const apiKey = broker.api_key_enc ? (() => { try { return decrypt(broker.api_key_enc!) } catch { return envKey } })() : envKey
      const result = await getPositions({ apiKey, accessToken })
      const dayPositions = result.day.filter(p => (p.day_buy_quantity ?? 0) > 0 || (p.day_sell_quantity ?? 0) > 0)
      const totalPnl = dayPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0)

      return (
        <div style={{ fontFamily: INTER }}>
          <RefreshBar />
          <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: C.heading, margin: '0 0 4px' }}>Open Positions</h1>
          <p style={{ color: C.muted, fontSize: 14, margin: '0 0 20px' }}>
            {dayPositions.length} position{dayPositions.length !== 1 ? 's' : ''} traded today
            {dayPositions.length > 0 && (
              <> · Day P&amp;L: <span style={{ color: totalPnl >= 0 ? '#16A34A' : '#DC2626', fontWeight: 600 }}>
                {totalPnl >= 0 ? '+' : ''}₹{fmt(totalPnl, 0)}
              </span></>
            )}
          </p>
          {dayPositions.length === 0 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.muted }}>
              No trades today yet.
            </div>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#EFF6FF' }}>
                      {['Symbol', 'Net Qty', 'Bought', 'Sold', 'Buy Price', 'Sell Price', 'LTP', 'Day P&L', ''].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Net Qty' || h === 'Bought' || h === 'Sold' || h === 'Buy Price' || h === 'Sell Price' || h === 'LTP' || h === 'Day P&L' ? 'right' : 'left', fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dayPositions.map((p, i) => {
                      const netQty = p.quantity
                      const buyQty = p.day_buy_quantity ?? 0
                      const sellQty = p.day_sell_quantity ?? 0
                      const buyPrice = p.buy_price ?? p.day_buy_price ?? p.average_price ?? 0
                      const sellPrice = p.sell_price ?? 0
                      const ltp = p.last_price
                      const pnl = p.pnl ?? 0
                      const canSquareOff = netQty !== 0
                      const pnlColor = pnl >= 0 ? '#16A34A' : '#DC2626'
                      return (
                        <tr key={p.tradingsymbol} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                          <td style={{ padding: '10px 14px', fontWeight: 700, color: C.heading }}>{p.tradingsymbol}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: netQty > 0 ? '#16A34A' : netQty < 0 ? '#DC2626' : C.muted }}>{netQty > 0 ? `+${netQty}` : netQty}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: buyQty > 0 ? '#16A34A' : C.muted }}>{buyQty > 0 ? `+${buyQty}` : '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: sellQty > 0 ? '#DC2626' : C.muted }}>{sellQty > 0 ? `−${sellQty}` : '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: C.body }}>{buyPrice > 0 ? `₹${fmt(buyPrice)}` : '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: C.body }}>{sellPrice > 0 ? `₹${fmt(sellPrice)}` : '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: C.body }}>₹{fmt(ltp)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: pnlColor }}>{pnl >= 0 ? '+' : ''}₹{fmt(pnl, 0)}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {canSquareOff && <OrderButton symbol={p.tradingsymbol} side={netQty > 0 ? 'SELL' : 'BUY'} quantity={Math.abs(netQty)} price={ltp} label="Square Off" size="sm" />}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {dayPositions.length > 1 && (
                    <tfoot>
                      <tr style={{ borderTop: `2px solid ${C.border}`, background: '#EFF6FF' }}>
                        <td colSpan={7} style={{ padding: '10px 14px', fontWeight: 700, color: C.heading }}>Total Day P&L</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: totalPnl >= 0 ? '#16A34A' : '#DC2626' }}>{totalPnl >= 0 ? '+' : ''}₹{fmt(totalPnl, 0)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      )
    } catch { /* fall through to offline mode */ }
  }

  // ── Mode 2: Supabase fallback — tracked open positions + primary account LTPs ──
  const { data: trackedPositions } = await admin
    .from('customer_positions')
    .select('id, symbol, strategy_tag, total_qty, remaining_qty, first_buy_price, first_buy_at')
    .eq('customer_id', customerId).eq('status', 'open')
    .order('first_buy_at', { ascending: false })

  const rows = (trackedPositions ?? []).filter((p: any) => p.remaining_qty > 0)

  // Get live LTPs via primary account (best-effort)
  let ltpBySymbol = new Map<string, number>()
  if (rows.length > 0) {
    try {
      const primaryCreds = await loadBrokerAccountCreds(primaryCustomerId)
      if (primaryCreds) {
        const symbols = rows.map((p: any) => p.symbol.toUpperCase())
        const quotes = await getQuotes(primaryCreds, symbols)
        for (const [key, q] of Object.entries(quotes)) {
          ltpBySymbol.set(key.replace('NSE:', ''), q.last_price)
        }
      }
    } catch { /* best-effort */ }
  }

  const totalOfflinePnl = rows.reduce((sum: number, p: any) => {
    const ltp = ltpBySymbol.get(p.symbol.toUpperCase()) ?? p.first_buy_price
    return sum + (ltp - p.first_buy_price) * p.remaining_qty
  }, 0)

  return (
    <div style={{ fontFamily: INTER }}>
      <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: C.heading, margin: '0 0 4px' }}>Open Positions</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: '0 0 16px' }}>From DAlgo position store — broker not connected</p>

      <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#92400E' }}>⚠ Broker not connected — showing DAlgo tracked positions</p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#B45309' }}>
          Quantities and entry prices are from DAlgo's records. Live prices are from the platform's market data connection.
          Connect your Zerodha account in Settings to see today's intraday positions and enable Square Off.
        </p>
      </div>

      {rows.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.muted }}>
          No open positions in DAlgo records.
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#EFF6FF' }}>
                  {['Symbol', 'Strategy', 'Qty (Rem)', 'Avg Entry', 'LTP', 'Unreal. P&L', 'Days Held', 'Entry Date'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'LTP' || h === 'Unreal. P&L' ? 'right' : 'left', fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p: any, i: number) => {
                  const ltp = ltpBySymbol.get(p.symbol.toUpperCase()) ?? null
                  const pnl = ltp != null ? (ltp - p.first_buy_price) * p.remaining_qty : null
                  const pnlColor = pnl == null ? C.muted : pnl >= 0 ? '#16A34A' : '#DC2626'
                  const days = Math.floor((Date.now() - new Date(p.first_buy_at).getTime()) / 86400000)
                  return (
                    <tr key={p.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: C.heading }}>{p.symbol}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <StrategyTagButton symbol={p.symbol} currentTag={p.strategy_tag ?? 'accumulator'} strategies={activeStrategies} />
                      </td>
                      <td style={{ padding: '10px 14px', color: C.body }}>{p.remaining_qty} <span style={{ color: C.muted }}>/ {p.total_qty}</span></td>
                      <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(p.first_buy_price)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.body }}>{ltp != null ? `₹${fmt(ltp)}` : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: pnlColor }}>
                        {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}₹${fmt(Math.abs(pnl), 0)}`}
                      </td>
                      <td style={{ padding: '10px 14px', color: C.body }}>{days}d</td>
                      <td style={{ padding: '10px 14px', color: C.muted, fontSize: 12 }}>
                        {new Date(p.first_buy_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
