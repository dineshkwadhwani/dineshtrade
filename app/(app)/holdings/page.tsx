export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { getProfile } from '@/lib/dalgoAuth'
import { decrypt } from '@/lib/encryption'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

interface KiteHolding {
  tradingsymbol: string
  quantity: number
  t1_quantity: number
  average_price: number
  last_price: number
  pnl: number
}

async function fetchHoldings(apiKey: string, accessToken: string): Promise<KiteHolding[]> {
  try {
    const res = await fetch('https://api.kite.trade/portfolio/holdings', {
      headers: { 'X-Kite-Version': '3', 'Authorization': `token ${apiKey}:${accessToken}` },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const json = await res.json()
    return json?.data ?? []
  } catch { return [] }
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

export default async function HoldingsPage() {
  const sessionProfile = await getProfile()
  if (!sessionProfile) return null
  const customerId = sessionProfile.id
  const admin = getSupabaseAdmin()
  const env = process.env.ZERODHA_ENVIRONMENT === 'PROD' ? 'PROD' : 'TEST'
  const primaryAccount = process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH'
  const apiKey = process.env[`${env}_ZERODHA_API_KEY_${primaryAccount}`] || ''

  const { data: brokerAccount } = await admin
    .from('broker_accounts')
    .select('access_token_enc')
    .eq('customer_id', customerId)
    .eq('broker_name', 'zerodha')
    .eq('active', true)
    .maybeSingle()

  let holdings: KiteHolding[] = []
  let error = ''
  if (!brokerAccount?.access_token_enc) {
    error = 'Zerodha not connected. Please connect your broker in Settings.'
  } else {
    try {
      const accessToken = decrypt(brokerAccount.access_token_enc)
      holdings = await fetchHoldings(apiKey, accessToken)
    } catch {
      error = 'Failed to load holdings. Your Zerodha token may have expired.'
    }
  }

  const totalValue = holdings.reduce((sum, h) => sum + h.last_price * (h.quantity + h.t1_quantity), 0)
  const totalPnl = holdings.reduce((sum, h) => sum + h.pnl, 0)

  return (
    <div style={{ fontFamily: INTER }}>
      <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: C.heading, margin: '0 0 4px' }}>Current Holdings</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: '0 0 20px' }}>Live portfolio from Zerodha</p>

      {error ? (
        <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, padding: 16, color: '#DC2626', fontSize: 14 }}>{error}</div>
      ) : holdings.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.muted }}>No holdings found.</div>
      ) : (
        <>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Total Holdings', value: holdings.length },
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
                    {['Symbol', 'Qty', 'T+1 Qty', 'Avg Price', 'LTP', 'P&L', 'P&L %'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: C.heading, fontFamily: INTER, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => {
                    const pnlPct = h.average_price > 0 ? ((h.last_price - h.average_price) / h.average_price) * 100 : 0
                    const pnlColor = h.pnl >= 0 ? '#16A34A' : '#DC2626'
                    return (
                      <tr key={h.tradingsymbol} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: C.heading }}>{h.tradingsymbol}</td>
                        <td style={{ padding: '10px 14px', color: C.body }}>{h.quantity}</td>
                        <td style={{ padding: '10px 14px', color: C.muted }}>{h.t1_quantity}</td>
                        <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(h.average_price)}</td>
                        <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(h.last_price)}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: pnlColor }}>₹{fmt(h.pnl)}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: pnlColor }}>{pnlPct >= 0 ? '+' : ''}{fmt(pnlPct)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${C.border}`, background: '#EFF6FF' }}>
                    <td colSpan={5} style={{ padding: '10px 14px', fontWeight: 700, color: C.heading, fontSize: 13 }}>Total</td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: totalPnl >= 0 ? '#16A34A' : '#DC2626' }}>₹{fmt(totalPnl)}</td>
                    <td></td>
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
