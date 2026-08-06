'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import OrderModal from '@/components/OrderModal'
import type { EnrichedPosition } from '@/app/api/positions/route'
import { isMarketOpen } from '@/lib/market'

interface AccountDisplay { name: string; displayName: string; initials: string; color: string; note: string }

interface StrategyOption { id: string; name: string; color: string; type: string }

interface Holding {
  tradingsymbol: string
  exchange: string
  product: string
  // Kite splits long qty across two fields. `quantity` = T+1 settled (sellable
  // via CNC right now). `t1_quantity` = bought today, still in settlement —
  // becomes `quantity` next trading day. Total long = quantity + t1_quantity.
  quantity: number
  t1_quantity?: number
  average_price: number
  last_price: number
  close_price: number
  pnl: number
  day_change: number
  day_change_percentage: number
  source?: 'holding' | 't0'
  t0StrategyId?: string
  displayEntryPrice?: number
  lotId?: string
  lots?: Array<{ id: string; entryPrice: number; remainingQty: number; originalQty?: number; boughtAt: string; strategyId?: string }>
  isPartialLot?: boolean
  journalReconciled?: boolean
}

interface QuoteEntry {
  last_price?: number
  ohlc?: { close?: number }
}

function totalQty(h: Holding): number {
  return (h.quantity || 0) + (h.t1_quantity || 0)
}

function positionToHolding(position: EnrichedPosition): Holding {
  const dayChangePct = position.dayChangePct ?? 0
  const prevClose = dayChangePct === -100
    ? position.ltp
    : position.ltp / (1 + (dayChangePct / 100))
  const dayChange = position.ltp - prevClose
  return {
    tradingsymbol: position.symbol,
    exchange: position.exchange || 'NSE',
    product: position.product,
    quantity: Math.max(0, position.qty),
    t1_quantity: 0,
    average_price: position.avgPrice || 0,
    last_price: position.ltp || 0,
    close_price: Number.isFinite(prevClose) ? prevClose : position.ltp || 0,
    pnl: position.unrealized,
    day_change: Number.isFinite(dayChange) ? dayChange : 0,
    day_change_percentage: dayChangePct,
    source: 't0',
    t0StrategyId: (position as any).strategyId,
    lots: (position as any).lots,
    journalReconciled: (position as any).journalReconciled,
  }
}

interface MarginsAvailable {
  cash?: number
  live_balance?: number
  opening_balance?: number
}

interface MarginsResponse {
  equity?: { net?: number; available?: MarginsAvailable; utilised?: { debits?: number } }
}

