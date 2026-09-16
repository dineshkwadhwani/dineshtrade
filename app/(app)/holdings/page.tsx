export const dynamic = 'force-dynamic'

import RefreshBar from '@/components/ui/RefreshBar'

import { getSupabaseAdmin } from '@/lib/supabase'
import { getProfile } from '@/lib/dalgoAuth'
import { loadBrokerAccountCreds, getHoldings, getQuotes } from '@/lib/kite'
import { decrypt } from '@/lib/encryption'
import { sendDatastoreAlert } from '@/lib/email'
import { istDateString, readJournalRange, type JournalRecord, type OrderRecord, type TradeRecord } from '@/lib/journal'
import StrategyTagButton from '@/components/app/StrategyTagButton'
import OrderModalButton from '@/components/app/OrderModalButton'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"
const POSITIVE = '#52b788'
const NEGATIVE = '#e05a5e'

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

function recoverActiveLots(symbol: string, records: JournalRecord[]): Array<{ entryPrice: number; remainingQty: number; boughtAt: string }> {
  const buys = records
    .filter((record): record is OrderRecord => record.type === 'order' && record.side === 'BUY' && record.symbol.toUpperCase() === symbol.toUpperCase())
    .map(record => ({ entryPrice: record.price, remainingQty: record.qty, boughtAt: record.ts }))
  const trades = records
    .filter((record): record is TradeRecord => record.type === 'trade' && record.symbol.toUpperCase() === symbol.toUpperCase())
  for (const trade of trades) {
    let remainingToClose = trade.qty
    for (const lot of buys.filter(candidate => Math.abs(candidate.entryPrice - trade.entryPrice) < 0.01)) {
      if (remainingToClose <= 0) break
      const closedQty = Math.min(lot.remainingQty, remainingToClose)
      lot.remainingQty -= closedQty
      remainingToClose -= closedQty
    }
  }
  return buys.filter(lot => lot.remainingQty > 0)
}

