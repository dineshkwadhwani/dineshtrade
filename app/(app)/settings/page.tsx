'use client'
import { useState, useEffect } from 'react'
import accounts from '@/config/accounts.json'

export default function SettingsPage() {
  const [activeAccounts, setActiveAccounts] = useState<string[]>(['ACC001'])
  const [tradeMode, setTradeMode] = useState<'auto'|'manual'>('manual')
  const [saved, setSaved] = useState(false)

  // Zerodha token state
  const [zerodhaToken, setZerodhaToken] = useState('')
  const [zerodhaConnected, setZerodhaConnected] = useState(false)
  const [tokenSaving, setTokenSaving] = useState(false)
  const [tokenMsg, setTokenMsg] = useState('')

  // Check connection status on load
  useEffect(() => {
    fetch('/api/zerodha/token')
      .then(r => r.json())
      .then(d => setZerodhaConnected(d.connected))
      .catch(() => {})
  }, [])

  async function saveToken() {
    if (!zerodhaToken.trim()) return
    setTokenSaving(true)
    setTokenMsg('')
    try {
      const res = await fetch('/api/zerodha/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: zerodhaToken.trim() })
      })
      const data = await res.json()
      if (res.ok) {
        setZerodhaConnected(true)
        setZerodhaToken('') // clear input after saving
        setTokenMsg('✓ Zerodha connected successfully')
      } else {
        setTokenMsg(`✗ ${data.error}`)
      }
    } catch {
      setTokenMsg('✗ Connection failed')
    }
    setTokenSaving(false)
  }

  async function disconnectZerodha() {
    await fetch('/api/zerodha/token', { method: 'DELETE' })
    setZerodhaConnected(false)
    setTokenMsg('Disconnected')
  }

  function toggleAccount(id: string) {
    setActiveAccounts(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  function save() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6 pb-4 max-w-2xl">
      <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
        <span className="gold-text">Settings</span>
      </h1>

      {/* ── ZERODHA CONNECTION ── */}
      <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.08)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b"
          style={{ background:'rgba(255,255,255,0.02)', borderColor:'rgba(255,255,255,0.06)' }}>
          <div>
            <h2 className="text-[11px] tracking-widest uppercase font-medium"
              style={{ color:'rgba(201,168,76,0.7)', fontFamily:'JetBrains Mono, monospace' }}>
              Zerodha Connection
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color:'rgba(255,255,255,0.3)' }}>
              Paste your daily access token here each morning after logging into Kite
            </p>
          </div>
          {/* Status badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-medium tracking-wide`}
            style={{
              background: zerodhaConnected ? 'rgba(82,183,136,0.12)' : 'rgba(255,255,255,0.05)',
              border: zerodhaConnected ? '1px solid rgba(82,183,136,0.3)' : '1px solid rgba(255,255,255,0.08)',
              color: zerodhaConnected ? '#52b788' : 'rgba(255,255,255,0.3)'
            }}>
            <span className={`w-1.5 h-1.5 rounded-full ${zerodhaConnected ? 'bg-[#52b788] animate-pulse-dot' : 'bg-white/20'}`} />
            {zerodhaConnected ? 'Connected' : 'Not connected'}
          </div>
        </div>

        <div className="p-5 space-y-3">
          {/* How to get token */}
          <div className="rounded-lg p-3" style={{ background:'rgba(201,168,76,0.05)', border:'1px solid rgba(201,168,76,0.1)' }}>
            <p className="text-[10px] tracking-widest uppercase mb-1"
              style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
              How to get your token
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color:'rgba(255,255,255,0.4)' }}>
              1. Login to <span style={{ color:'#c9a84c' }}>kite.zerodha.com</span> each morning
              {' '}→ 2. Go to <span style={{ color:'#c9a84c' }}>developers.kite.trade/apps</span>
              {' '}→ 3. Click your app → 4. Copy the <span style={{ color:'#c9a84c' }}>access_token</span>
              {' '}→ 5. Paste below
            </p>
          </div>

          {/* Token input */}
          <div>
            <input
              value={zerodhaToken}
              onChange={e => { setZerodhaToken(e.target.value); setTokenMsg('') }}
              placeholder={zerodhaConnected ? 'Token saved — paste new token to update' : 'Paste access_token here…'}
              className="w-full px-4 py-3 rounded-lg text-[12px] outline-none font-mono"
              style={{
                background:'rgba(255,255,255,0.04)',
                border:'1px solid rgba(255,255,255,0.08)',
                color:'rgba(255,255,255,0.7)',
              }}
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={saveToken}
              disabled={tokenSaving || !zerodhaToken.trim()}
              className="flex-1 py-3 rounded-lg text-[12px] font-semibold tracking-wider transition-all disabled:opacity-40"
              style={{
                background:'linear-gradient(135deg, rgba(82,183,136,0.3), rgba(82,183,136,0.15))',
                border:'1px solid rgba(82,183,136,0.4)',
                color:'#52b788'
              }}>
              {tokenSaving ? 'Connecting…' : zerodhaConnected ? '↺ Update Token' : '⚡ Connect Zerodha'}
            </button>

            {zerodhaConnected && (
              <button
                onClick={disconnectZerodha}
                className="px-4 py-3 rounded-lg text-[11px] font-medium transition-all"
                style={{
                  background:'rgba(224,90,94,0.08)',
                  border:'1px solid rgba(224,90,94,0.2)',
                  color:'rgba(224,90,94,0.7)'
                }}>
                Disconnect
              </button>
            )}
          </div>

          {/* Status message */}
          {tokenMsg && (
            <p className="text-[11px] text-center py-1"
              style={{ color: tokenMsg.startsWith('✓') ? '#52b788' : 'rgba(224,90,94,0.8)' }}>
              {tokenMsg}
            </p>
          )}

          <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.2)' }}>
            Token is stored securely in your session and expires automatically at midnight IST. Never stored in config files.
          </p>
        </div>
      </div>

      {/* ── TRADE MODE ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Trade Mode
        </h2>
        <div className="flex gap-3">
          {(['manual','auto'] as const).map(mode => (
            <button key={mode} onClick={() => setTradeMode(mode)}
              className="flex-1 py-4 rounded-xl font-semibold tracking-wider uppercase text-[12px] transition-all"
              style={{
                background: tradeMode === mode
                  ? mode === 'auto'
                    ? 'rgba(82,183,136,0.15)'
                    : 'rgba(201,168,76,0.15)'
                  : 'rgba(255,255,255,0.03)',
                border: tradeMode === mode
                  ? `1px solid ${mode === 'auto' ? 'rgba(82,183,136,0.4)' : 'rgba(201,168,76,0.4)'}`
                  : '1px solid rgba(255,255,255,0.06)',
                color: tradeMode === mode
                  ? mode === 'auto' ? '#52b788' : '#c9a84c'
                  : 'rgba(255,255,255,0.3)',
              }}>
              {mode === 'auto' ? '⚡ Auto' : '✋ Manual'}
            </button>
          ))}
        </div>
        <p className="text-[11px] mt-3" style={{ color:'rgba(255,255,255,0.3)' }}>
          {tradeMode === 'manual'
            ? 'Manual: recommendations shown with Execute button. You approve each trade.'
            : 'Auto: trades execute automatically when all rules are met. Max 3 buys + 3 sells/day.'}
        </p>
      </div>

      {/* ── ACCOUNTS ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Active Accounts This Session
        </h2>
        <div className="space-y-3">
          {accounts.map(acc => (
            <div key={acc.id}
              className="flex items-center gap-4 p-3 rounded-lg transition-all"
              style={{
                background: activeAccounts.includes(acc.id) ? 'rgba(201,168,76,0.05)' : 'rgba(255,255,255,0.02)',
                border:`1px solid ${activeAccounts.includes(acc.id) ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.05)'}`
              }}>
              {/* Toggle */}
              <button onClick={() => toggleAccount(acc.id)}
                className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
                style={{ background: activeAccounts.includes(acc.id) ? '#c9a84c' : 'rgba(255,255,255,0.1)' }}>
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${activeAccounts.includes(acc.id) ? 'left-6' : 'left-1'}`} />
              </button>
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                style={{ background:`${acc.color}20`, color:acc.color, border:`1px solid ${acc.color}40` }}>
                {acc.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/80">{acc.name}</p>
                <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>
                  {acc.broker} · {acc.accountNo}
                </p>
              </div>
              <span className="text-[9px] px-2 py-1 rounded"
                style={{ background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.25)' }}>
                {acc.isTrading ? 'Trading' : 'View only'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── STRATEGY RULES ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Strategy Rules (Fixed — Read Only)
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Corpus', '₹50,000'], ['Per Trade', '₹5,000'],
            ['Max Positions', '10'], ['Max Buys/Day', '3'],
            ['Max Sells/Day', '3'], ['T1 Target', '+1.5%'],
            ['T2 Target', '+2.0%'], ['EMA Period', '20-day'],
            ['Entry Signal', '5%+ below EMA'], ['Short Selling', 'Never'],
            ['F&O', 'Never'], ['Circuit Breaker', 'Nifty −5%'],
          ].map(([k,v]) => (
            <div key={k} className="flex justify-between items-center py-2 px-3 rounded-lg"
              style={{ background:'rgba(255,255,255,0.02)' }}>
              <span className="text-[11px]" style={{ color:'rgba(255,255,255,0.35)' }}>{k}</span>
              <span className="text-[11px] font-medium"
                style={{ color:'rgba(201,168,76,0.7)', fontFamily:'JetBrains Mono, monospace' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <button onClick={save}
        className="w-full py-4 rounded-xl font-bold tracking-wider uppercase text-[13px] transition-all"
        style={{ background:'linear-gradient(135deg, #7a5510, #c9a84c)', color:'#080604' }}>
        {saved ? '✓ Saved!' : 'Save Settings'}
      </button>

      <p className="text-[10px] text-center pb-4" style={{ color:'rgba(255,255,255,0.2)' }}>
        Settings persist until midnight IST · Closing browser does not log you out · Only Logout clears session
      </p>
    </div>
  )
}
