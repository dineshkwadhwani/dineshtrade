export const dynamic = 'force-dynamic'

import RefreshBar from '@/components/ui/RefreshBar'

import { getSupabaseAdmin } from '@/lib/supabase'
import { getProfile } from '@/lib/dalgoAuth'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

const STATUS_BADGE: Record<string, { color: string; bg: string }> = {
  COMPLETE: { color: '#16A34A', bg: '#DCFCE7' },
  OPEN: { color: '#3B82F6', bg: '#DBEAFE' },
  REJECTED: { color: '#DC2626', bg: '#FEE2E2' },
  CANCELLED: { color: '#94A3B8', bg: '#F1F5F9' },
}

const SOURCE_BADGE: Record<string, { color: string; bg: string }> = {
  manual: { color: '#7c2d12', bg: '#ffedd5' },
  auto: { color: '#1d4ed8', bg: '#dbeafe' },
}

const STRATEGY_BADGE: Record<string, { color: string; bg: string; label: string }> = {
  accumulator: { color: '#14532d', bg: '#dcfce7', label: 'Accumulator' },
  catalyst: { color: '#0f766e', bg: '#ccfbf1', label: 'Catalyst' },
  market_boom: { color: '#7c3aed', bg: '#ede9fe', label: 'Market Boom' },
  new_pivotal: { color: '#9a3412', bg: '#ffedd5', label: 'New Pivotal' },
}

export default async function OrdersPage() {
  const sessionProfile = await getProfile()
  if (!sessionProfile) return null
  const customerId = sessionProfile.id
  const admin = getSupabaseAdmin()

  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // YYYY-MM-DD

  const { data: orders } = await admin
    .from('orders')
    .select('id, symbol, side, qty, price, status, source, strategy_tag, account, created_at, reason')
    .eq('customer_id', customerId)
    .eq('trade_date', todayIST)
    .order('created_at', { ascending: false })

  const rows = orders ?? []
  const buys = rows.filter(o => o.side === 'BUY').length
  const sells = rows.filter(o => o.side === 'SELL').length

  return (
    <div style={{ fontFamily: INTER }}>
      <RefreshBar />
      <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: C.heading, margin: '0 0 4px' }}>Today&apos;s Orders</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: '0 0 20px' }}>
        {rows.length} order{rows.length !== 1 ? 's' : ''} · {buys} buy{buys !== 1 ? 's' : ''} · {sells} sell{sells !== 1 ? 's' : ''}
      </p>

      {rows.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.muted }}>
          No orders placed today.
        </div>
      ) : (
        <>
          <div className="desktop-only">
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#EFF6FF' }}>
                      {['Time', 'Symbol', 'Side', 'Qty', 'Price', 'Status', 'Strategy', 'Source'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: C.heading, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o, i) => {
                      const sb = STATUS_BADGE[o.status?.toUpperCase()] ?? STATUS_BADGE.CANCELLED
                      const sideColor = o.side === 'BUY' ? '#3B82F6' : '#D97706'
                      const sideBg = o.side === 'BUY' ? '#DBEAFE' : '#FEF3C7'
                      const timeStr = new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
                      return (
                        <tr key={o.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                          <td style={{ padding: '10px 14px', color: C.muted, fontSize: 12, fontFamily: 'monospace' }}>{timeStr}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: C.heading }}>{o.symbol}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sideBg, color: sideColor }}>{o.side}</span>
                          </td>
                          <td style={{ padding: '10px 14px', color: C.body }}>{o.qty}</td>
                          <td style={{ padding: '10px 14px', color: C.body }}>₹{Number(o.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: sb.bg, color: sb.color }}>{o.status}</span>
                          </td>
                          <td style={{ padding: '10px 14px', color: C.muted, fontSize: 12 }}>{o.strategy_tag ?? '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {(() => {
                              const strategyKey = (o.strategy_tag || '').toLowerCase()
                              const strategyBadge = STRATEGY_BADGE[strategyKey]
                              return strategyBadge ? (
                                <span
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    background: strategyBadge.bg,
                                    color: strategyBadge.color,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.03em',
                                  }}
                                >
                                  {strategyBadge.label}
                                </span>
                              ) : (
                                <span style={{ color: C.muted, fontSize: 12 }}>—</span>
                              )
                            })()}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {(() => {
                              const sourceKey = (o.source || '').toLowerCase()
                              const sourceBadge = SOURCE_BADGE[sourceKey]
                              return sourceBadge ? (
                                <span
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    background: sourceBadge.bg,
                                    color: sourceBadge.color,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.03em',
                                  }}
                                >
                                  {sourceKey}
                                </span>
                              ) : (
                                <span style={{ color: C.muted, fontSize: 12 }}>{o.source || '—'}</span>
                              )
                            })()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mobile-only">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map(o => {
                const sb = STATUS_BADGE[o.status?.toUpperCase()] ?? STATUS_BADGE.CANCELLED
                const sideColor = o.side === 'BUY' ? '#3B82F6' : '#D97706'
                const sideBg = o.side === 'BUY' ? '#DBEAFE' : '#FEF3C7'
                const timeStr = new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
                const strategyKey = (o.strategy_tag || '').toLowerCase()
                const strategyBadge = STRATEGY_BADGE[strategyKey]
                const sourceKey = (o.source || '').toLowerCase()
                const sourceBadge = SOURCE_BADGE[sourceKey]

                return (
                  <div key={o.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 17, color: C.heading }}>{o.symbol}</div>
                      <span style={{ padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sideBg, color: sideColor }}>{o.side}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 12 }}>
                      <div style={{ color: C.body, fontSize: 12 }}>
                        <div>Qty: <strong>{o.qty}</strong></div>
                        <div>Price: <strong>₹{Number(o.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
                        <div style={{ marginTop: 4 }}>
                          {strategyBadge ? (
                            <span style={{ padding: '3px 6px', borderRadius: 999, background: strategyBadge.bg, color: strategyBadge.color, fontWeight: 700, fontSize: 10 }}>
                              {strategyBadge.label}
                            </span>
                          ) : (
                            <span style={{ color: C.muted, fontSize: 11 }}>{o.strategy_tag ?? '—'}</span>
                          )}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', minWidth: 110 }}>
                        <div style={{ color: C.muted, fontSize: 11 }}>{timeStr}</div>
                        <div style={{ marginTop: 6 }}>
                          <span style={{ padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: sb.bg, color: sb.color }}>{o.status}</span>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 11, color: sourceBadge ? sourceBadge.color : C.muted, fontWeight: 700 }}>
                          {sourceBadge ? sourceKey : (o.source || '—')}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      <style>{`
        .desktop-only { display: block; }
        .mobile-only { display: none; }

        @media (max-width: 767px) {
          .desktop-only { display: none !important; }
          .mobile-only { display: block !important; }
        }
      `}</style>
    </div>
  )
}
