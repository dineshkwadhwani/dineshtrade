export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { getProfile } from '@/lib/dalgoAuth'

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

  const { data: positions } = await admin
    .from('customer_positions')
    .select('id, symbol, strategy_tag, total_qty, remaining_qty, first_buy_price, first_buy_at, status, account')
    .eq('customer_id', customerId)
    .eq('status', 'open')
    .order('first_buy_at', { ascending: false })

  const rows = positions ?? []

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
                  {['Symbol', 'Strategy', 'Account', 'Qty (Rem)', 'Avg Entry', 'Days Held', 'Entry Date'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => {
                  const tag = p.strategy_tag ?? 'unknown'
                  const strategyColor = tag === 'accumulator' ? '#7C3AED' : tag === 'catalyst' ? '#0EA5E9' : '#6B7280'
                  return (
                    <tr key={p.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: C.heading }}>{p.symbol}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: strategyColor + '20', color: strategyColor }}>
                          {tag}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: C.muted, fontSize: 12 }}>{p.account || '—'}</td>
                      <td style={{ padding: '10px 14px', color: C.body }}>{p.remaining_qty} <span style={{ color: C.muted }}>/ {p.total_qty}</span></td>
                      <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(p.first_buy_price)}</td>
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
