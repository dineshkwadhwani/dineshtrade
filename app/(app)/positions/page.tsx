// Today's intraday positions from Kite /portfolio/positions (day array).
// Shows net qty of what was traded today: positive=net bought, negative=net sold.
export const dynamic = 'force-dynamic'

import { getProfile } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, getPositions } from '@/lib/kite'
import OrderButton from '@/components/app/OrderButton'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

export default async function PositionsPage() {
  const profile = await getProfile()
  if (!profile) return null

  const creds = await loadBrokerAccountCreds(profile.id)

  let dayPositions: Awaited<ReturnType<typeof getPositions>>['day'] = []
  let error = ''

  if (!creds) {
    error = 'Zerodha not connected. Please connect your broker in Settings.'
  } else {
    try {
      const result = await getPositions(creds)
      // Only show positions with at least one buy or sell today
      dayPositions = result.day.filter(
        p => (p.day_buy_quantity ?? 0) > 0 || (p.day_sell_quantity ?? 0) > 0
      )
    } catch {
      error = 'Failed to load positions. Your Zerodha token may have expired.'
    }
  }

  // Net value = day buys - day sells for P&L context
  const totalPnl = dayPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0)

  return (
    <div style={{ fontFamily: INTER }}>
      <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: C.heading, margin: '0 0 4px' }}>
        Open Positions
      </h1>
      <p style={{ color: C.muted, fontSize: 14, margin: '0 0 20px' }}>
        {dayPositions.length} position{dayPositions.length !== 1 ? 's' : ''} traded today
        {dayPositions.length > 0 && (
          <> · Day P&amp;L: <span style={{ color: totalPnl >= 0 ? '#16A34A' : '#DC2626', fontWeight: 600 }}>
            {totalPnl >= 0 ? '+' : ''}₹{fmt(totalPnl, 0)}
          </span></>
        )}
      </p>

      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '14px 18px', color: '#DC2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!error && dayPositions.length === 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.muted }}>
          No trades today yet.
        </div>
      )}

      {dayPositions.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#EFF6FF' }}>
                  {['Symbol', 'Net Qty', 'Bought', 'Sold', 'Buy Price', 'Sell Price', 'LTP', 'Day P&L', ''].map(h => (
                    <th key={h} style={{
                      padding: '10px 14px',
                      textAlign: h === 'Net Qty' || h === 'Bought' || h === 'Sold' || h === 'Buy Price' || h === 'Sell Price' || h === 'LTP' || h === 'Day P&L' ? 'right' : 'left',
                      fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dayPositions.map((p, i) => {
                  const netQty = p.quantity // Kite day position quantity = net of buys - sells
                  const buyQty = p.day_buy_quantity ?? 0
                  const sellQty = p.day_sell_quantity ?? 0
                  const buyPrice = p.buy_price ?? p.day_buy_price ?? p.average_price ?? 0
                  const sellPrice = p.sell_price ?? 0
                  const ltp = p.last_price
                  const pnl = p.pnl ?? 0
                  const isNetLong = netQty > 0
                  const canSquareOff = netQty !== 0
                  const pnlColor = pnl >= 0 ? '#16A34A' : '#DC2626'
                  return (
                    <tr key={p.tradingsymbol} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: C.heading }}>{p.tradingsymbol}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: isNetLong ? '#16A34A' : netQty < 0 ? '#DC2626' : C.muted }}>
                        {netQty > 0 ? `+${netQty}` : netQty}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: buyQty > 0 ? '#16A34A' : C.muted }}>
                        {buyQty > 0 ? `+${buyQty}` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: sellQty > 0 ? '#DC2626' : C.muted }}>
                        {sellQty > 0 ? `−${sellQty}` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.body }}>
                        {buyPrice > 0 ? `₹${fmt(buyPrice)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.body }}>
                        {sellPrice > 0 ? `₹${fmt(sellPrice)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: C.body }}>₹{fmt(ltp)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: pnlColor }}>
                        {pnl >= 0 ? '+' : ''}₹{fmt(pnl, 0)}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {canSquareOff && (
                          <OrderButton
                            symbol={p.tradingsymbol}
                            side={netQty > 0 ? 'SELL' : 'BUY'}
                            quantity={Math.abs(netQty)}
                            price={ltp}
                            label="Square Off"
                            size="sm"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {dayPositions.length > 1 && (
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${C.border}`, background: '#EFF6FF' }}>
                    <td colSpan={7} style={{ padding: '10px 14px', fontWeight: 700, color: C.heading }}>Total Day P&L</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: totalPnl >= 0 ? '#16A34A' : '#DC2626' }}>
                      {totalPnl >= 0 ? '+' : ''}₹{fmt(totalPnl, 0)}
                    </td>
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
}
