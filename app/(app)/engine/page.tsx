'use client'
import { useState } from 'react'

interface Recommendation {
  symbol: string; name: string; price: number; action: string
  strategy: string; source: string; reason: string
  target1: number; target2: number; stopLoss: number
  suggestedQty: number; confidence: string
}

interface EngineState {
  mode: string
  recommendations: Recommendation[]
  limits: { buysRemaining: number; sellsRemaining: number; canBuy: boolean }
  cashAvailable: number
  generatedAt: string
}

function REC({ rec, tradeMode, onExecute }: { rec: Recommendation; tradeMode: string; onExecute: (r: Recommendation) => void }) {
  const [executing, setExecuting] = useState(false)
  const [done, setDone] = useState(false)

  async function execute() {
    setExecuting(true)
    await onExecute(rec)
    setExecuting(false)
    setDone(true)
  }

  const pnlPct1 = ((rec.target1 - rec.price) / rec.price * 100).toFixed(1)
  const pnlPct2 = ((rec.target2 - rec.price) / rec.price * 100).toFixed(1)
  const slPct   = ((rec.stopLoss - rec.price) / rec.price * 100).toFixed(1)

  return (
    <div className="rounded-xl overflow-hidden" style={{ border:`1px solid ${rec.confidence === 'high' ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.08)'}`, background: rec.confidence === 'high' ? 'rgba(201,168,76,0.04)' : 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor:'rgba(255,255,255,0.06)' }}>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base text-white" style={{ fontFamily:'JetBrains Mono, monospace' }}>{rec.symbol}</span>
            {rec.confidence === 'high' && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background:'rgba(201,168,76,0.2)', color:'#c9a84c' }}>HIGH CONF</span>}
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background:'rgba(82,183,136,0.15)', color:'#52b788' }}>
              {rec.strategy === 'catalyst' ? '⚡ Catalyst' : '📊 EMA Dip'}
            </span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color:'rgba(255,255,255,0.4)' }}>{rec.name} · {rec.source}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-medium" style={{ fontFamily:'JetBrains Mono, monospace', color:'rgba(255,255,255,0.8)' }}>₹{rec.price}</p>
          <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>Qty: {rec.suggestedQty}</p>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-[11px] mb-3" style={{ color:'rgba(255,255,255,0.5)' }}>{rec.reason}</p>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { label:'T1', val:`₹${rec.target1}`, pct:`+${pnlPct1}%`, color:'#52b788' },
            { label:'T2', val:`₹${rec.target2}`, pct:`+${pnlPct2}%`, color:'#2d6a4f' },
            { label:'SL', val:`₹${rec.stopLoss}`, pct:`${slPct}%`, color:'#e05a5e' },
            { label:'Capital', val:`₹${(rec.price * rec.suggestedQty).toFixed(0)}`, pct:'', color:'rgba(255,255,255,0.5)' },
          ].map(item => (
            <div key={item.label} className="rounded-lg p-2 text-center" style={{ background:'rgba(255,255,255,0.03)' }}>
              <p className="text-[9px] mb-1" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>{item.label}</p>
              <p className="text-[11px] font-medium" style={{ color:item.color, fontFamily:'JetBrains Mono, monospace' }}>{item.val}</p>
              {item.pct && <p className="text-[9px]" style={{ color:item.color }}>{item.pct}</p>}
            </div>
          ))}
        </div>
        {tradeMode === 'manual' && !done && (
          <button onClick={execute} disabled={executing}
            className="w-full py-3 rounded-lg font-bold tracking-wider uppercase text-[12px] transition-all disabled:opacity-50"
            style={{ background:'linear-gradient(135deg, rgba(82,183,136,0.3), rgba(82,183,136,0.15))', border:'1px solid rgba(82,183,136,0.4)', color:'#52b788' }}>
            {executing ? 'Placing Order…' : '▶ Execute Trade'}
          </button>
        )}
        {tradeMode === 'auto' && (
          <div className="text-center py-2 text-[11px]" style={{ color:'rgba(82,183,136,0.5)' }}>⚡ Will execute automatically when conditions confirmed</div>
        )}
        {done && (
          <div className="text-center py-2 text-[12px]" style={{ color:'#52b788' }}>✓ Order placed</div>
        )}
      </div>
    </div>
  )
}

