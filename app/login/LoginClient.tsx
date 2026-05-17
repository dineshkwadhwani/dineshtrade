'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  hint: { date: string; time: string; hint: string }
  market: { open: boolean; status: string }
  datetime: { date: string; time: string; dayName: string }
}

const TICKER_STOCKS = [
  { sym: 'BAJFINANCE', val: '910.45', up: true },
  { sym: 'RELIANCE',   val: '1,421.30', up: true },
  { sym: 'ICICIBANK',  val: '1,232.10', up: false },
  { sym: 'HDFCBANK',   val: '752.80',  up: true },
  { sym: 'TATASTEEL',  val: '338.90',  up: true },
  { sym: 'BAJAJ-AUTO', val: '9,245.00', up: true },
  { sym: 'TCS',        val: '3,421.50', up: false },
  { sym: 'MARUTI',     val: '12,840.00', up: true },
  { sym: 'SBIN',       val: '815.40',  up: true },
  { sym: 'INFY',       val: '1,161.25', up: false },
]

export default function LoginClient({ hint, market, datetime }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(datetime.time)
  const router = useRouter()

  // Live clock
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date()
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const hh = String(ist.getHours()).padStart(2,'0')
      const mm = String(ist.getMinutes()).padStart(2,'0')
      setCurrentTime(`${hh}:${mm} IST`)
    }, 1000)
    return () => clearInterval(t)
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (res.ok) {
        router.push('/dashboard')
      } else {
        setError('Invalid access code. Check the hint below.')
        setPassword('')
      }
    } catch {
      setError('Connection error. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const doubled = [...TICKER_STOCKS, ...TICKER_STOCKS]

  return (
    <div className="min-h-screen bg-[#080604] flex flex-col overflow-hidden relative">

      {/* Radial gold glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full"
          style={{ background:'radial-gradient(ellipse, rgba(201,168,76,0.1) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full"
          style={{ background:'radial-gradient(circle, rgba(201,168,76,0.04) 0%, transparent 65%)' }} />
        {/* Dot pattern */}
        <div className="absolute inset-0 opacity-40"
          style={{ backgroundImage:'radial-gradient(circle, rgba(201,168,76,0.07) 1px, transparent 1px)', backgroundSize:'28px 28px' }} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 relative z-10">

        {/* Monogram */}
        <div className="mb-1 animate-fade-up">
          <div className="text-center">
            <div className="font-serif text-[88px] leading-none tracking-tight gold-text select-none"
              style={{ fontFamily:'Cormorant Garamond, Georgia, serif', fontWeight:300 }}>
              DW
            </div>
            <div className="text-[9px] tracking-[0.45em] uppercase mt-[-6px]"
              style={{ color:'rgba(201,168,76,0.35)', fontFamily:'Outfit, sans-serif' }}>
              Dinesh Wadhwani
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="w-12 h-px my-4 animate-fade-up"
          style={{ background:'linear-gradient(90deg, transparent, #c9a84c, transparent)', animationDelay:'0.1s' }} />

        {/* Welcome */}
        <div className="text-center mb-1 animate-fade-up" style={{ animationDelay:'0.15s' }}>
          <p className="text-white/60 text-lg mb-[2px]"
            style={{ fontFamily:'Cormorant Garamond, Georgia, serif', fontWeight:300 }}>
            Welcome, <span className="text-[#e8c97a]">Dinesh</span>
          </p>
          <p className="text-[10px] tracking-widest uppercase mt-1"
            style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
            {datetime.dayName} · {hint.date} · {currentTime}
          </p>
        </div>

        {/* Market status */}
        <div className="flex items-center gap-2 mt-2 mb-7 animate-fade-up" style={{ animationDelay:'0.2s' }}>
          <span className={`w-[6px] h-[6px] rounded-full animate-pulse-dot ${market.open ? 'bg-[#52b788]' : 'bg-[#e05a5e]'}`} />
          <span className={`text-[10px] tracking-widest uppercase ${market.open ? 'text-[#52b788]' : 'text-[#e05a5e]/70'}`}
            style={{ fontFamily:'JetBrains Mono, monospace' }}>
            NSE {market.status}
          </span>
        </div>

        {/* Login form */}
        <form onSubmit={handleLogin} className="w-full max-w-[360px] animate-fade-up" style={{ animationDelay:'0.25s' }}>
          <p className="text-[9px] tracking-widest uppercase text-center mb-2"
            style={{ color:'rgba(201,168,76,0.4)', fontFamily:'JetBrains Mono, monospace' }}>
            Access Code
          </p>

          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
            placeholder="••••••••••"
            className="w-full text-center text-[22px] tracking-[0.2em] py-4 px-4 rounded-xl outline-none transition-all duration-200 mb-3"
            style={{
              background:'rgba(201,168,76,0.04)',
              border: error ? '1px solid rgba(224,90,94,0.5)' : '1px solid rgba(201,168,76,0.18)',
              fontFamily:'JetBrains Mono, monospace',
              color:'rgba(255,255,255,0.9)',
            }}
            autoComplete="off"
            inputMode="numeric"
            maxLength={10}
          />

          {error && (
            <p className="text-[#e05a5e] text-[11px] text-center mb-3 tracking-wide">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || password.length < 10}
            className="w-full py-[17px] rounded-xl font-bold tracking-[0.2em] uppercase text-[12px] transition-all duration-200 disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #7a5510, #c9a84c, #e8d090, #c9a84c, #7a5510)',
              backgroundSize: '300% 100%',
              color: '#080604',
              fontFamily:'Syne, Outfit, sans-serif',
            }}>
            {loading ? 'Verifying…' : 'Enter Trading Desk →'}
          </button>

          {/* Hint */}
          <div className="mt-4 p-3 rounded-lg text-center"
            style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.08)' }}>
            <p className="text-[9px] tracking-wider uppercase mb-1"
              style={{ color:'rgba(201,168,76,0.3)', fontFamily:'JetBrains Mono, monospace' }}>
              Format: ddmmyyyyhh
            </p>
            <p className="text-[11px]" style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
              {hint.date} at {hint.time} → <span style={{ color:'rgba(201,168,76,0.8)' }}>{hint.hint}</span>
            </p>
          </div>
        </form>
      </div>

      {/* Ticker strip */}
      <div className="relative z-10 border-t py-3 overflow-hidden"
        style={{ borderColor:'rgba(201,168,76,0.08)', background:'rgba(0,0,0,0.4)' }}>
        <div className="flex animate-ticker whitespace-nowrap" style={{ width:'max-content' }}>
          {doubled.map((s, i) => (
            <span key={i} className="flex items-center gap-2 mx-4">
              <span className="text-[9px] tracking-wider" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>
                {s.sym}
              </span>
              <span className={`text-[11px] font-medium ${s.up ? 'text-[#52b788]' : 'text-[#e05a5e]'}`}
                style={{ fontFamily:'JetBrains Mono, monospace' }}>
                {s.up ? '▲' : '▼'} {s.val}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
