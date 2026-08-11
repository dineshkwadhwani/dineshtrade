export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { getProfile } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, getHoldings } from '@/lib/kite'
import StrategyTagButton from '@/components/app/StrategyTagButton'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

function daysHeld(firstBuyAt: string): number {
  const diff = Date.now() - new Date(firstBuyAt).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

export default async function PositionsPage() {
  const sessionProfile = await getProfile()
  if (!sessionProfile) return null
  const customerId = sessionProfile.id
  const admin = getSupabaseAdmin()

  const [positionsRes, strategyRes, kiteHoldings] = await Promise.all([
    admin.from('customer_positions').select('id, symbol, strategy_tag, total_qty, remaining_qty, first_buy_price, first_buy_at, status, account').eq('customer_id', customerId).eq('status', 'open').order('first_buy_at', { ascending: false }),
    admin.from('customer_strategies').select('strategy_key, name, color, active').eq('customer_id', customerId),
    loadBrokerAccountCreds(customerId).then(creds => creds ? getHoldings(creds).catch(() => []) : []),
  ])

  // Build live price map from Kite holdings (last_price is always present)
  const ltpBySymbol = new Map<string, number>(
    kiteHoldings.map((h: { tradingsymbol: string; last_price: number }) => [h.tradingsymbol.toUpperCase(), h.last_price])
  )

  const activeStrategies = ((strategyRes.data ?? []) as any[])
    .filter(s => s.active)
    .map(s => ({ id: s.strategy_key as string, label: s.name as string, color: (s.color as string) || '#6B7280' }))

  const rows = positionsRes.data ?? []

  return (
    <div style={{ fontFamily: INTER }}>
      <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: C.heading, margin: '0 0 4px' }}>Open Positions</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: '0 0 20px' }}>{rows.length} position{rows.length !== 1 ? 's' : ''} open</p>

      {rows.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.muted }}>
          No open positions.
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#EFF6FF' }}>
                  {['Symbol', 'Strategy', 'Account', 'Qty (Rem)', 'Avg Entry', 'LTP', 'Unreal. P&L', 'Days Held', 'Entry Date'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'LTP' || h === 'Unreal. P&L' ? 'right' : 'left', fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => {
                  const tag = p.strategy_tag ?? 'unknown'
                  const ltp = ltpBySymbol.get(p.symbol.toUpperCase()) ?? null
                  const pnl = ltp != null && p.remaining_qty ? (ltp - p.first_buy_price) * p.remaining_qty : null
                  return (
                    <tr key={p.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: C.heading }}>{p.symbol}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <StrategyTagButton symbol={p.symbol} currentTag={tag} strategies={activeStrategies} />
                      </td>
                      <td style={{ padding: '10px 14px', color: C.muted, fontSize: 12 }}>{p.account || '—'}</td>
                      <td style={{ padding: '10px 14px', color: C.body }}>{p.remaining_qty} <span style={{ color: C.muted }}>/ {p.total_qty}</span></td>
                      <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(p.first_buy_price)}</td>
                      <td style={{ padding: '10px 14px', color: C.body, textAlign: 'right' }}>{ltp != null ? `₹${fmt(ltp)}` : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: pnl == null ? C.muted : pnl >= 0 ? '#16A34A' : '#DC2626' }}>
                        {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}₹${fmt(Math.abs(pnl), 0)}`}
                      </td>
                      <td style={{ padding: '10px 14px', color: C.body }}>{daysHeld(p.first_buy_at)}d</td>
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