interface DisplayHolding {
  symbol: string
  lotLabel?: string
  quantity: number
  t1_quantity: number
  average_price: number
  last_price: number
  close_price: number | null
  pnl: number
  strategyTag: string | null
  firstBuyAt: string | null
  fromKite: boolean
  // Position fully sold — strategyTag is the last known tag, shown read-only
  tagDisabled?: boolean
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
      .select('symbol, strategy_tag, first_buy_at, remaining_qty, first_buy_price, lots, status')
      .eq('customer_id', customerId).eq('status', 'open'),
    admin.from('customer_strategies')
      .select('strategy_key, name, color, active').eq('customer_id', customerId),
  ])

  const journalRecords = await readJournalRange('2020-01-01', istDateString()).catch(() => [] as JournalRecord[])

  const activeStrategies = ((strategyRes.data ?? []) as any[])
    .filter(s => s.active)
    .map(s => ({ id: s.strategy_key as string, label: s.name as string, color: (s.color as string) || '#6B7280' }))
  // 'Manual' is always offered — lets the user park a position out of cron's reach.
  activeStrategies.push({ id: 'manual', label: 'Manual', color: '#a78bfa' })

  // Store is the primary source of truth. If it's unreachable, show an error
  // rather than silently proceeding with an empty snapshot.
  if (trackedRes.error) {
    sendDatastoreAlert(`holdings page: ${trackedRes.error.message}`).catch(() => {})
    return (
      <div style={{ fontFamily: INTER, padding: 32 }}>
        <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: '#991B1B', margin: '0 0 12px' }}>
          Critical: Datastore not available
        </h1>
        <p style={{ color: '#7F1D1D', fontSize: 14, maxWidth: 560 }}>
          The DAlgo position store could not be read. This is a critical error that requires immediate
          investigation. An alert has been sent to the administrator. Please check your Supabase
          connection and retry.
        </p>
        <p style={{ color: '#94A3B8', fontSize: 12, marginTop: 8 }}>
          Error: {trackedRes.error.message}
        </p>
      </div>
    )
  }

  const trackedPositions = (trackedRes.data ?? []) as any[]
  const trackedBySymbol = new Map<string, any>(
    trackedPositions.map(p => [p.symbol.toUpperCase(), p])
  )

  const broker = brokerRes.data
  const tokenValid = broker?.access_token_enc && isTokenValid(broker.token_expires_at)
  
  let holdings: DisplayHolding[] = []
  let offlineMode = false
  let totalInvestment = 0
  let totalValue = 0
  let totalPnl = 0
  let todaysPnl = 0

  if (tokenValid && broker) {
    // ── Mode 1: Kite live data ──────────────────────────────────────────
    try {
      const envApiKey = process.env[`${env}_ZERODHA_API_KEY_${process.env[`${env}_ZERODHA_ACCOUNT1`] || 'DINESH'}`] || ''
      const accessToken = decrypt(broker.access_token_enc!)
      const apiKey = broker.api_key_enc
        ? (() => { try { return decrypt(broker.api_key_enc!) } catch { return envApiKey } })()
        : envApiKey
      const kiteHoldings = await getHoldings({ apiKey, accessToken })
      holdings = kiteHoldings.flatMap(h => {
        const tracked = trackedBySymbol.get(h.tradingsymbol.toUpperCase())
        const recoveredLots = tracked && (!Array.isArray(tracked.lots) || tracked.lots.length === 0)
          ? recoverActiveLots(h.tradingsymbol, journalRecords)
          : []
        const lotEntries = Array.isArray(tracked?.lots) && tracked.lots.length > 0
          ? tracked.lots
              .map((lot: any, originalIndex: number) => ({ lot, originalIndex }))
              .sort((a: any, b: any) => String(a.lot.boughtAt ?? a.lot.bought_at ?? '').localeCompare(String(b.lot.boughtAt ?? b.lot.bought_at ?? '')))
          : recoveredLots.map((lot, originalIndex) => ({ lot, originalIndex }))
        const activeLots = lotEntries.filter(({ lot }: { lot: any }) => Number(lot.remainingQty ?? lot.remaining_qty ?? 0) > 0)

        if (activeLots.length > 0) {
          return activeLots.map(({ lot, originalIndex }: { lot: any; originalIndex: number }) => {
            const quantity = Number(lot.remainingQty ?? lot.remaining_qty ?? 0)
            const averagePrice = Number(lot.entryPrice ?? lot.entry_price ?? tracked.first_buy_price) || h.average_price
            return {
              symbol: h.tradingsymbol,
              lotLabel: originalIndex === 0 ? undefined : `L${originalIndex + 1}`,
              quantity,
              t1_quantity: 0,
              average_price: averagePrice,
              last_price: h.last_price,
              close_price: h.close_price ?? null,
              pnl: (h.last_price - averagePrice) * quantity,
              strategyTag: lot.strategyId ?? tracked.strategy_tag ?? null,
              firstBuyAt: lot.boughtAt ?? lot.bought_at ?? tracked.first_buy_at ?? null,
              fromKite: true,
            }
          })
        }

        return [{
          symbol: h.tradingsymbol,
          quantity: h.quantity,
          t1_quantity: h.t1_quantity ?? 0,
          average_price: h.average_price,
          last_price: h.last_price,
          close_price: h.close_price ?? null,
          pnl: h.pnl,
          strategyTag: tracked?.strategy_tag ?? null,
          firstBuyAt: tracked?.first_buy_at ?? null,
          fromKite: true,
        }]
      })

      // A holding fully sold today shows qty 0 in Kite but its DAlgo position
      // row is already deleted (no longer 'open') — backfill the last strategy
      // it traded under from the orders log instead of offering "+ Assign".
      const zeroQtySymbols = holdings
        .filter(h => h.fromKite && !h.strategyTag && (h.quantity + h.t1_quantity) === 0)
        .map(h => h.symbol.toUpperCase())
      if (zeroQtySymbols.length > 0) {
        const { data: recentOrders } = await admin.from('orders')
          .select('symbol, strategy_tag, created_at')
          .eq('customer_id', customerId)
          .in('symbol', zeroQtySymbols)
          .order('created_at', { ascending: false })
        const lastTagBySymbol = new Map<string, string>()
        for (const o of (recentOrders ?? []) as any[]) {
          const sym = String(o.symbol).toUpperCase()
          if (!lastTagBySymbol.has(sym) && o.strategy_tag) lastTagBySymbol.set(sym, o.strategy_tag as string)
        }
        holdings = holdings.map(h => {
          const lastTag = lastTagBySymbol.get(h.symbol.toUpperCase())
          if (h.fromKite && !h.strategyTag && (h.quantity + h.t1_quantity) === 0 && lastTag) {
            return { ...h, strategyTag: lastTag, tagDisabled: true }
          }
          return h
        })
      }
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

    // Expand per-position lots into separate holding rows so each lot shows
    // its own entry price and quantity in the Holdings UI.
    holdings = trackedPositions.flatMap(p => {
      const sym = p.symbol.toUpperCase()
      const ltp = ltpBySymbol.get(sym) ?? p.first_buy_price
      // If lots exist, render one row per lot; otherwise render the legacy
      // single-row using the position's first_buy_price.
      if (Array.isArray(p.lots) && p.lots.length > 0) {
        return p.lots
          .map((lot: any, originalIndex: number) => ({ lot, originalIndex }))
          .filter(({ lot }: { lot: any }) => (lot.remainingQty ?? lot.remaining_qty ?? 0) > 0)
          .map(({ lot, originalIndex }: { lot: any; originalIndex: number }) => {
            const qty = lot.remainingQty ?? lot.remaining_qty ?? 0
            const entryPrice = lot.entryPrice ?? lot.entry_price ?? p.first_buy_price
            return {
              symbol: p.symbol,
              lotLabel: originalIndex === 0 ? undefined : `L${originalIndex + 1}`,
              quantity: qty,
              t1_quantity: 0,
              average_price: entryPrice,
              last_price: ltp,
              close_price: null,
              pnl: (ltp - entryPrice) * qty,
              strategyTag: lot.strategyId ?? p.strategy_tag ?? null,
              firstBuyAt: lot.boughtAt ?? lot.bought_at ?? p.first_buy_at ?? null,
              fromKite: false,
            }
          })
      }
      const qty = p.remaining_qty
      const pnl = (ltp - p.first_buy_price) * qty
      return [{
        symbol: p.symbol,
        quantity: qty,
        t1_quantity: 0,
        average_price: p.first_buy_price,
        last_price: ltp,
        close_price: null,
        pnl,
        strategyTag: p.strategy_tag ?? null,
        firstBuyAt: p.first_buy_at ?? null,
        fromKite: false,
      }]
    })
  }

  totalInvestment = holdings.reduce((s, h) => s + h.average_price * (h.quantity + h.t1_quantity), 0)
  totalValue = holdings.reduce((s, h) => s + h.last_price * (h.quantity + h.t1_quantity), 0)
  totalPnl = holdings.reduce((s, h) => (h.quantity + h.t1_quantity) * (h.last_price - h.average_price) + s, 0)
  todaysPnl = holdings.reduce((s, h) => {
    const qty = h.quantity + h.t1_quantity
    if (!h.close_price || h.close_price <= 0 || qty <= 0) return s
    return s + (h.last_price - h.close_price) * qty
  }, 0)

  return (
    <div style={{ fontFamily: INTER }}>
      <RefreshBar />
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
          <div className="desktop-only">
            {/* Summary tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
              {[
                { label: 'Total Holdings', value: String(holdings.length) },
                { label: 'Total Investment', value: `₹${fmt(totalInvestment)}` },
                { label: 'Portfolio Value', value: `₹${fmt(totalValue)}` },
                { label: 'Total P&L', value: `₹${fmt(totalPnl)}`, pnl: totalPnl },
                { label: "Today's P/L", value: `₹${fmt(todaysPnl)}`, pnl: todaysPnl },
              ].map(s => (
                <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{s.label}</p>
                  <p style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: SORA, color: s.pnl != null ? (s.pnl >= 0 ? POSITIVE : NEGATIVE) : C.heading }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Table */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#EFF6FF' }}>
                      {['Symbol', 'Strategy', 'Qty', 'Avg Price', 'LTP', 'P&L', 'P&L %', 'Today', 'Days', ''].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: C.heading, fontFamily: INTER, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h, i) => {
                      const totalQty = h.quantity + h.t1_quantity
                      const pnlPct = h.average_price > 0 ? ((h.last_price - h.average_price) / h.average_price) * 100 : 0
                      // Recalculate P&L using total qty — Kite's h.pnl uses settled qty only
                      const pnl = totalQty * (h.last_price - h.average_price)
                      const pnlColor = pnl >= 0 ? POSITIVE : NEGATIVE
                      const todayPct = h.close_price && h.close_price > 0 ? ((h.last_price - h.close_price) / h.close_price) * 100 : null
                      const todayColor = (todayPct ?? 0) >= 0 ? POSITIVE : NEGATIVE
                      const days = h.firstBuyAt ? daysHeld(h.firstBuyAt) : null
                      return (
                        <tr key={`${h.symbol}-${h.lotLabel ?? 'aggregate'}`} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.card : C.bg }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: C.heading }}>
                            {h.symbol}{h.lotLabel ? <span style={{ marginLeft: 6, color: C.muted, fontSize: 11 }}>{h.lotLabel}</span> : null}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {h.strategyTag
                              ? <StrategyTagButton symbol={h.symbol} currentTag={h.strategyTag} strategies={activeStrategies} kiteQty={totalQty} kiteAvgPrice={h.average_price} disabled={h.tagDisabled} />
                              : h.fromKite
                                ? <StrategyTagButton symbol={h.symbol} currentTag="untracked" strategies={activeStrategies} kiteQty={totalQty} kiteAvgPrice={h.average_price} />
                                : <span style={{ color: '#94A3B8', fontSize: 12 }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px', color: C.body }}>
                            {totalQty}
                            {h.t1_quantity > 0 && <span title={`${h.t1_quantity} pending T+1 settlement`} style={{ marginLeft: 4, fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: '#FEF3C7', color: '#D97706' }}>T1</span>}
                          </td>
                          <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(h.average_price)}</td>
                          <td style={{ padding: '10px 14px', color: C.body }}>₹{fmt(h.last_price)}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: pnlColor }}>₹{fmt(pnl)}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: pnlColor }}>{pnlPct >= 0 ? '+' : ''}{fmt(pnlPct)}%</td>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: todayPct == null ? C.muted : todayColor }}>{todayPct == null ? '—' : `${todayPct >= 0 ? '+' : ''}${fmt(todayPct)}%`}</td>
                          <td style={{ padding: '10px 14px', color: C.muted, fontSize: 12 }}>{days != null ? `${days}d` : '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {!offlineMode && <OrderModalButton symbol={h.symbol} side="SELL" quantity={totalQty} price={h.last_price} size="sm" />}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${C.border}`, background: '#EFF6FF' }}>
                      <td colSpan={5} style={{ padding: '10px 14px', fontWeight: 700, color: C.heading, fontSize: 13 }}>Total</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: totalPnl >= 0 ? POSITIVE : NEGATIVE }}>₹{fmt(totalPnl)}</td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          <div className="mobile-only">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {holdings.map((h, i) => {
                const totalQty = h.quantity + h.t1_quantity
                const investedAmount = totalQty * h.average_price
                const pnl = totalQty * (h.last_price - h.average_price)
                const pnlPct = h.average_price > 0 ? ((h.last_price - h.average_price) / h.average_price) * 100 : 0
                const todayPct = h.close_price && h.close_price > 0 ? ((h.last_price - h.close_price) / h.close_price) * 100 : null
                const todayPnl = h.close_price && h.close_price > 0 ? (h.last_price - h.close_price) * totalQty : 0
                const pnlColor = pnl >= 0 ? POSITIVE : NEGATIVE
                const todayColor = (todayPct ?? 0) >= 0 ? POSITIVE : NEGATIVE

                return (
                  <div key={`${h.symbol}-${h.lotLabel ?? 'aggregate'}-${i}`} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <div style={{ fontWeight: 700, fontSize: 16, color: C.heading, letterSpacing: '-0.01em' }}>{h.symbol}{h.lotLabel ? <span style={{ marginLeft: 6, color: C.muted, fontSize: 11 }}>{h.lotLabel}</span> : null}</div>
                          {h.strategyTag
                            ? <StrategyTagButton
                                symbol={h.symbol}
                                currentTag={h.strategyTag}
                                strategies={activeStrategies}
                                kiteQty={h.quantity + h.t1_quantity}
                                kiteAvgPrice={h.average_price}
                                disabled={h.tagDisabled}
                              />
                            : h.fromKite
                              ? <StrategyTagButton
                                  symbol={h.symbol}
                                  currentTag="untracked"
                                  strategies={activeStrategies}
                                  kiteQty={h.quantity + h.t1_quantity}
                                  kiteAvgPrice={h.average_price}
                                />
                              : null}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, color: C.body, fontSize: 12, lineHeight: 1.5 }}>
                          <span>Qty: <strong>{totalQty}</strong></span>
                          <span>Avg: <strong>₹{fmt(h.average_price)}</strong></span>
                          <span>Days: <strong>{h.firstBuyAt ? daysHeld(h.firstBuyAt) : '—'}</strong></span>
                        </div>

                        <div style={{ marginTop: 8, fontSize: 12, color: C.body }}>
                          Invested: <strong>₹{fmt(investedAmount)}</strong>
                        </div>

                        <div style={{ marginTop: 4, fontSize: 12, color: pnlColor, fontWeight: 700 }}>
                          P/L %: {pnlPct >= 0 ? '+' : ''}{fmt(pnlPct)}%
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', minWidth: 120 }}>
                        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                          <span style={{ color: C.body, fontSize: 12 }}>LTP</span>
                          <span style={{ fontWeight: 700, color: C.heading, fontSize: 18 }}>₹{fmt(h.last_price)}</span>
                        </div>

                        <div style={{ marginTop: 8, fontSize: 12, color: todayColor, fontWeight: 700 }}>
                          {todayPct == null ? 'Today —' : `${todayPct >= 0 ? '+' : ''}${fmt(todayPct)}%`}
                        </div>
                        <div style={{ marginTop: 2, fontSize: 12, color: todayColor, fontWeight: 700 }}>
                          {todayPct == null ? '—' : `₹${fmt(todayPnl)}`}
                        </div>
                      </div>
                    </div>

                    {!offlineMode && (
                      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                        <OrderModalButton symbol={h.symbol} side="SELL" quantity={totalQty} price={h.last_price} size="sm" />
                      </div>
                    )}
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
