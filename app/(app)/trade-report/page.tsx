'use client'

import { useEffect, useState } from 'react'
import type { StrategyBacktestResult } from '@/lib/backtest'

interface AccountDisplay {
  name: string
  displayName: string
}

interface StrategyOption {
  id: string
  name: string
}

function shiftDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function TradeReportPage() {
  const [fromDate, setFromDate] = useState(() => shiftDays(-30))
  const [toDate, setToDate] = useState(() => shiftDays(0))
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [strategies, setStrategies] = useState<StrategyOption[]>([])
  const [accountFilter, setAccountFilter] = useState('')
  const [strategyFilter, setStrategyFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [result, setResult] = useState<StrategyBacktestResult | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()).catch(() => ({ accounts: [] })),
      fetch('/api/strategies').then(r => r.json()).catch(() => ({ strategies: [] })),
    ]).then(([accountsData, strategiesData]) => {
      setAccounts(Array.isArray(accountsData.accounts) ? accountsData.accounts : [])
      const nextStrategies = Array.isArray(strategiesData.strategies)
        ? (strategiesData.strategies as StrategyOption[]).map(strategy => ({ id: strategy.id, name: strategy.name }))
        : []
      setStrategies(nextStrategies)
    }).catch(() => {})

    runReport(fromDate, toDate, accountFilter, strategyFilter)
  }, [])

  async function runReport(nextFrom = fromDate, nextTo = toDate, nextAccount = accountFilter, nextStrategy = strategyFilter) {
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch('/api/trade-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromDate: nextFrom, toDate: nextTo, account: nextAccount, strategyId: nextStrategy }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult(null)
        setError(data.error || `Trade report failed (HTTP ${res.status})`)
        return
      }
      setResult(data.result || null)
      const filters = [
        nextAccount ? `Account: ${nextAccount}` : 'All accounts',
        nextStrategy ? `Strategy: ${nextStrategy === 'manual' ? 'Manual' : (strategies.find(strategy => strategy.id === nextStrategy)?.name || nextStrategy)}` : 'All strategies',
      ]
      setInfo(`Loaded real trades from ${nextFrom} to ${nextTo} · ${filters.join(' · ')}`)
    } catch {
      setResult(null)
      setError('Network error while loading trade report')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  return (
    <div className="space-y-5 pb-4 max-w-7xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          <span className="gold-text">Trade Report</span>
        </h1>
      </div>

      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[11px] tracking-widest uppercase mb-2" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
              Real Trade History
            </h2>
            <p className="text-[12px] max-w-3xl" style={{ color:'rgba(255,255,255,0.45)' }}>
              Pick a date range and replay the actual journaled BUY and SELL legs into the same trade-report format as the backtest screen. Summary values use total entry notional for the included rows, while open trades are marked at the selected To date.
            </p>
          </div>
          <button onClick={() => runReport()} disabled={loading || !fromDate || !toDate}
            className="px-5 py-2.5 rounded-xl text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
            style={{ background:'linear-gradient(135deg, #7a5510, #c9a84c)', color:'#080604' }}>
            {loading ? 'Loading…' : 'Run Report'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-5">
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={e => {
                setFromDate(e.target.value)
                setResult(null)
                setError('')
                setInfo('')
              }}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={e => {
                setToDate(e.target.value)
                setResult(null)
                setError('')
                setInfo('')
              }}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              Account
            </label>
            <select
              value={accountFilter}
              onChange={e => {
                setAccountFilter(e.target.value)
                setResult(null)
                setError('')
                setInfo('')
              }}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              <option value="">All accounts</option>
              {accounts.map(account => (
                <option key={account.name} value={account.name}>{account.displayName || account.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color:'rgba(201,168,76,0.55)', fontFamily:'JetBrains Mono, monospace' }}>
              Strategy
            </label>
            <select
              value={strategyFilter}
              onChange={e => {
                setStrategyFilter(e.target.value)
                setResult(null)
                setError('')
                setInfo('')
              }}
              className="w-full px-3 py-2.5 rounded-lg text-[12px] outline-none"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              <option value="">All strategies</option>
              <option value="manual">Manual</option>
              {strategies.map(strategy => (
                <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
          <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.32)' }}>
            Manual and auto trades are both included when their journaled activity falls inside the selected range. Carry-in positions from before the From date stay linked correctly when they partially or fully exit inside the window.
          </p>
        </div>
      </div>

      {!loaded && <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.4)' }}>Loading…</p>}

      {info && (
        <div className="rounded-lg p-3" style={{ background:'rgba(82,183,136,0.06)', border:'1px solid rgba(82,183,136,0.3)' }}>
          <p className="text-[12px]" style={{ color:'#52b788' }}>✓ {info}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg p-3" style={{ background:'rgba(224,90,94,0.06)', border:'1px solid rgba(224,90,94,0.25)' }}>
          <p className="text-[12px]" style={{ color:'rgba(224,90,94,0.9)' }}>✗ {error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-5">
          <div className="rounded-xl overflow-hidden" style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.2)' }}>
            <div className="px-4 py-2.5" style={{ borderBottom:'1px solid rgba(201,168,76,0.12)' }}>
              <p className="text-[11px] tracking-widest uppercase" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                Summary · {result.summary.strategyName}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background:'rgba(255,255,255,0.04)' }}>
              <Stat label="Total P&L (MTM)" value={formatSignedCurrency(result.summary.totalPnl)} color={result.summary.totalPnl >= 0 ? '#52b788' : '#e05a5e'} />
              <Stat label="Net P&L (MTM)" value={formatSignedCurrency(result.summary.netTotalPnl ?? result.summary.totalPnl)} color={(result.summary.netTotalPnl ?? result.summary.totalPnl) >= 0 ? '#52b788' : '#e05a5e'} />
              <Stat label="Return (MTM)" value={formatSignedPct(result.summary.totalReturnPct)} color={result.summary.totalReturnPct >= 0 ? '#52b788' : '#e05a5e'} />
              <Stat label="Net Return (MTM)" value={formatSignedPct(result.summary.netTotalReturnPct ?? result.summary.totalReturnPct)} color={(result.summary.netTotalReturnPct ?? result.summary.totalReturnPct) >= 0 ? '#52b788' : '#e05a5e'} />
              <Stat label="Win Rate" value={result.summary.winRate === null ? '—' : `${result.summary.winRate.toFixed(2)}%`} color="#c9a84c" />
              <Stat label="Max Drawdown" value={`${result.summary.maxDrawdownPct.toFixed(2)}%`} color="rgba(224,90,94,0.85)" />
              <Stat label="Starting Capital" value={formatCurrency(result.summary.startingCapital)} color="rgba(255,255,255,0.7)" />
              <Stat label="Ending Equity" value={formatCurrency(result.summary.endingCapital)} color="rgba(255,255,255,0.9)" />
              <Stat label="Trades Closed" value={String(result.summary.tradesClosed)} color="rgba(255,255,255,0.7)" />
              <Stat label="Trades Open" value={String(result.summary.tradesOpen)} color="rgba(255,255,255,0.7)" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
              <MiniMetric label="Trading Days" value={String(result.summary.tradingDays)} />
              <MiniMetric label="Dip Days" value={String(result.summary.dipDays)} />
              <MiniMetric label="Momentum Days" value={String(result.summary.momentumDays)} />
              <MiniMetric label="Wins / Losses" value={`${result.summary.wins} / ${result.summary.losses}`} />
              <MiniMetric label="Avg Hold" value={result.summary.avgHoldDays === null ? '—' : `${result.summary.avgHoldDays.toFixed(1)} d`} />
              <MiniMetric
                label="Realized P&L"
                value={`${formatSignedCurrency(result.summary.realizedPnl)} · ${formatSignedPct(result.summary.startingCapital > 0 ? (result.summary.realizedPnl / result.summary.startingCapital) * 100 : 0)}`}
                valueColor={result.summary.realizedPnl >= 0 ? '#52b788' : '#e05a5e'}
              />
              <MiniMetric
                label="Net Realized P&L"
                value={`${formatSignedCurrency(result.summary.netRealizedPnl ?? result.summary.realizedPnl)} · ${formatSignedPct(result.summary.startingCapital > 0 ? ((result.summary.netRealizedPnl ?? result.summary.realizedPnl) / result.summary.startingCapital) * 100 : 0)}`}
                valueColor={(result.summary.netRealizedPnl ?? result.summary.realizedPnl) >= 0 ? '#52b788' : '#e05a5e'}
              />
              <MiniMetric
                label="Unrealized MTM"
                value={`${formatSignedCurrency(result.summary.unrealizedPnl)} · ${formatSignedPct(result.summary.startingCapital > 0 ? (result.summary.unrealizedPnl / result.summary.startingCapital) * 100 : 0)}`}
                valueColor={result.summary.unrealizedPnl >= 0 ? '#52b788' : '#e05a5e'}
              />
              <MiniMetric label="Estimated Charges" value={formatCurrency(result.summary.totalCharges || 0)} valueColor="#c9a84c" />
              <MiniMetric label="Skipped No Token" value={String(result.summary.skippedNoToken)} />
              <MiniMetric label="Skipped No Historical" value={String(result.summary.skippedNoHistorical)} />
              <MiniMetric label="Skipped Capital" value={String(result.summary.skippedCapitalLimited)} />
              <MiniMetric label="Skipped Position" value={String(result.summary.skippedPositionLimited)} />
            </div>
            {result.summary.tradesOpen > 0 && (
              <div className="px-4 pb-4">
                <div className="rounded-lg p-3" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.45)' }}>
                    MTM includes positions still open at the selected To date. Those rows use the end-of-range mark price, while realized sells remain broken out separately above.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
            <div className="px-4 py-2.5 flex items-center justify-between gap-3" style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                Trades ({result.trades.length})
              </p>
              <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>
                Real journal activity in the same row format as the backtest view.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1380px]">
                <thead>
                  <tr style={{ background:'rgba(255,255,255,0.02)' }}>
                    {['Symbol', 'Strategy', 'Signal', 'Entry Price', 'T1 Date', 'T2 Date', 'Exit Price / Mark Price', 'Qty / Remaining', 'Status', 'Gross Profit', 'Brokerage', 'Net Profit', 'Hold', 'Reason'].map(h => (
                      <th key={h} className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((trade, index) => {
                    const grossPnl = trade.realizedPnl
                    const brokerage = trade.incurredCharges ?? trade.charges ?? 0
                    const netPnl = trade.netRealizedPnl ?? grossPnl
                    const displayStatus = trade.status === 'closed' ? 'closed' : trade.t1Date ? 'partial' : 'open'
                    const realizedPct = trade.entryValue > 0 ? (trade.realizedPnl / trade.entryValue) * 100 : 0
                    const netRealizedPct = trade.entryValue > 0 ? ((trade.netRealizedPnl ?? trade.realizedPnl) / trade.entryValue) * 100 : 0
                    return (
                      <tr key={`${trade.symbol}-${trade.entryDate}-${index}`} style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium" style={{ color:'rgba(255,255,255,0.85)' }}>{trade.symbol}</span>
                            <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded"
                              style={{ background: trade.confidence === 'high' ? 'rgba(82,183,136,0.12)' : 'rgba(201,168,76,0.12)', border:`1px solid ${trade.confidence === 'high' ? 'rgba(82,183,136,0.35)' : 'rgba(201,168,76,0.35)'}`, color: trade.confidence === 'high' ? '#52b788' : '#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                              {trade.confidence}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'#60a5fa', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.strategyName || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.55)', fontFamily:'JetBrains Mono, monospace' }}>{trade.signalDate}</td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.75)' }}>
                          <div>{trade.entryDate}</div>
                          <div style={{ color:'rgba(255,255,255,0.45)' }}>Entry Price</div>
                          <div style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(trade.entryPrice)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.t1Date || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.t2Date || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.75)' }}>
                          <div>{trade.exitDate || 'Open'}</div>
                          <div style={{ color:'rgba(255,255,255,0.45)' }}>{trade.status === 'closed' ? 'Exit Price' : 'Mark Price'}</div>
                          <div style={{ color: trade.status === 'closed' ? '#52b788' : 'rgba(255,255,255,0.65)', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(trade.status === 'closed' ? (trade.exitPrice || trade.markPrice) : trade.markPrice)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.75)', fontFamily:'JetBrains Mono, monospace' }}>
                          <div>{trade.qty}</div>
                          <div style={{ color:'rgba(255,255,255,0.45)' }}>remaining {trade.remainingQty}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded"
                            style={{
                              background: displayStatus === 'closed'
                                ? 'rgba(82,183,136,0.12)'
                                : displayStatus === 'partial'
                                  ? 'rgba(201,168,76,0.12)'
                                  : 'rgba(96,165,250,0.12)',
                              border: `1px solid ${displayStatus === 'closed'
                                ? 'rgba(82,183,136,0.35)'
                                : displayStatus === 'partial'
                                  ? 'rgba(201,168,76,0.35)'
                                  : 'rgba(96,165,250,0.35)'}`,
                              color: displayStatus === 'closed' ? '#52b788' : displayStatus === 'partial' ? '#c9a84c' : '#60a5fa',
                              fontFamily:'JetBrains Mono, monospace',
                            }}>
                            {displayStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color: grossPnl >= 0 ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.realizedPnl !== 0 ? (
                            <>
                              <div style={{ color:'rgba(255,255,255,0.45)' }}>Profit</div>
                              <div>{formatSignedCurrency(grossPnl)}</div>
                              <div>{formatSignedPct(realizedPct)}</div>
                            </>
                          ) : (
                            <div style={{ color:'rgba(255,255,255,0.35)' }}>—</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.realizedPnl !== 0 ? (
                            <>
                              <div>{formatCurrency(brokerage)}</div>
                              <div style={{ color:'rgba(255,255,255,0.45)' }}>{displayStatus === 'closed' ? (trade.chargeModel || 'actual') : `est. ${trade.chargeModel || 'delivery'}`}</div>
                            </>
                          ) : (
                            <div style={{ color:'rgba(255,255,255,0.35)' }}>—</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color: netPnl >= 0 ? '#52b788' : '#e05a5e', fontFamily:'JetBrains Mono, monospace' }}>
                          {trade.realizedPnl !== 0 ? (
                            <>
                              <div>{formatSignedCurrency(netPnl)}</div>
                              <div>{formatSignedPct(netRealizedPct)}</div>
                            </>
                          ) : (
                            <div style={{ color:'rgba(255,255,255,0.35)' }}>—</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.55)', fontFamily:'JetBrains Mono, monospace' }}>{trade.holdDays} d</td>
                        <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.45)' }}>
                          {trade.setup || `${Math.abs(trade.deviationPct).toFixed(2)}% below EMA · ${trade.downDays} down days · buy #${trade.buyNumber}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)' }}>
            <div className="px-4 py-2.5" style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
                Equity Curve ({result.equityCurve.length} days)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[760px]">
                <thead>
                  <tr style={{ background:'rgba(255,255,255,0.02)' }}>
                    {['Date', 'Cash', 'Market Value', 'Equity', 'Drawdown', 'Open Trades'].map(h => (
                      <th key={h} className="px-3 py-2 text-[10px] tracking-widest uppercase font-medium" style={{ color:'rgba(255,255,255,0.35)', fontFamily:'JetBrains Mono, monospace' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.equityCurve.map(point => (
                    <tr key={point.date} style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.75)', fontFamily:'JetBrains Mono, monospace' }}>{point.date}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(point.cash)}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(point.marketValue)}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>{formatCurrency(point.equity)}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color: point.drawdownPct > 0 ? '#e05a5e' : 'rgba(255,255,255,0.45)', fontFamily:'JetBrains Mono, monospace' }}>{point.drawdownPct.toFixed(2)}%</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color:'rgba(255,255,255,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{point.openTrades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-3" style={{ background:'#100e0a' }}>
      <p className="text-[9px] tracking-widest uppercase mb-1" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p style={{ color, fontFamily:'JetBrains Mono, monospace', fontSize: 15, fontWeight: 600 }}>{value}</p>
    </div>
  )
}

function MiniMetric({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)' }}>
      <p className="text-[9px] tracking-widest uppercase mb-1" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{label}</p>
      <p className="text-[12px]" style={{ color: valueColor || 'rgba(255,255,255,0.82)', fontFamily:'JetBrains Mono, monospace' }}>{value}</p>
    </div>
  )
}

function formatCurrency(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatCurrency(Math.abs(value))}`
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(2)}%`
}