export default function EnginePage() {
  const [state, setState] = useState<EngineState | null>(null)
  const [loading, setLoading] = useState(false)
  const [tradeMode] = useState<'auto'|'manual'>('manual')

  async function runEngine() {
    setLoading(true)
    try {
      const res = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          giftNiftyChangePct: -0.3,
          quotes: {},
          brokerRecs: [],
          cashAvailable: 50000,
          todayBuys: 0, todaySells: 0
        })
      })
      const data = await res.json()
      setState(data)
    } catch {}
    finally { setLoading(false) }
  }

  async function executeRec(rec: Recommendation) {
    // Place order via Zerodha API
    await fetch('/api/zerodha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'place_order',
        accessToken: '',
        order: { symbol: rec.symbol, quantity: rec.suggestedQty, transaction_type: 'BUY' }
      })
    })
  }

  const modeColors: Record<string, string> = { catalyst:'#c9a84c', dip:'#52b788', circuit:'#e05a5e' }
  const modeLabels: Record<string, string> = {
    catalyst:'⚡ Catalyst Mode — Running Strategy 2',
    dip:'📊 EMA Dip Mode — Running Strategy 1',
    circuit:'🚨 Circuit Breaker — No Trades Today',
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
          Trading <span className="gold-text">Engine</span>
        </h1>
        <button onClick={runEngine} disabled={loading}
          className="px-5 py-2.5 rounded-xl text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
          style={{ background:'linear-gradient(135deg, #7a5510, #c9a84c)', color:'#080604' }}>
          {loading ? '↻ Scanning…' : '↻ Refresh & Scan'}
        </button>
      </div>

      {/* Mode indicator */}
      {state && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-3"
          style={{ background:`rgba(${state.mode === 'catalyst' ? '201,168,76' : state.mode === 'dip' ? '82,183,136' : '224,90,94'},0.08)`, border:`1px solid rgba(${state.mode === 'catalyst' ? '201,168,76' : state.mode === 'dip' ? '82,183,136' : '224,90,94'},0.2)` }}>
          <p className="text-sm font-medium" style={{ color: modeColors[state.mode] || '#fff' }}>
            {modeLabels[state.mode] || state.mode}
          </p>
          <div className="ml-auto flex gap-4 text-[11px]" style={{ fontFamily:'JetBrains Mono, monospace', color:'rgba(255,255,255,0.4)' }}>
            <span>Buys left: <span style={{ color:'#52b788' }}>{state.limits.buysRemaining}</span></span>
            <span>Sells left: <span style={{ color:'#52b788' }}>{state.limits.sellsRemaining}</span></span>
            <span>Cash: <span style={{ color:'#c9a84c' }}>₹{state.cashAvailable?.toLocaleString()}</span></span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!state && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4 opacity-30">⚡</div>
          <p className="text-base mb-2" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.5)', fontSize:'20px' }}>Ready to scan</p>
          <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.25)' }}>Press Refresh & Scan to run the strategy engine</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="text-3xl mb-3 animate-spin">⚡</div>
            <p className="text-[12px]" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
              Scanning {84} List A stocks…
            </p>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {state?.recommendations && state.recommendations.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[11px] tracking-widest uppercase" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
            {state.recommendations.length} Signal{state.recommendations.length > 1 ? 's' : ''} Found
          </h2>
          {state.recommendations.map((rec, i) => (
            <REC key={i} rec={rec} tradeMode={tradeMode} onExecute={executeRec} />
          ))}
        </div>
      )}

      {state?.recommendations?.length === 0 && !loading && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3 opacity-30">—</p>
          <p className="text-base" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.4)', fontSize:'18px' }}>No signals today</p>
          <p className="text-[12px] mt-1" style={{ color:'rgba(255,255,255,0.2)' }}>No stocks meet entry criteria right now. Check again in 30 minutes.</p>
        </div>
      )}
    </div>
  )
}
