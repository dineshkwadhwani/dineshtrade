export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { getProfile } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, getHoldings, getQuotes } from '@/lib/kite'
import { decrypt } from '@/lib/encryption'
import StrategyTagButton from '@/components/app/StrategyTagButton'
import OrderButton from '@/components/app/OrderButton'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

function daysHeld(firstBuyAt: string): number {
  return Math.floor((Date.now() - new Date(firstBuyAt).getTime()) / (1000 * 60 * 60 * 24))
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

function isTokenValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true  // no expiry stored — assume valid
  return new Date(expiresAt) > new Date()
}

interface DisplayHolding {
  symbol: string
  quantity: number
  t1_quantity: number
  average_price: number
  last_price: number
  pnl: number
  strategyTag: string | null
  firstBuyAt: string | null
  fromKite: boolean
}

export default async function HoldingsPage() {
  const profile = await getProfile()
  if (!profile) return null
  const customerId = profile.id
  const admin = getSupabaseAdmin()

  const env = process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'
  const primaryCustomerId = (process.env.CUSTOMER_IDS || '').split(',')[0]?.trim() || customerId

  const [brokerRes, trackedRes, strategyRes] = await Promise.all([
    admin.from('broker_accounts')
      .select('access_token_enc, api_key_enc, token_expires_at')
      .eq('customer_id', customerId).eq('broker_name', 'zerodha').eq('active', true)
      .maybeSingle(),
    admin.from('customer_positions')
      .select('symbol, strategy_tag, first_buy_at, remaining_qty, first_buy_price, status')
      .eq('customer_id', customerId).eq('status', 'open'),
    admin.from('customer_strategies')
      .select('strategy_key, name, color, active').eq('customer_id', customerId),
  ])

  const activeStrategies = ((strategyRes.data ?? []) as any[])
    .filter(s => s.active)
    .map(s => ({ id: s.strategy_key as string, label: s.name as string, color: (s.color as string) || '#6B7280' }))

  const trackedPositions = (trackedRes.data ?? []) as any[]
  const strategyBySymbol = new Map<string, { tag: string; firstBuyAt: string }>(
    trackedPositions.map(p => [p.symbol.toUpperCase(), { tag: p.strategy_tag ?? 'accumulator', firstBuyAt: p.first_buy_at }])
  )

  const broker = brokerRes.data
  const tokenValid = broker?.access_token_enc && isTokenValid(broker.token_expires_at)
  
  let holdings: DisplayHolding[] = []
  let offlineMode = false
  let totalValue = 0
  let totalPnl = 0

  if (tokenValid && broker) {
    // ── Mode 1: Kite live data ──────────────────────────────────────────
    try {
      const envApiKey = process.env[`${env}_ZERODHA_API_KEY_${process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH'}`] || ''
      const accessToken = decrypt(broker.access_token_enc!)
      const apiKey = broker.api_key_enc
        ? (() => { try { return decrypt(broker.api_key_enc!) } catch { return envApiKey } })()
        : envApiKey
      const kiteHoldings = await getHoldings({ apiKey, accessToken })
      holdings = kiteHoldings.map(h => {
        const tracked = strategyBySymbol.get(h.tradingsymbol.toUpperCase())
        return {
          symbol: h.tradingsymbol,
          quantity: h.quantity,
          t1_quantity: h.t1_quantity ?? 0,
          average_price: h.average_price,
          last_price: h.last_price,
          pnl: h.pnl,
          strategyTag: tracked?.tag ?? null,
          firstBuyAt: tracked?.firstBuyAt ?? null,
          fromKite: true,
        }
      })
    } catch {
      offlineMode = true
    }
  } else {
    offlineMode = true
  }

  if (offlineMode && trackedPositions.length > 0) {
    // ── Mode 2: Supabase store + primary account LTPs ────────────────────
    const symbols = trackedPositions.map(p => p.symbol.toUpperCase())
    let ltpBySymbol = new Map<string, number>()
    try {
      const primaryCreds = await loadBrokerAccountCreds(primaryCustomerId)
      if (primaryCreds) {
        const quotes = await getQuotes(primaryCreds, symbols)
        for (const [key, q] of Object.entries(quotes)) {
          const sym = key.replace('NSE:', '')
          ltpBySymbol.set(sym, q.last_price)
        }
      }
    } catch { /* best-effort */ }

    holdings = trackedPositions
      .filter(p => p.remaining_qty > 0)
      .map(p => {
        const sym = p.symbol.toUpperCase()
        const ltp = ltpBySymbol.get(sym) ?? p.first_buy_price
        const qty = p.remaining_qty
        const pnl = (ltp - p.first_buy_price) * qty
        return {
          symbol: p.symbol,
          quantity: qty,
          t1_quantity: 0,
          average_price: p.first_buy_price,
          last_price: ltp,
          pnl,
          strategyTag: p.strategy_tag ?? null,
          firstBuyAt: p.first_buy_at ?? null,
          fromKite: false,
        }
      })
  }

  totalValue = holdings.reduce((s, h) => s + h.last_price * (h.quantity + h.t1_quantity), 0)
  totalPnl = holdings.reduce((s, h) => s + h.pnl, 0)

  return (
    <div style={{ fontFamily: INTER }}>
      <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: C.heading, margin: '0 0 4px' }}>Holdings</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: '0 0 16px' }}>
        {offlineMode ? 'From DAlgo position store — broker not connected' : 'Live portfolio from Zerodha'}
      </p>

      {/* Offline mode banner */}
      {offlineMode && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#92400E' }}>
            ⚠ Broker not connected — showing DAlgo tracked positions
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#B45309' }}>
            Quantities and entry prices are from DAlgo's own records.
            Live prices are fetched via the platform's market data connection.
            Connect your Zerodha account in Settings for full broker data.
          </p>
        </div>
      )}

      {holdings.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.muted }}>
          {offlineMode ? 'No open positions in DAlgo records.' : 'No holdings found.'}
        </div>
      ) : (
        <>
          {/* Summary tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Total Holdings', value: String(holdings.length) },
              { label: 'Portfolio Value', value: `₹${fmt(totalValue)}` },
              { label: 'Total P&L', value: `₹${fmt(totalPnl)}`, pnl: totalPnl },
            ].map(s => (
              <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{s.label}</p>
                <p style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: SORA, color: s.pnl != null ? (s.pnl >= 0 ? '#16A34A' : '#DC2626') : C.heading }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#EFF6FF' }}>
                    {['Symbol', 'Strategy', 'Qty', offlineMode ? '' : 'T+1', 'Avg Price', 'LTP', 'P&L', 'P&L %', 'Days', ''].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: C.heading, fontFamily: INTER, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => {
                    const pnlPct = h.average_price > 0 ? ((h.last_price - h.average_price) / h.average_price) * 100 : 0
                    const pnlColor = h.pnl >= 0 ? '#16A34A' : '#DC2626'
                    const days = h.firstBuyAt ? daysHeld(h.firstBuyAt) : null
                    return (
                      <tr key={h.symbol} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: C.heading }}>{h.symbol}</td>
                        <td style={{ padding: '10px 14px' }}>
                          {h.strategyTag
                            ? <StrategyTagButton symbol={h.symbol} currentTag={h.strategyTag} strategies={activeStrategies} />
                            : <span style={{ color: '#94A3B8', fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 14px', color: C.body }}>{h.quantity}</td>
                        {!offlineMode && <td style={{ padding: '10px 14px', color: C.muted }}>{h.t1_quantity || '—'}</td>}
                        <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(h.average_price)}</td>
                        <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(h.last_price)}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: pnlColor }}>₹{fmt(h.pnl)}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: pnlColor }}>{pnlPct >= 0 ? '+' : ''}{fmt(pnlPct)}%</td>
                        <td style={{ padding: '10px 14px', color: C.muted, fontSize: 12 }}>{days != null ? `${days}d` : '—'}</td>
                        <td style={{ padding: '10px 14px' }}>
                          {/* SELL button only when broker is connected and has live qty */}
                          {!offlineMode && (
                            <OrderButton symbol={h.symbol} side="SELL" quantity={h.quantity} price={h.last_price} size="sm" />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${C.border}`, background: '#EFF6FF' }}>
                    <td colSpan={offlineMode ? 5 : 6} style={{ padding: '10px 14px', fontWeight: 700, color: C.heading, fontSize: 13 }}>Total</td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: totalPnl >= 0 ? '#16A34A' : '#DC2626' }}>₹{fmt(totalPnl)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
