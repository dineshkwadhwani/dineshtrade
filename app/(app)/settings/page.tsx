'use client'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'

interface AccountDisplay {
  name: string
  displayName: string
  initials: string
  color: string
  note: string
}

type Mode = 'auto' | 'manual'

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<AccountDisplay[]>([])
  const [environment, setEnvironment] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('manual')
  const [connected, setConnected] = useState<string[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [savedFlash, setSavedFlash] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [callbackUrl, setCallbackUrl] = useState('')
  const [banner, setBanner] = useState<{ text: string; ok: boolean } | null>(null)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Compute callback URL on the client (where window is available)
  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/zerodha/callback`)
  }, [])

  // Initial load
  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
    ]).then(([a, s]) => {
      setAccounts(a.accounts || [])
      setEnvironment(a.environment || null)
      setMode(s.mode === 'auto' ? 'auto' : 'manual')
      setConnected(s.accountsWithToken || [])
    }).catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  // Read ?connected= / ?error= from callback and show a banner; then clean the URL
  useEffect(() => {
    const connectedParam = searchParams.get('connected')
    const errorParam = searchParams.get('error')
    if (connectedParam) {
      setBanner({ text: `✓ ${connectedParam} connected via Kite Connect`, ok: true })
      router.replace(pathname, { scroll: false })
    } else if (errorParam) {
      setBanner({ text: `✗ ${errorParam}`, ok: false })
      router.replace(pathname, { scroll: false })
    }
  }, [searchParams, router, pathname])

  function flashSaved() {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1400)
  }

  async function changeMode(next: Mode) {
    if (next === mode) return
    setMode(next)
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    })
    if (res.ok) flashSaved()
  }

  function loginWithKite(account: string) {
    setBusy(b => ({ ...b, [account]: true }))
    // Server-side redirect chain handles the rest. Page unloads after navigation.
    window.location.href = `/api/zerodha/login?account=${encodeURIComponent(account)}`
  }

  async function disconnect(account: string) {
    setBusy(b => ({ ...b, [account]: true }))
    try {
      const res = await fetch(`/api/zerodha/token?account=${encodeURIComponent(account)}`, { method: 'DELETE' })
      if (res.ok) {
        setConnected(c => c.filter(a => a !== account))
        setBanner({ text: `${account} disconnected`, ok: true })
      }
    } finally {
      setBusy(b => ({ ...b, [account]: false }))
    }
  }

  function copyCallbackUrl() {
    if (!callbackUrl) return
    navigator.clipboard?.writeText(callbackUrl).then(() => {
      setBanner({ text: '✓ Callback URL copied', ok: true })
      setTimeout(() => setBanner(null), 1800)
    }).catch(() => {})
  }

  return (
    <div className="space-y-6 pb-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-light" style={{ fontFamily:'Cormorant Garamond, serif', color:'rgba(255,255,255,0.9)' }}>
            <span className="gold-text">Settings</span>
          </h1>
          {environment && (
            <span className="text-[10px] tracking-widest uppercase px-2 py-1 rounded"
              style={{
                background: environment === 'PROD' ? 'rgba(224,90,94,0.12)' : 'rgba(82,183,136,0.12)',
                border: `1px solid ${environment === 'PROD' ? 'rgba(224,90,94,0.35)' : 'rgba(82,183,136,0.35)'}`,
                color: environment === 'PROD' ? '#e05a5e' : '#52b788',
                fontFamily:'JetBrains Mono, monospace',
              }}>
              {environment}
            </span>
          )}
        </div>
        {savedFlash && (
          <span className="text-[11px]" style={{ color:'#52b788', fontFamily:'JetBrains Mono, monospace' }}>
            ✓ Saved
          </span>
        )}
      </div>

      {banner && (
        <div className="rounded-lg px-4 py-3 text-[12px]"
          style={{
            background: banner.ok ? 'rgba(82,183,136,0.08)' : 'rgba(224,90,94,0.08)',
            border: `1px solid ${banner.ok ? 'rgba(82,183,136,0.3)' : 'rgba(224,90,94,0.3)'}`,
            color: banner.ok ? '#52b788' : 'rgba(224,90,94,0.9)',
          }}>
          {banner.text}
        </div>
      )}

      {/* ── TRADE MODE ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Trade Mode
        </h2>
        <div className="flex gap-3">
          {(['manual','auto'] as const).map(m => (
            <button key={m} onClick={() => changeMode(m)}
              className="flex-1 py-4 rounded-xl font-semibold tracking-wider uppercase text-[12px] transition-all"
              style={{
                background: mode === m
                  ? m === 'auto' ? 'rgba(82,183,136,0.15)' : 'rgba(201,168,76,0.15)'
                  : 'rgba(255,255,255,0.03)',
                border: mode === m
                  ? `1px solid ${m === 'auto' ? 'rgba(82,183,136,0.4)' : 'rgba(201,168,76,0.4)'}`
                  : '1px solid rgba(255,255,255,0.06)',
                color: mode === m
                  ? m === 'auto' ? '#52b788' : '#c9a84c'
                  : 'rgba(255,255,255,0.3)',
              }}>
              {m === 'auto' ? '⚡ Auto' : '✋ Manual'}
            </button>
          ))}
        </div>
        <p className="text-[11px] mt-3" style={{ color:'rgba(255,255,255,0.3)' }}>
          {mode === 'manual'
            ? 'Manual: recommendations shown with Execute button. You approve each trade.'
            : 'Auto: trades execute automatically every 5 min during market hours (Phase 2 only — on Vercel the cron does not run).'}
        </p>
      </div>

      {/* ── KITE CONNECT SETUP HINT ── */}
      {callbackUrl && (
        <div className="rounded-lg p-4"
          style={{ background:'rgba(201,168,76,0.04)', border:'1px solid rgba(201,168,76,0.12)' }}>
          <p className="text-[10px] tracking-widest uppercase mb-2"
            style={{ color:'rgba(201,168,76,0.5)', fontFamily:'JetBrains Mono, monospace' }}>
            One-time setup
          </p>
          <p className="text-[11px] mb-2" style={{ color:'rgba(255,255,255,0.5)' }}>
            Set this as the <strong>Redirect URL</strong> in each Kite Connect app at developers.kite.trade:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded text-[11px] truncate"
              style={{ background:'rgba(0,0,0,0.3)', color:'#c9a84c', fontFamily:'JetBrains Mono, monospace' }}>
              {callbackUrl}
            </code>
            <button onClick={copyCallbackUrl}
              className="px-3 py-2 rounded text-[10px] tracking-wider uppercase"
              style={{ background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.25)', color:'#c9a84c' }}>
              Copy
            </button>
          </div>
        </div>
      )}

      {/* ── ACCOUNTS ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Zerodha Accounts
        </h2>

        {!loaded && <p className="text-[11px]" style={{ color:'rgba(255,255,255,0.3)' }}>Loading…</p>}

        {loaded && accounts.length === 0 && (
          <p className="text-[11px]" style={{ color:'rgba(224,90,94,0.7)' }}>
            No accounts configured. Set ZERODHA_ACCOUNT1, ZERODHA_API_KEY_…, ZERODHA_API_SECRET_… in .env.local.
          </p>
        )}

        <div className="space-y-4">
          {accounts.map(acc => {
            const isConnected = connected.includes(acc.name)
            return (
              <div key={acc.name} className="rounded-lg p-4"
                style={{
                  background: isConnected ? `${acc.color}08` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isConnected ? acc.color + '33' : 'rgba(255,255,255,0.06)'}`,
                }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                    style={{ background:`${acc.color}20`, color:acc.color, border:`1px solid ${acc.color}40` }}>
                    {acc.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/85">{acc.displayName}</p>
                    {acc.note && <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.3)' }}>{acc.note}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium"
                    style={{
                      background: isConnected ? 'rgba(82,183,136,0.12)' : 'rgba(255,255,255,0.05)',
                      border: isConnected ? '1px solid rgba(82,183,136,0.3)' : '1px solid rgba(255,255,255,0.08)',
                      color: isConnected ? '#52b788' : 'rgba(255,255,255,0.4)',
                    }}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#52b788] animate-pulse-dot' : 'bg-white/20'}`} />
                    {isConnected ? 'Connected' : 'Not connected'}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => loginWithKite(acc.name)}
                    disabled={busy[acc.name]}
                    className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold tracking-wider transition-all disabled:opacity-50"
                    style={{
                      background:'linear-gradient(135deg, rgba(82,183,136,0.3), rgba(82,183,136,0.15))',
                      border:'1px solid rgba(82,183,136,0.4)',
                      color:'#52b788',
                    }}>
                    {busy[acc.name]
                      ? 'Redirecting…'
                      : isConnected ? '↻ Re-login with Kite' : '⚡ Login with Kite'}
                  </button>
                  {isConnected && (
                    <button
                      onClick={() => disconnect(acc.name)}
                      disabled={busy[acc.name]}
                      className="px-3 py-2.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
                      style={{
                        background:'rgba(224,90,94,0.08)',
                        border:'1px solid rgba(224,90,94,0.2)',
                        color:'rgba(224,90,94,0.7)',
                      }}>
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-[10px] mt-3" style={{ color:'rgba(255,255,255,0.25)' }}>
          Tokens expire at 6 AM IST next day — re-login each morning. Token never touches the browser; stored server-side in your session.
        </p>
      </div>

      {/* ── STRATEGY RULES (read-only) ── */}
      <div className="rounded-xl p-5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-[11px] tracking-widest uppercase mb-4"
          style={{ color:'rgba(201,168,76,0.6)', fontFamily:'JetBrains Mono, monospace' }}>
          Strategy Rules (Fixed — Read Only)
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Per Trade Cap', '₹5,000'],
            ['Max Positions', '10'],
            ['Max Buys/Day', '3'],
            ['Max Sells/Day', '3'],
            ['T1 Target', '+1.5%'],
            ['T2 Target', '+2.0%'],
            ['EMA Period', '20-day'],
            ['Entry Signal', '5%+ below EMA'],
            ['Short Selling', 'Never'],
            ['F&O', 'Never'],
            ['Circuit Breaker', 'Nifty −5%'],
            ['Order Type', 'CNC / Market'],
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

      <p className="text-[10px] text-center" style={{ color:'rgba(255,255,255,0.2)' }}>
        Settings persist until logout · Closing the browser does not log you out · Only Logout clears the session
      </p>
    </div>
  )
}