export default function HoldingsPage() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [activeStrategies, setActiveStrategies] = useState<StrategyOption[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)
  const [margins, setMargins] = useState<MarginsResponse | null>(null)
  const [holdings, setHoldings] = useState<Holding[]>([])
  // Maps "ACCOUNT:SYMBOL" → strategy info from the unified position store.
  // Holdings not in the store render as OOS (pre-existing / not auto-managed).
  const [posTags, setPosTags] = useState<Map<string, { strategyId: string; strategyName: string; strategyColor: string; strategyType?: string; remainingQty?: number }>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [orderModal, setOrderModal] = useState<{
    open: boolean; symbol: string; name?: string; side: 'BUY' | 'SELL'; ltp?: number; initialQty?: number; dayChangePct?: number
  }>({ open: false, symbol: '', side: 'SELL' })
  const [switchModal, setSwitchModal] = useState<{
    open: boolean
    symbol: string
    currentStrategyId: string
    lotId?: string
    currentStrategyName: string
    selectedStrategyId: string
    busy: boolean
    error: string
  }>({ open: false, symbol: '', currentStrategyId: '', currentStrategyName: '', selectedStrategyId: '', busy: false, error: '' })

  const strategyById = new Map(activeStrategies.map(strategy => [strategy.id, strategy]))

  const [market, setMarket] = useState(() => isMarketOpen())
  useEffect(() => {
    const id = setInterval(() => setMarket(isMarketOpen()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Initial load — accounts + connection set
  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
      fetch('/api/strategies').then(r => r.json()).catch(() => ({ strategies: [] })),
    ]).then(([a, s, strategiesRes]) => {
      setAccounts(a.accounts || [])
      const conn: string[] = s.accountsWithToken || []
      setConnected(conn)
      if (conn.length > 0) setActiveTab(conn[0])
      const strategies = Array.isArray(strategiesRes?.strategies) ? strategiesRes.strategies : []
      setActiveStrategies(
        strategies
          .filter((item: any) => item?.active)
          .map((item: any) => ({ id: item.id, name: item.name, color: item.color, type: item.type }))
      )
    }).catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  function closeSwitchModal() {
    setSwitchModal({ open: false, symbol: '', currentStrategyId: '', currentStrategyName: '', selectedStrategyId: '', busy: false, error: '' })
  }

  function openStrategySwitch(symbol: string, currentStrategyId: string, currentStrategyName: string, lotId?: string) {
    const options = activeStrategies.filter(strategy => strategy.id !== currentStrategyId)
    setSwitchModal({
      open: true,
      symbol,
      currentStrategyId,
      lotId,
      currentStrategyName,
      selectedStrategyId: options[0]?.id || '',
      busy: false,
      error: '',
    })
  }

  async function confirmStrategySwitch() {
    if (!activeTab || !switchModal.selectedStrategyId || switchModal.busy) return
    if (!switchModal.lotId) {
      setSwitchModal(current => ({ ...current, error: 'Lot id missing for this row. Refresh and try again.' }))
      return
    }
    setSwitchModal(current => ({ ...current, busy: true, error: '' }))
    try {
      const body: any = {
        account: activeTab,
        symbol: switchModal.symbol,
        targetStrategyId: switchModal.selectedStrategyId,
        lotId: switchModal.lotId,
      }
      const res = await fetch('/api/strategy/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.error) {
        setSwitchModal(current => ({ ...current, busy: false, error: data?.error || `HTTP ${res.status}` }))
        return
      }
      closeSwitchModal()
      await load(activeTab)
    } catch {
      setSwitchModal(current => ({ ...current, busy: false, error: 'Failed to switch strategy' }))
    }
  }

  // Fetch margins + holdings + unified position store whenever active tab changes.
  // The position store tags each holding with its managing strategy (CATALYST,
  // MARKET BOOM, ACCUMULATOR, …). Holdings not in the store render as OOS.
  async function load(account: string) {
    setLoading(true)
    setError('')
    setMargins(null)
    setHoldings([])
    try {
      const [mRes, hRes, sRes, pRes] = await Promise.all([
        fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=margins`).then(r => r.json()),
        fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=holdings`).then(r => r.json()),
        fetch(`/api/strategy/positions?_t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ positions: [] })),
        fetch(`/api/positions?account=${encodeURIComponent(account)}&_t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ positions: [] })),
      ])
      if (mRes.error) {
        setError(mRes.error)
      } else {
        setMargins(mRes.data || null)
      }
      if (hRes.error && !mRes.error) {
        setError(hRes.error)
      } else if (Array.isArray(hRes.data)) {
        const rawHoldings = hRes.data as Holding[]
        const baseHoldings = rawHoldings.filter(item => totalQty(item) > 0)
        const symbols = Array.from(new Set(baseHoldings
          .map(item => `${item.exchange || 'NSE'}:${item.tradingsymbol}`)
          .filter(Boolean)))

        let liveQuotes: Record<string, QuoteEntry> = {}
        if (symbols.length > 0) {
          const quoteRes = await fetch(`/api/zerodha?account=${encodeURIComponent(account)}&action=quote&symbols=${encodeURIComponent(symbols.join(','))}`)
            .then(r => r.json())
            .catch(() => null)
          if (quoteRes?.data && typeof quoteRes.data === 'object') {
            liveQuotes = quoteRes.data as Record<string, QuoteEntry>
          }
        }

        const enrichedHoldings = baseHoldings.map(item => {
          const quoteKey = `${item.exchange || 'NSE'}:${item.tradingsymbol}`
          const quote = liveQuotes[quoteKey]
          const liveLtp = Number(quote?.last_price) || item.last_price || 0
          const prevClose = Number(quote?.ohlc?.close) || item.close_price || 0
          const qty = totalQty(item)
          const dayChange = liveLtp - prevClose
          return {
            ...item,
            last_price: liveLtp,
            day_change: dayChange,
            day_change_percentage: prevClose > 0 ? (dayChange / prevClose) * 100 : item.day_change_percentage,
            pnl: qty * (liveLtp - (item.average_price || 0)),
          }
        })

        // Show today's same-day positions as SEPARATE rows even when the symbol
        // already exists in settled holdings. A stock like COALINDIA bought on
        // Accumulator (settled, in holdings) and then re-bought today on Catalyst
        // (T0, in positions) are two distinct lots managed by different strategies
        // with different exit rules — merging them into one row would destroy the
        // strategy attribution and apply the wrong exits.
        const holdingSymbols = new Set(enrichedHoldings.map(item => item.tradingsymbol.toUpperCase()))

        // avgPrice from Kite's holdings endpoint = true weighted buy cost. Keep a
        // lookup over ALL rawHoldings (including qty=0 ones already filtered out) so
        // we can patch T0 rows that were sold today — Kite's net positions returns
        // the SELL price as average_price for closed CNC positions, which is wrong.
        const holdingAvgBySymbol = new Map<string, number>()
        for (const h of rawHoldings) {
          if ((h.average_price || 0) > 0) holdingAvgBySymbol.set(h.tradingsymbol.toUpperCase(), h.average_price)
        }

        const t0Rows = Array.isArray(pRes?.positions)
          ? (pRes.positions as EnrichedPosition[])
              // Include ALL same-day positions, even zero-qty sold rows.
              // Each position row should render its own lot: active lots as qty,
              // partially sold lots as partial qty, and fully sold lots as 0 qty.
              .map(positionToHolding)
              .map(r => {
                // For closed T0 positions (qty=0), Kite's net position avg_price is
                // the sell execution price, not the buy cost. Replace it with the
                // holdings avg (Kite's weighted avg of all buy lots) when available.
                // Skip when the backend already reconciled this row against the
                // journal — that avg_price is the true per-lot entry price, and the
                // Kite holdings avg (a symbol-wide figure) would be wrong for it.
                if (totalQty(r) === 0 && !r.journalReconciled) {
                  const buyAvg = holdingAvgBySymbol.get(r.tradingsymbol.toUpperCase())
                  if (buyAvg) return { ...r, average_price: buyAvg }
                }
                return r
              })
          : []

        // Track active T0 trade prices only for deduping settled holdings.
        // Closed/sold same-day rows (qty 0) must still appear separately.
        const t0ActiveRows = t0Rows.filter(r => totalQty(r) > 0)
        const t0PricesBySymbol = new Map<string, number[]>()
        for (const row of t0ActiveRows) {
          const symbol = row.tradingsymbol.toUpperCase()
          const prices = t0PricesBySymbol.get(symbol) || []
          prices.push(row.average_price)
          t0PricesBySymbol.set(symbol, prices)
        }

        const dedupedHoldings = enrichedHoldings.filter(h => {
          const prices = t0PricesBySymbol.get(h.tradingsymbol.toUpperCase())
          if (!prices || prices.length === 0) return true
          return !prices.some(price => Math.abs(price - h.average_price) <= 0.01)
        })

        const positionEntryPriceBySymbol = new Map<string, number>()
        for (const p of Array.isArray(sRes?.positions) ? (sRes.positions as any[]) : []) {
          if (typeof p.symbol === 'string' && typeof p.firstBuyPrice === 'number' && p.firstBuyPrice > 0) {
            positionEntryPriceBySymbol.set(p.symbol.toUpperCase(), p.firstBuyPrice)
          }
        }
        // Map symbol -> lots from the unified positions store. Use these when
        // Kite's holdings endpoint doesn't include per-lot details (common).
        const positionLotsBySymbol = new Map<string, Array<any>>()
        for (const p of Array.isArray(sRes?.positions) ? (sRes.positions as any[]) : []) {
          if (typeof p.symbol === 'string' && Array.isArray(p.lots) && p.lots.length > 0) {
            positionLotsBySymbol.set(p.symbol.toUpperCase(), p.lots)
          }
        }

        const holdingsWithEntry = dedupedHoldings.map(item => ({
          ...item,
          source: 'holding' as const,
          displayEntryPrice: positionEntryPriceBySymbol.get(item.tradingsymbol.toUpperCase()) ?? item.average_price,
        }))

        const t0Holdings: Holding[] = t0Rows.map(r => {
          const symbolKey = r.tradingsymbol.toUpperCase()
          // Try to attribute a per-lot strategy for T0 rows by matching the
          // row's avg price to a lot in the unified positions store. This
          // ensures closed/sold T0 rows that came from a `catalyst` lot keep
          // their original strategy tag instead of inheriting the parent's.
          // Skip entirely when the backend already reconciled this row against
          // the journal — matching by price is a heuristic that breaks for
          // multi-lot symbols (it can land on a still-open, unrelated lot),
          // and the journal already knows the exact strategy that made the sale.
          const storeLots = r.journalReconciled ? [] : (positionLotsBySymbol.get(symbolKey) || [])
          const activeStoreLots = storeLots.filter((lot: any) => (lot.remainingQty || 0) > 0)
          // Match the visible T0 row to a concrete lot so the UI can always do
          // lot-level strategy switching. Prefer exact qty+price, then price-only,
          // then single-active-lot fallback.
          const matchedLot =
            activeStoreLots.find((lot: any) => Math.abs((lot.entryPrice || 0) - (r.average_price || 0)) <= 0.01 && (lot.remainingQty || 0) === totalQty(r)) ||
            activeStoreLots.find((lot: any) => Math.abs((lot.entryPrice || 0) - (r.average_price || 0)) <= 0.01) ||
            (activeStoreLots.length === 1 ? activeStoreLots[0] : undefined)
          const t0StrategyId = (matchedLot && matchedLot.strategyId) || (r as any).strategyId || (r as any).t0StrategyId
          return {
            ...r,
            source: 't0',
            displayEntryPrice: r.journalReconciled ? r.average_price : (positionEntryPriceBySymbol.get(r.tradingsymbol.toUpperCase()) ?? r.average_price),
            t0StrategyId,
            lotId: matchedLot?.id,
            lots: matchedLot ? [matchedLot] : r.lots,
          }
        })

  const flattenedHoldings = [
          ...holdingsWithEntry,
          ...t0Holdings,
        ].flatMap(h => {
          const symbolKey = (h.tradingsymbol || '').toUpperCase()
          // Gather lots from the row itself. Only fallback to the unified
          // positions store for settled holdings rows, because T0 rows are
          // already the live same-day snapshot and must not be expanded into
          // duplicate per-lot rows twice.
          let activeLots = (h.lots || []).filter((lot: any) => (lot.remainingQty || 0) > 0)
          if (activeLots.length === 0 && h.source === 'holding') {
            const storeLots = positionLotsBySymbol.get(symbolKey) || []
            activeLots = (storeLots || []).filter((lot: any) => (lot.remainingQty || 0) > 0)
          }

          if (activeLots.length === 0) {
            const storeLots = positionLotsBySymbol.get(symbolKey) || []
            const singleActiveLot = storeLots.filter((lot: any) => (lot.remainingQty || 0) > 0)
            if (singleActiveLot.length === 1) {
              return [{
                ...h,
                lotId: singleActiveLot[0].id,
                lots: [singleActiveLot[0]],
                isPartialLot: typeof singleActiveLot[0].originalQty === 'number' && singleActiveLot[0].remainingQty < singleActiveLot[0].originalQty,
              }]
            }
            return [h]
          }

          return activeLots.map((lot: any) => ({
            ...h,
            quantity: lot.remainingQty || 0,
            average_price: lot.entryPrice,
            displayEntryPrice: lot.entryPrice,
            pnl: (lot.remainingQty || 0) * ((h.last_price || 0) - lot.entryPrice),
            lotId: lot.id,
            lots: [lot],
            isPartialLot: typeof lot.originalQty === 'number' && lot.remainingQty < lot.originalQty,
          }))
        })

        // Final guard: the same physical lot can arrive from both sources
        // (holdings + T0 positions). Keep exactly one row per lot record.
        const byLotKey = new Map<string, Holding>()
        for (const row of flattenedHoldings) {
          const symbol = (row.tradingsymbol || '').toUpperCase()
          const price = Math.round((row.displayEntryPrice ?? row.average_price || 0) * 100)
          const key = row.lotId
            ? `${symbol}:LOT:${row.lotId}`
            : `${symbol}:NOLOT:${row.product}:${totalQty(row)}:${price}`
          const existing = byLotKey.get(key)
          if (!existing) {
            byLotKey.set(key, row)
            continue
          }
          // Prefer T0-flavoured rows when both represent the same lot.
          if (existing.source !== 't0' && row.source === 't0') {
            byLotKey.set(key, row)
          }
        }

        setHoldings(Array.from(byLotKey.values()).sort((left, right) => {
          if (left.tradingsymbol !== right.tradingsymbol) return left.tradingsymbol.localeCompare(right.tradingsymbol)
          return (left.lotId || '').localeCompare(right.lotId || '')
        }))
      }
      // Strategy tag map — single source of truth is the positions store.
      // All rows (settled holdings AND same-day T0 positions) use the same map
      // so every page shows the same strategy for the same symbol consistently.
      const tagMap = new Map<string, { strategyId: string; strategyName: string; strategyColor: string; strategyType?: string; remainingQty?: number }>()
      for (const p of (sRes?.positions || []) as any[]) {
        const key = `${String(p.account).toUpperCase()}:${String(p.symbol).toUpperCase()}`
        const existing = tagMap.get(key)
        // Prefer active positions (remainingQty > 0) over journal fallback entries (remainingQty = 0)
        if (existing && existing.remainingQty !== undefined && p.remainingQty !== undefined && 
            existing.remainingQty > 0 && p.remainingQty === 0) {
          continue  // skip journal fallback if we already have an active position
        }
        tagMap.set(key, {
          strategyId: p.strategyId,
          strategyName: p.strategyName,
          strategyColor: p.strategyColor,
          strategyType: p.strategyType,
          remainingQty: p.remainingQty,
        })
      }
      setPosTags(tagMap)
      setLastRefreshedAt(new Date().toISOString())
    } catch {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab) load(activeTab)
  }, [activeTab])

  const activeAccount = accounts.find(a => a.name === activeTab)
  const availableCash = margins?.equity?.available?.live_balance ?? margins?.equity?.available?.cash ?? null
  const usedMargin = margins?.equity?.utilised?.debits ?? null
  const netEquity = margins?.equity?.net ?? null

  const totals = holdings.filter(h => totalQty(h) > 0).reduce(
    (acc, h) => {
      const q = totalQty(h)
      acc.invested += h.average_price * q
      acc.current  += h.last_price * q
      acc.pnl      += h.pnl
      acc.dayPnl   += h.day_change * q
      return acc
    },
    { invested: 0, current: 0, pnl: 0, dayPnl: 0 }
  )

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light dt-text-primary" style={{ fontFamily:'Cormorant Garamond, serif' }}>
          Current <span className="accent-text">Holdings</span>
        </h1>
        {activeTab && (
          <div className="flex items-end gap-3 flex-wrap justify-end">
            {lastRefreshedAt && (
              <div className="text-right">
                <p className="text-[9px] tracking-widest uppercase dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                  Last Refreshed
                </p>
                <p className="text-[11px] dt-text-secondary" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                  {formatTimestamp(lastRefreshedAt)}
                </p>
              </div>
            )}
            <button onClick={() => load(activeTab)} disabled={loading}
              className="px-4 py-2 rounded-lg text-[11px] font-medium transition-all"
              style={{ background:'rgba(93,169,255,0.12)', border:'1px solid rgba(93,169,255,0.3)', color:'#7fd1ff' }}>
              {loading ? '↻ Loading…' : '↻ Refresh'}
            </button>
          </div>
        )}
      </div>

      <AccountTabs accounts={accounts} connected={connected} active={activeTab} onSelect={setActiveTab} loaded={loaded} />

      {loaded && connected.length === 0 && <NoneConnectedHint />}

      {activeTab && (
        <>
          {/* AVAILABLE FUNDS — first line per spec */}
          <div className="rounded-xl p-5"
            style={{
              background: activeAccount ? `${activeAccount.color}08` : 'rgba(201,168,76,0.05)',
              border: `1px solid ${activeAccount ? activeAccount.color + '33' : 'rgba(201,168,76,0.15)'}`,
            }}>
            <p className="text-[10px] tracking-widest uppercase mb-2"
              style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
              Available Funds
            </p>
            <p className="text-3xl font-light"
              style={{ color: activeAccount?.color || '#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              {availableCash !== null ? `₹${Math.round(availableCash).toLocaleString('en-IN')}` : (loading ? '…' : '—')}
            </p>
            <div className="grid grid-cols-2 gap-4 mt-3 text-[11px]" style={{ fontFamily:'JetBrains Mono, monospace' }}>
              <div>
                <span style={{ color:'rgba(255,255,255,0.3)' }}>Used Margin: </span>
                <span style={{ color:'rgba(255,255,255,0.6)' }}>{usedMargin !== null ? `₹${Math.round(usedMargin).toLocaleString('en-IN')}` : '—'}</span>
              </div>
              <div>
                <span style={{ color:'rgba(255,255,255,0.3)' }}>Net Equity: </span>
                <span style={{ color:'rgba(255,255,255,0.6)' }}>{netEquity !== null ? `₹${Math.round(netEquity).toLocaleString('en-IN')}` : '—'}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-xl p-4 dt-banner-error">
              <p className="text-sm" style={{ color:'rgba(224,90,94,0.85)' }}>✗ {error}</p>
            </div>
          )}

          {/* Holdings totals row */}
          {holdings.length > 0 && (() => {
            // % vs Invested for each P&L hero. Current's % is the same as Overall (capital appreciation).
            const inv = totals.invested
            const overallPct = inv > 0 ? (totals.pnl / inv) * 100 : null
            const dayPct     = inv > 0 ? (totals.dayPnl / inv) * 100 : null
            const currentPct = inv > 0 ? ((totals.current - inv) / inv) * 100 : null
            return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Invested',    val:`₹${Math.round(totals.invested).toLocaleString('en-IN')}`, sub: undefined,         color:'rgba(255,255,255,0.7)' },
                { label:'Current',     val:`₹${Math.round(totals.current).toLocaleString('en-IN')}`,  sub: fmtSignedPct(currentPct), subColor: currentPct !== null && currentPct >= 0 ? '#52b788' : '#e05a5e', color:'#c9a84c' },
                { label:'Overall P&L', val: fmtPnl(totals.pnl),    sub: fmtSignedPct(overallPct), color: totals.pnl >= 0 ? '#52b788' : '#e05a5e' },
                { label:"Today's P&L", val: fmtPnl(totals.dayPnl), sub: fmtSignedPct(dayPct),     color: totals.dayPnl >= 0 ? '#52b788' : '#e05a5e' },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-4 dt-card">
                  <p className="text-[9px] tracking-widest uppercase mb-2 dt-text-muted" style={{ fontFamily:'JetBrains Mono, monospace' }}>{s.label}</p>
                  <p className="text-lg font-semibold" style={{ color:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.val}</p>
                  {s.sub && <p className="text-[11px] mt-1" style={{ color: (s as any).subColor ?? s.color, opacity: 0.7, fontFamily:'JetBrains Mono, monospace' }}>{s.sub}</p>}
                </div>
              ))}
            </div>
            )
          })()}

          {/* Holdings list — mobile: two-column card; desktop: table (matches Today's Positions) */}
          {holdings.length > 0 && (
            <div className="rounded-xl overflow-hidden dt-border-b">
              {/* Desktop header */}
              <div className="hidden sm:grid grid-cols-12 px-4 py-2.5 text-[9px] tracking-widest uppercase dt-table-head"
                style={{ fontFamily:'JetBrains Mono, monospace' }}>
                <span className="col-span-3">Symbol</span>
                <span className="col-span-1 text-right">Qty</span>
                <span className="col-span-2 text-right">Entry</span>
                <span className="col-span-2 text-right">LTP</span>
                <span className="col-span-2 text-right">P&L</span>
                <span className="col-span-2 text-right">Action</span>
              </div>

              {holdings.map((h, i) => {
                const isT0Position = h.source === 't0'
                const symbolKey = h.tradingsymbol.toUpperCase()
                // Positions store is the single source of truth for strategy tags.
                // Both settled holdings and T0 same-day positions use the same lookup
                // so strategy attribution is consistent across all pages.
                const baseTag = posTags.get(`${(activeTab || '').toUpperCase()}:${symbolKey}`)
                const lotStrategyId = h.lots?.[0]?.strategyId || h.t0StrategyId || ([...(h.lots || [])].sort((a, b) => b.boughtAt.localeCompare(a.boughtAt))[0]?.strategyId)
                // Mixed-lot symbols may render individual lot rows from either the
                // settled holdings side or the same-day positions side. Prefer the
                // lot's own strategy when present so the badge/select action updates
                // that specific lot rather than the symbol-level fallback.
                let tag = baseTag
                if (lotStrategyId && lotStrategyId !== baseTag?.strategyId) {
                  const s = strategyById.get(lotStrategyId)
                  tag = {
                    strategyId: lotStrategyId,
                    strategyName: s?.name || lotStrategyId,
                    strategyColor: s?.color || baseTag?.strategyColor || '#c9a84c',
                    strategyType: s?.type || baseTag?.strategyType,
                    remainingQty: baseTag?.remainingQty,
                  }
                }
                const isManaged = !!tag
                const switchLotId = h.lotId || h.lots?.[0]?.id
                const hasAlternateActiveStrategy = isManaged && activeStrategies.some(strategy => strategy.id !== tag!.strategyId)
                const canSwitchStrategy = isManaged && !!switchLotId
                const badgeLabel = isManaged ? tag!.strategyName.toUpperCase().slice(0, 14) : 'OOS'
                const badgeColor = isManaged ? tag!.strategyColor : 'rgba(255,255,255,0.4)'
                const badgeTitle = isManaged
                  ? canSwitchStrategy
                    ? hasAlternateActiveStrategy
                      ? `${tag!.strategyName} managed — click to switch the active strategy for this holding.`
                      : `${tag!.strategyName} managed — no alternate active strategy available right now.`
                    : `${tag!.strategyName} managed — lot id missing for this row.`
                  : 'Out of System — not auto-managed. Bought outside DineshTrade, or transitioned-out. Manual Sell still works.'
                const pnlColor = h.pnl >= 0 ? '#52b788' : '#e05a5e'
                const dayColor = h.day_change_percentage >= 0 ? '#52b788' : '#e05a5e'
                const isT1Only = (h.t1_quantity || 0) > 0 && (h.quantity || 0) === 0
                const qty = totalQty(h)
                const isShortPosition = qty < 0
                const actionQty = Math.abs(qty)
                const pnlPct = h.displayEntryPrice && h.displayEntryPrice > 0 ? ((h.last_price - h.displayEntryPrice) / h.displayEntryPrice) * 100 : 0
                const displayEntryPrice = h.displayEntryPrice ?? h.average_price

                const badgeStyle = {
                  background: isManaged ? `${badgeColor}26` : 'rgba(255,255,255,0.05)',
                  color: badgeColor,
                  border: `1px solid ${isManaged ? `${badgeColor}59` : 'rgba(255,255,255,0.1)'}`,
                }
                const Badge = canSwitchStrategy ? (
                  <button type="button" title={badgeTitle}
                    onClick={() => openStrategySwitch(h.tradingsymbol, tag!.strategyId, tag!.strategyName, switchLotId)}
                    className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 tracking-wider underline-offset-2 hover:underline"
                    style={badgeStyle}>
                    {badgeLabel}
                  </button>
                ) : (
                  <span title={badgeTitle}
                    className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 tracking-wider"
                    style={badgeStyle}>
                    {badgeLabel}
                  </span>
                )

                const BuyBtn = (
                  <button onClick={() => setOrderModal({ open: true, symbol: h.tradingsymbol, side: 'BUY', ltp: h.last_price, initialQty: isShortPosition ? actionQty : undefined, dayChangePct: h.day_change_percentage })}
                    disabled={!market.open} title={!market.open ? 'Market closed' : undefined}
                    className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ background:'rgba(82,183,136,0.12)', border:'1px solid rgba(82,183,136,0.3)', color:'#52b788', fontFamily:'JetBrains Mono, monospace' }}>
                    {isShortPosition ? 'Cover' : 'B'}
                  </button>
                )
                const SellBtn = isShortPosition ? null : (
                  <button onClick={() => setOrderModal({ open: true, symbol: h.tradingsymbol, side: 'SELL', ltp: h.last_price, initialQty: qty, dayChangePct: h.day_change_percentage })}
                    disabled={!market.open || actionQty === 0} title={!market.open ? 'Market closed' : actionQty === 0 ? 'No shares to sell' : undefined}
                    className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ background:'rgba(224,90,94,0.12)', border:'1px solid rgba(224,90,94,0.3)', color:'#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                    S
                  </button>
                )
                return (
                  <div key={`${h.tradingsymbol}-${h.lotId || i}`} className={`px-4 py-3 transition-all hover:bg-white/5 text-[12px]${i < holdings.length - 1 ? ' dt-table-row' : ''}`}>

                    {/* ── Mobile: two-column card (hidden on sm+) ── */}
                    <div className="sm:hidden flex items-start justify-between gap-3">
                      {/* Left: symbol + badge, avg, qty */}
                      <div className="min-w-0 flex flex-col gap-1" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[16px] font-semibold dt-text-primary">{h.tradingsymbol}</span>
                          {isT0Position && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded tracking-wider"
                              style={{ background:'rgba(56,189,248,0.12)', color:'rgba(56,189,248,0.82)', border:'1px solid rgba(56,189,248,0.28)' }}>{isShortPosition ? 'T0 SHORT' : 'T0'}</span>
                          )}
                          {isT1Only && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded tracking-wider"
                              style={{ background:'rgba(96,165,250,0.12)', color:'rgba(96,165,250,0.8)', border:'1px solid rgba(96,165,250,0.25)' }}>T1</span>
                          )}
                          {h.isPartialLot && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded tracking-wider"
                              style={{ background:'rgba(249,115,22,0.12)', color:'rgba(249,115,22,0.88)', border:'1px solid rgba(249,115,22,0.25)' }}>P</span>
                          )}
                          {Badge}
                        </div>
                        <div className="text-[11px] dt-text-muted">
                          Entry <span style={{ color:'rgba(255,255,255,0.75)' }}>₹{displayEntryPrice.toFixed(2)}</span>
                        </div>
                        <div className="text-[11px] dt-text-muted">
                          Qty <span style={{ color:'rgba(255,255,255,0.75)' }}>{qty}</span>
                        </div>
                      </div>

                      {/* Right: P&L (₹ + %), LTP (+ day%), buttons */}
                      <div className="shrink-0 flex flex-col items-end gap-1" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                        <div className="text-right">
                          <div className="text-[15px] font-semibold whitespace-nowrap" style={{ color: pnlColor }}>{fmtPnl(h.pnl)}</div>
                          <div className="text-[10px] whitespace-nowrap" style={{ color: pnlColor, opacity:0.8 }}>
                            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                          </div>
                        </div>
                        <div className="text-[11px] whitespace-nowrap dt-text-muted">
                          LTP <span className="dt-text-primary">₹{h.last_price.toFixed(2)}</span>
                          <span className="ml-1.5" style={{ color: dayColor }}>{Math.abs(h.day_change_percentage).toFixed(2)}%</span>
                        </div>
                        <div className="flex gap-1.5 pt-0.5">{BuyBtn}{SellBtn}</div>
                      </div>
                    </div>

                    {/* ── Desktop: 12-col grid (matches Positions page) ── */}
                    <div className="hidden sm:grid grid-cols-12 items-center">
                      <div className="col-span-3 flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white/85" style={{ fontFamily:'JetBrains Mono, monospace' }}>{h.tradingsymbol}</span>
                        {isT0Position && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded tracking-wider"
                            style={{ background:'rgba(56,189,248,0.12)', color:'rgba(56,189,248,0.82)', border:'1px solid rgba(56,189,248,0.28)', fontFamily:'JetBrains Mono, monospace' }}>{isShortPosition ? 'T0 SHORT' : 'T0'}</span>
                        )}
                        {isT1Only && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded tracking-wider"
                            style={{ background:'rgba(96,165,250,0.12)', color:'rgba(96,165,250,0.8)', border:'1px solid rgba(96,165,250,0.25)', fontFamily:'JetBrains Mono, monospace' }}>T1</span>
                        )}
                        {h.isPartialLot && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded tracking-wider"
                            style={{ background:'rgba(249,115,22,0.12)', color:'rgba(249,115,22,0.88)', border:'1px solid rgba(249,115,22,0.25)', fontFamily:'JetBrains Mono, monospace' }}>P</span>
                        )}
                        {Badge}
                      </div>
                      <span className="col-span-1 text-right text-white/70" style={{ fontFamily:'JetBrains Mono, monospace' }}>{qty}</span>
                      <div className="col-span-2 text-right">
                        <div style={{ fontFamily:'JetBrains Mono, monospace', color:'rgba(255,255,255,0.6)' }}>₹{displayEntryPrice.toFixed(2)}</div>
                      </div>
                      <div className="col-span-2 text-right" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                        <div className="dt-text-primary">₹{h.last_price.toFixed(2)}</div>
                        <div className="text-[9px] mt-0.5" style={{ color: dayColor }}>{h.day_change_percentage >= 0 ? '▲' : '▼'} {Math.abs(h.day_change_percentage).toFixed(2)}%</div>
                      </div>
                      <div className="col-span-2 text-right" style={{ fontFamily:'JetBrains Mono, monospace' }}>
                        <div className="font-semibold" style={{ color: pnlColor }}>{fmtPnl(h.pnl)}</div>
                        <div className="text-[9px] mt-0.5" style={{ color: pnlColor, opacity:0.8 }}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</div>
                      </div>
                      <div className="col-span-2 flex gap-1.5 justify-end">{BuyBtn}{SellBtn}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!loading && !error && holdings.length === 0 && availableCash !== null && (
            <div className="text-center py-12">
              <p className="text-4xl mb-3 opacity-20">◎</p>
              <p className="text-base dt-text-muted" style={{ fontFamily:'Cormorant Garamond, serif', fontSize:'18px' }}>No holdings in this account</p>
            </div>
          )}
        </>
      )}

      <OrderModal
        isOpen={orderModal.open}
        onClose={() => setOrderModal({ ...orderModal, open: false })}
        symbol={orderModal.symbol}
        symbolName={orderModal.name}
        initialSide={orderModal.side}
        ltp={orderModal.ltp}
        dayChangePct={orderModal.dayChangePct}
        initialQty={orderModal.initialQty}
        accounts={accounts.filter(a => connected.includes(a.name))}
        defaultAccount={activeTab ?? undefined}
        onSuccess={() => {
          // Refresh funds + holdings after a successful order
          if (activeTab) load(activeTab)
        }} />

      {switchModal.open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" style={{ background:'rgba(0,0,0,0.72)', backdropFilter:'blur(4px)' }}>
          <div className="w-full max-w-md rounded-xl p-5 dt-card-inner" style={{ border:'1px solid rgba(201,168,76,0.24)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>Switch Strategy</p>
                <p className="mt-2 text-[18px] dt-text-primary" style={{ fontFamily:'Cormorant Garamond, serif' }}>{switchModal.symbol}</p>
                <p className="text-[11px] dt-text-muted mt-1">Current owner: {switchModal.currentStrategyName}</p>
              </div>
              <button type="button" onClick={closeSwitchModal} disabled={switchModal.busy}
                className="text-white/40 hover:text-white/80">✕</button>
            </div>

            <p className="mt-4 text-[11px] dt-text-muted">
              The new strategy will inherit the existing entry price, age, and lot state. If its exit rules are already met, it may sell on the next monitor tick.
            </p>

            <div className="mt-4 space-y-2">
              {activeStrategies.filter(strategy => strategy.id !== switchModal.currentStrategyId).map(strategy => {
                const selected = switchModal.selectedStrategyId === strategy.id
                return (
                  <button key={strategy.id} type="button"
                    onClick={() => setSwitchModal(current => ({ ...current, selectedStrategyId: strategy.id, error: '' }))}
                    className="w-full rounded-lg px-3 py-2 text-left transition-all"
                    style={{
                      background: selected ? `${strategy.color}18` : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${selected ? `${strategy.color}55` : 'rgba(255,255,255,0.08)'}`,
                    }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[12px]" style={{ color: selected ? strategy.color : 'rgba(255,255,255,0.86)', fontFamily:'JetBrains Mono, monospace' }}>{strategy.name}</div>
                        <div className="text-[10px] uppercase tracking-widest" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono, monospace' }}>{strategy.type}</div>
                      </div>
                      <div className="w-3 h-3 rounded-full" style={{ background: strategy.color, boxShadow: selected ? `0 0 0 3px ${strategy.color}22` : 'none' }} />
                    </div>
                  </button>
                )
              })}
            </div>

            {switchModal.error && <p className="mt-3 text-[11px]" style={{ color:'#e05a5e' }}>{switchModal.error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeSwitchModal} disabled={switchModal.busy}
                className="px-3 py-1.5 rounded-md text-[11px] dt-card dt-text-secondary">
                Cancel
              </button>
              <button type="button" onClick={confirmStrategySwitch}
                disabled={!switchModal.selectedStrategyId || switchModal.busy}
                className="px-4 py-1.5 rounded-md text-[11px] font-semibold tracking-wider disabled:opacity-40"
                style={{ background:'linear-gradient(135deg, #8a6a1a, #c9a84c)', color:'#080604' }}>
                {switchModal.busy ? 'Switching…' : 'Switch Strategy'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function fmtSignedPct(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return ''
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
}


function formatTimestamp(value: string): string {
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: 'short',
  })
}
function fmtPnl(v: number): string {
  const abs = Math.round(Math.abs(v)).toLocaleString('en-IN')
  return v >= 0 ? `+₹${abs}` : `-₹${abs}`
}

function AccountTabs({ accounts, connected, active, onSelect, loaded }: {
  accounts: AccountDisplay[]
  connected: string[]
  active: string | null
  onSelect: (n: string) => void
  loaded: boolean
}) {
  if (!loaded) return <p className="text-[11px] dt-text-muted">Loading accounts…</p>
  const connectedAccounts = accounts.filter(a => connected.includes(a.name))
  if (connectedAccounts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {connectedAccounts.map(acc => {
        const isActive = active === acc.name
        return (
          <button key={acc.name} onClick={() => onSelect(acc.name)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] transition-all"
            style={{
              background: isActive ? `${acc.color}15` : 'rgba(255,255,255,0.02)',
              border: `1px solid ${isActive ? acc.color + '55' : 'rgba(255,255,255,0.08)'}`,
              color: isActive ? acc.color : 'rgba(255,255,255,0.5)',
            }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background:`${acc.color}20`, color:acc.color, border:`1px solid ${acc.color}40` }}>
              {acc.initials}
            </span>
            <span style={{ fontWeight: isActive ? 500 : 400 }}>{acc.displayName}</span>
          </button>
        )
      })}
    </div>
  )
}

function NoneConnectedHint() {
  return (
    <div className="rounded-xl p-6 text-center dt-banner-accent">
      <p className="text-4xl mb-3 opacity-20">⚙</p>
      <p className="text-sm mb-1" style={{ color:'rgba(201,168,76,0.7)' }}>No accounts connected</p>
      <p className="text-[12px] dt-text-muted">Go to Settings, paste today's Kite access token, and Connect.</p>
    </div>
  )
}
