'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import StrategiesTab from './StrategiesTab'
import WatchlistTab from './WatchlistTab'
import BacktestTab from './BacktestTab'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8', primary: '#3B82F6' }
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', fontFamily: INTER, fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box', color: C.body, background: C.bg }
const btnStyle: React.CSSProperties = { padding: '10px 20px', borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 14, cursor: 'pointer', border: 'none' }

const TABS = [
  { id: 'connection', icon: '⚡', label: 'Connection' },
  { id: 'strategies', icon: '◈', label: 'Strategies' },
  { id: 'watchlist', icon: '◎', label: 'Watchlist' },
  { id: 'backtest', icon: '◉', label: 'Backtest' },
] as const
type TabId = typeof TABS[number]['id']

interface Props {
  savedApiKey: string
  savedApiSecret: string
  isConnected: boolean
  tokenCapturedAt: string | null
  cronMode: string
  kiteLoginUrl: string
  strategies: { id: string; name: string; type: string; active: boolean; scan_interval_min: number; color: string | null; watchlist_keys: string[] | null; params: Record<string, unknown>; exits: Record<string, unknown>; gift_nifty_gate: Record<string, unknown> | null }[]
  capitalConfig: Record<string, unknown> | null
  fixedRules: { rule_key: string; value: string; description?: string | null; display_name?: string | null; rule_name?: string | null }[]
  watchlists: { list_key: string; name: string; symbols: { nse: string; name: string }[] }[]
  targetCustomerId?: string
  justConnected?: boolean
  platformConfig?: { key: string; value: string }[]
}
export default function SettingsClient({ savedApiKey, savedApiSecret, isConnected, tokenCapturedAt, cronMode, kiteLoginUrl, strategies, capitalConfig, fixedRules, watchlists, targetCustomerId, justConnected, platformConfig }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<TabId>('connection')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)
  const [savingMode, setSavingMode] = useState(false)
  const [credsMsg, setCredsMsg] = useState('')
  const [modeMsg, setModeMsg] = useState('')
  const [mode, setMode] = useState(cronMode)
  const [disconnecting, setDisconnecting] = useState(false)

  async function handleDisconnect() {
    if (!confirm('Disconnect Zerodha? The current token will be cleared. You will need to reconnect to resume auto-trading.')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/dalgo/customer/broker/disconnect', { method: 'DELETE' })
      if (res.ok) router.refresh()
      else alert('Failed to disconnect. Please try again.')
    } finally {
      setDisconnecting(false)
    }
  }
  const [strategyStates, setStrategyStates] = useState<Record<string, boolean>>(
    Object.fromEntries(strategies.map(s => [s.id, s.active]))
  )
  const [disclaimer, setDisclaimer] = useState<{ strategyId: string; strategyName: string } | null>(null)
  const [strategyMsg, setStrategyMsg] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState<{ seeded: { symbol: string; qty: number; avgPrice: number }[]; positionsRemoved: number } | null>(null)
  const [resetError, setResetError] = useState('')

  async function handleSaveCreds(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim() || !apiSecret.trim()) { setCredsMsg('Both fields are required.'); return }
    setSavingCreds(true); setCredsMsg('')
    try {
      const res = await fetch('/api/dalgo/setup/broker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ broker: 'zerodha', apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }) })
      const data = await res.json()
      if (!res.ok) { setCredsMsg(data.error || 'Failed to save.') }
      else { setCredsMsg('Credentials saved. Connect Zerodha to verify.'); setApiKey(''); setApiSecret(''); router.refresh() }
    } catch { setCredsMsg('Connection error.') }
    finally { setSavingCreds(false) }
  }

  async function handleSetMode(newMode: string) {
    setSavingMode(true); setModeMsg('')
    try {
      const res = await fetch('/api/dalgo/customer/mode', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: newMode }) })
      const data = await res.json()
      if (!res.ok) { setModeMsg(data.error || 'Failed.') }
      else { setMode(newMode); setModeMsg('Mode updated.'); router.refresh() }
    } catch { setModeMsg('Connection error.') }
    finally { setSavingMode(false) }
  }

  async function handleStrategyToggle(strategyId: string, strategyName: string, newActive: boolean) {
    if (newActive) { setDisclaimer({ strategyId, strategyName }); return }
    await applyStrategyToggle(strategyId, false, false)
  }

  async function applyStrategyToggle(strategyId: string, newActive: boolean, agreed: boolean) {
    setStrategyMsg('')
    try {
      const res = await fetch('/api/dalgo/customer/strategy', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategyId, active: newActive, agreed }) })
      const data = await res.json()
      if (!res.ok) { setStrategyMsg(data.error || 'Failed to update strategy.') }
      else { setStrategyStates(prev => ({ ...prev, [strategyId]: newActive })); router.refresh() }
    } catch { setStrategyMsg('Connection error.') }
  }

  async function handleDisclaimerAgree() {
    if (!disclaimer) return
    const { strategyId } = disclaimer
    setDisclaimer(null)
    await applyStrategyToggle(strategyId, true, true)
  }

  async function handleReset() {
    setResetError(''); setResetResult(null); setResetting(true)
    try {
      const res = await fetch('/api/dalgo/customer/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET', ...(targetCustomerId ? { targetCustomerId } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) { setResetError(data.error || 'Reset failed.') }
      else { setResetResult(data); setResetConfirm(''); router.refresh() }
    } catch { setResetError('Connection error.') }
    finally { setResetting(false) }
  }

  return (
    <div style={{ fontFamily: INTER, maxWidth: 680 }}>
      <h1 style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700, color: C.heading, margin: '0 0 24px' }}>Settings</h1>

      {/* Tab bar — pill style */}
      <div style={{ display: 'inline-flex', background: '#EFF6FF', borderRadius: 12, padding: 4, marginBottom: 24, gap: 2, border: `1px solid ${C.border}` }}>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 20px',
              fontFamily: INTER, fontWeight: active ? 600 : 500, fontSize: 14,
              color: active ? C.heading : C.muted,
              background: active ? C.card : 'transparent',
              border: 'none', borderRadius: 9,
              boxShadow: active ? '0 1px 4px rgba(30,58,138,0.12)' : 'none',
              cursor: 'pointer', transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>{t.icon}</span>
              <span className="hidden sm:inline" style={{ letterSpacing: '-0.01em' }}>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Connection tab */}
      {tab === 'connection' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {justConnected && (
            <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 10, padding: '12px 16px' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#16A34A' }}>✓ Zerodha connected successfully — your token is active for today.</p>
            </div>
          )}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
            <h2 style={{ fontFamily: SORA, fontSize: 16, fontWeight: 600, color: C.heading, margin: '0 0 16px' }}>Zerodha Connection</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: C.body }}>Status:</span>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: isConnected ? '#DCFCE7' : '#FEE2E2', color: isConnected ? '#16A34A' : '#DC2626' }}>
                {isConnected ? '● Connected' : '● Not connected'}
              </span>
              {tokenCapturedAt && <span style={{ fontSize: 11, color: C.muted }}>Token from {new Date(tokenCapturedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <a href={kiteLoginUrl} style={{ ...btnStyle, display: 'inline-block', background: '#387ED1', color: '#fff', textDecoration: 'none', fontSize: 14 }}>
                {isConnected ? '↻ Reconnect Zerodha' : '⚡ Connect Zerodha'}
              </a>
              {isConnected && (
                <button onClick={handleDisconnect} disabled={disconnecting}
                  style={{ ...btnStyle, background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA', fontSize: 14, opacity: disconnecting ? 0.6 : 1 }}>
                  {disconnecting ? 'Disconnecting…' : '✕ Disconnect'}
                </button>
              )}
            </div>
            <form onSubmit={handleSaveCreds} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ fontFamily: SORA, fontSize: 14, fontWeight: 600, color: C.heading, margin: 0 }}>Update API Credentials</h3>
              {savedApiKey && <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>Current API Key: <code>{savedApiKey}</code></p>}
              {savedApiSecret && <p style={{ fontSize: 12, color: C.muted, margin: '0' }}>Current API Secret: <code>{savedApiSecret}</code></p>}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.heading, display: 'block', marginBottom: 4 }}>API Key</label>
                <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Kite Connect API key" autoComplete="new-password" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.heading, display: 'block', marginBottom: 4 }}>API Secret</label>
                <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder="Kite Connect API secret" autoComplete="new-password" style={inputStyle} />
              </div>
              {credsMsg && <p style={{ fontSize: 13, color: credsMsg.includes('saved') ? '#16A34A' : '#DC2626', margin: 0 }}>{credsMsg}</p>}
              <button type="submit" disabled={savingCreds} style={{ ...btnStyle, background: savingCreds ? '#93C5FD' : C.primary, color: '#fff', alignSelf: 'flex-start' }}>
                {savingCreds ? 'Saving…' : 'Save Credentials'}
              </button>
            </form>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
            <h2 style={{ fontFamily: SORA, fontSize: 16, fontWeight: 600, color: C.heading, margin: '0 0 12px' }}>Cron Mode</h2>
            <p style={{ fontSize: 13, color: C.body, margin: '0 0 16px' }}>Current mode: <strong style={{ color: mode === 'auto' ? '#16A34A' : '#D97706' }}>{mode === 'auto' ? 'AUTO' : 'MANUAL'}</strong></p>
            <div style={{ display: 'flex', gap: 10 }}>
              {(['manual', 'auto'] as const).map(m => (
                <button key={m} disabled={savingMode || mode === m} onClick={() => handleSetMode(m)}
                  style={{ ...btnStyle, background: mode === m ? (m === 'auto' ? '#DCFCE7' : '#FEF3C7') : C.bg, color: mode === m ? (m === 'auto' ? '#16A34A' : '#D97706') : C.body, border: `1px solid ${C.border}`, cursor: mode === m ? 'default' : 'pointer' }}>
                  {m === 'auto' ? '▶ AUTO' : '⏸ MANUAL'}
                </button>
              ))}
            </div>
            {modeMsg && <p style={{ fontSize: 13, color: '#16A34A', margin: '8px 0 0' }}>{modeMsg}</p>}
          </div>

          <div style={{ background: C.card, border: '1px solid #FECACA', borderRadius: 12, padding: 24 }}>
            <h2 style={{ fontFamily: SORA, fontSize: 16, fontWeight: 600, color: '#DC2626', margin: '0 0 8px' }}>Reset Positions</h2>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <p style={{ fontFamily: INTER, fontSize: 13, color: '#991B1B', margin: 0, lineHeight: 1.6 }}>
                <strong>What this does:</strong> Wipes all tracked positions and journal records for this account, then
                re-imports every open Zerodha holding/position as an <strong>Accumulator</strong> BUY entry.
                Use this to sync the app with your actual Zerodha portfolio after manual trades or a fresh start.
                <br /><strong>This cannot be undone.</strong> Must be in Manual mode.
              </p>
            </div>
            {mode === 'auto' && (
              <p style={{ fontFamily: INTER, fontSize: 13, color: '#D97706', marginBottom: 12 }}>
                ⚠ Switch to <strong>Manual</strong> mode before resetting.
              </p>
            )}
            {resetResult ? (
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
                <p style={{ fontFamily: INTER, fontSize: 13, color: '#065F46', fontWeight: 600, margin: '0 0 6px' }}>
                  ✓ Reset complete — {resetResult.seeded.length} position{resetResult.seeded.length !== 1 ? 's' : ''} imported as Accumulator
                </p>
                {resetResult.seeded.length > 0 && (
                  <ul style={{ fontFamily: INTER, fontSize: 12, color: '#065F46', margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                    {resetResult.seeded.map(s => (
                      <li key={s.symbol}>{s.symbol} — {s.qty} qty @ ₹{s.avgPrice.toFixed(2)}</li>
                    ))}
                  </ul>
                )}
                <button onClick={() => setResetResult(null)} style={{ ...btnStyle, background: 'none', border: 'none', color: '#065F46', padding: '4px 0', fontSize: 12, marginTop: 6 }}>Dismiss</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={resetConfirm}
                  onChange={e => { setResetConfirm(e.target.value); setResetError('') }}
                  placeholder='Type "RESET" to confirm'
                  disabled={mode === 'auto' || resetting}
                  style={{ ...inputStyle, width: 200, flex: 'none', fontSize: 13 }}
                />
                <button
                  onClick={handleReset}
                  disabled={resetConfirm !== 'RESET' || mode === 'auto' || resetting}
                  style={{ ...btnStyle, background: (resetConfirm === 'RESET' && mode !== 'auto' && !resetting) ? '#DC2626' : '#D1D5DB', color: '#fff', fontSize: 13 }}
                >
                  {resetting ? 'Resetting…' : '↺ Reset Positions'}
                </button>
              </div>
            )}
            {resetError && <p style={{ fontFamily: INTER, fontSize: 13, color: '#DC2626', margin: '8px 0 0' }}>{resetError}</p>}
          </div>
        </div>
      )}

      {/* Strategies tab */}
      {tab === 'strategies' && (
        <StrategiesTab
          strategies={strategies}
          capitalConfig={capitalConfig}
          fixedRules={fixedRules}
          cronMode={mode}
          onModeChange={setMode}
          targetCustomerId={targetCustomerId}
          platformConfig={platformConfig}
          availableWatchlists={watchlists.map(w => ({ list_key: w.list_key, name: w.name }))}
        />
      )}

      {/* Watchlist tab */}
      {tab === 'watchlist' && <WatchlistTab watchlists={watchlists} targetCustomerId={targetCustomerId} />}

      {/* Backtest tab */}
      {tab === 'backtest' && (
        <BacktestTab
          strategies={strategies.map(s => ({ id: (s as any).strategy_key ?? s.id, name: s.name, type: s.type }))}
          targetCustomerId={targetCustomerId}
        />
      )}

      {/* Disclaimer modal */}
      {disclaimer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: C.card, borderRadius: 16, padding: 32, maxWidth: 520, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontFamily: SORA, fontSize: 18, fontWeight: 700, color: C.heading, margin: '0 0 16px' }}>Activate: {disclaimer.strategyName}</h3>
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#92400E', margin: 0, lineHeight: 1.7, fontFamily: INTER }}>
                The trading strategies provided on this platform are sample templates for informational and educational purposes only. By activating this strategy, you acknowledge and agree that: (i) all trading decisions are made solely at your discretion and are your own financial responsibility; (ii) DAlgo does not provide investment advice, financial advisory services, or securities recommendations; (iii) DAlgo is not registered with SEBI as an investment advisor or portfolio manager; (iv) you are free to modify any strategy parameters to suit your individual risk profile; and (v) past performance is not indicative of future results. All trading carries inherent risk and you may lose capital.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDisclaimer(null)} style={{ ...btnStyle, background: C.bg, color: C.body, border: `1px solid ${C.border}` }}>Cancel</button>
              <button onClick={handleDisclaimerAgree} style={{ ...btnStyle, background: C.primary, color: '#fff' }}>I Agree — Activate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
