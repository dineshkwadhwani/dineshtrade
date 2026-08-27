'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

const C = { bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8', primary: '#3B82F6' }
const INTER = "'Inter', sans-serif"
const SORA = "'Sora', sans-serif"

type StrategyRow = {
  id: string; name: string; type: string; active: boolean
  scan_interval_min: number; color: string | null
  watchlist_keys: string[] | null
  params: Record<string, unknown>; exits: Record<string, unknown>
  gift_nifty_gate: Record<string, unknown> | null
}
type CapitalConfig = Record<string, unknown> | null
type FixedRule = { rule_key: string; value: string; description?: string | null; display_name?: string | null; rule_name?: string | null }

const PARAM_LABELS: Record<string, { label: string; unit?: string; type?: 'bool' | 'number' | 'text'; desc: string }> = {
  emaPeriod: { label: 'EMA Period', type: 'number', desc: 'Number of trading days used to calculate the Exponential Moving Average (EMA). Default 20.' },
  entryBelowPct: { label: 'Entry Below EMA %', unit: '%', type: 'number', desc: 'Buy signal triggers when the stock price is this % below its EMA. Lower = more aggressive.' },
  strongBuyBelowPct: { label: 'Strong Buy Below EMA %', unit: '%', type: 'number', desc: 'Second tranche buy threshold — stock must be this far below EMA for an additional buy.' },
  minDownDays: { label: 'Min Down Days', type: 'number', desc: 'Minimum consecutive days the stock must have closed lower before a buy signal is valid.' },
  capitulationFloorPct: { label: 'Capitulation Floor %', unit: '%', type: 'number', desc: 'Stocks more than this % below their EMA are skipped (news-driven crash, not mean reversion).' },
  tranche2AboveEMAPct: { label: 'Tranche 2 Exit Above EMA %', unit: '%', type: 'number', desc: 'Second tranche sell target: sell remaining quantity when price reaches EMA + this %.' },
  reactiveDrop: { label: 'Reactive Drop Trigger %', unit: '%', type: 'number', desc: 'Intraday drop % that triggers a reactive dip re-scan for List A stocks.' },
  reactiveIntervalMin: { label: 'Reactive Scan Interval', unit: 'min', type: 'number', desc: 'How often (in minutes) the reactive dip scan fires during market hours.' },
  firesOnAnyMode: { label: 'Fires on Any Market Mode', type: 'bool', desc: 'When Yes, this strategy runs regardless of the GIFT Nifty market mode (bullish/dip). When No, mode gate applies.' },
  retraceAfterHit: { label: 'Allow Retrace After Target Hit', type: 'bool', desc: 'When Yes, a sell is allowed even after the price briefly touched the target and retraced back above entry.' },
  retractPercentAllowed: { label: 'Max Retrace Allowed', unit: '%', type: 'number', desc: 'How far below the target the price can retrace and still trigger a sell. Only applies when Retrace After Hit is Yes.' },
  minDayGainPct: { label: 'Min Day Gain %', unit: '%', type: 'number', desc: 'Minimum intraday price gain required for a buy signal. Filters out flat or negative days.' },
  maxDayGainPct: { label: 'Max Day Gain %', unit: '%', type: 'number', desc: 'Maximum intraday gain allowed. Stocks already up more than this are considered overextended.' },
  consecutiveCandles: { label: 'Consecutive Rising Candles', type: 'number', desc: 'Minimum number of consecutive rising 5-minute candles required to confirm bullish momentum.' },
  emaProximityPct: { label: 'EMA Proximity %', unit: '%', type: 'number', desc: 'Stock price must be within this % of the EMA (above or below) to qualify as a momentum entry.' },
  volumeAvgDays: { label: 'Volume Average Days', type: 'number', desc: 'Number of past trading days used to compute the average volume baseline for volume surge checks.' },
  scanStartHHMM: { label: 'Scan Start Time', type: 'text', desc: 'IST time when buy scanning begins for this strategy (HH:MM format, e.g. 09:30).' },
  scanEndHHMM: { label: 'Scan End Time', type: 'text', desc: 'IST time when buy scanning stops for this strategy (HH:MM format, e.g. 14:30).' },
  deliveryHandoffDays: { label: 'Delivery Handoff Days', unit: 'days', type: 'number', desc: 'Number of calendar days after the first buy before the position is handed off to the Accumulator strategy.' },
  exitSameDayTime: { label: 'EOD Exit Time', type: 'text', desc: 'IST time from which end-of-day exit logic activates (HH:MM format). Checks every 5-minute tick after this time.' },
  exitSameDayOnPositive: { label: 'Exit Same Day if Positive', type: 'bool', desc: 'When Yes, sells the position at EOD time only if the net P&L after charges is still positive.' },
  squareOffEOD: { label: 'Square Off at EOD', type: 'bool', desc: 'When Yes, forces all positions to close at EOD time regardless of P&L (bypasses the no-loss gate).' },
  recentHighDays: { label: 'Ceiling High Days', type: 'number', desc: 'Lookback window (in trading days) used to compute the recent high for the ceiling filter.' },
  ceilingBufferPct: { label: 'Ceiling Buffer %', unit: '%', type: 'number', desc: 'A stock within this % buffer of its N-day high is skipped — too close to resistance.' },
  t1Pct: { label: 'Target 1 %', unit: '%', type: 'number', desc: 'First exit target: sell 50% of the position when this % gain from entry is reached.' },
  t2Pct: { label: 'Target 2 %', unit: '%', type: 'number', desc: 'Second exit target: sell remaining position when this % gain from entry is reached.' },
}

const CAPITAL_LABELS: Record<string, { label: string; unit?: string; desc: string; type?: 'bool' | 'number' | 'text' }> = {
  per_trade: { label: 'Per Trade', unit: '₹', desc: 'Maximum capital deployed per single auto-buy order.' },
  max_buys_per_day: { label: 'Max Buys / Day', desc: 'Total auto-buy orders allowed per calendar day across all strategies.' },
  max_sells_per_day: { label: 'Max Sells / Day', desc: 'Total auto-sell orders allowed per calendar day across all strategies.' },
  max_positions: { label: 'Max Open Positions', desc: 'Maximum number of simultaneously open positions across all strategies and accounts.' },
  max_buys_per_symbol: { label: 'Max Buys / Symbol', desc: 'Maximum number of times the cron can auto-buy the same stock (pyramid cap).' },
  min_drop_between_buys_pct: { label: 'Min Drop Between Buys', unit: '%', desc: 'Each subsequent buy in the same stock must be at least this % below the previous buy price.' },
  max_deploy_pct: { label: 'Max Deploy %', unit: '%', desc: 'Maximum % of total capital that can be deployed at any point. Remaining is held as reserve.' },
  delivery_dp_charge: { label: 'Delivery DP Charge', unit: '₹', desc: 'Per-sell DP (Depository Participant) charge for delivery CNC orders, used in net P&L estimates.' },
  circuit_breaker_pct: { label: 'Circuit Breaker', unit: '%', desc: 'GIFT Nifty pre-market drop % that blocks all auto-BUYs for the day. Exits and manual orders are unaffected.' },
  intraday_circuit_trip_pct: { label: 'Intraday Circuit Trip', unit: '%', desc: 'Live Nifty drop from open that trips the intraday circuit and halts new auto-BUYs.' },
  intraday_circuit_resume_pct: { label: 'Intraday Circuit Resume', unit: '%', desc: 'Live Nifty recovery level that resumes auto-BUYs after an intraday circuit trip (hysteresis).' },
  panic_drop_pct: { label: 'Panic Drop %', unit: '%', desc: 'Per-symbol intraday drop from its peak within the panic window that marks it as a free-fall. Set to 0 to disable.' },
  panic_window_min: { label: 'Panic Window', unit: 'min', desc: 'Lookback window (minutes) for the panic-sell gate. Measured using 5-minute candle steps.' },
  send_skipped_emails: { label: 'Send Skipped Emails', desc: 'When Yes, skipped-trade emails will be sent for this customer (platform-level control may override).', type: 'bool' },
  skipped_email_to: { label: 'Skipped Email To', desc: 'Optional override recipient email for skipped-trade alerts for this customer.', type: 'text' },
}

function fieldBg(locked: boolean) { return locked ? '#F8FAFF' : C.card }

function ParamField({ label, desc, value, unit, type = 'number', locked, onChange }: {
  label: string; desc?: string; value: unknown; unit?: string; type?: 'bool' | 'number' | 'text'
  locked: boolean; onChange: (v: unknown) => void
}) {
  const input = type === 'bool' ? (
    <select value={String(value)} disabled={locked} onChange={e => onChange(e.target.value === 'true')}
      style={{ width: '100%', padding: '7px 10px', fontFamily: INTER, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: fieldBg(locked), color: C.body, cursor: locked ? 'default' : 'pointer' }}>
      <option value="true">Yes</option><option value="false">No</option>
    </select>
  ) : (
    <div style={{ position: 'relative' }}>
      <input type={type === 'number' ? 'number' : 'text'} value={String(value ?? '')} step="any" disabled={locked}
        onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        style={{ width: '100%', padding: unit ? '7px 32px 7px 10px' : '7px 10px', fontFamily: INTER, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: fieldBg(locked), color: C.body, boxSizing: 'border-box', outline: 'none' }} />
      {unit && <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: C.muted, pointerEvents: 'none' }}>{unit}</span>}
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 16, alignItems: 'start', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.heading }}>{label}</p>
        {desc && <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{desc}</p>}
      </div>
      <div>{input}</div>
    </div>
  )
}

function AccordionHeader({ title, subtitle, open, onClick, badge }: {
  title: string; subtitle?: string; open: boolean; onClick: () => void; badge?: React.ReactNode
}) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 18px', background: open ? '#EFF6FF' : C.card, border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: open ? '10px 10px 0 0' : 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {badge}
        <div>
          <span style={{ fontFamily: SORA, fontWeight: 600, fontSize: 14, color: C.heading }}>{title}</span>
          {subtitle && <span style={{ marginLeft: 8, fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>{subtitle}</span>}
        </div>
      </div>
      <span style={{ color: C.muted, fontSize: 14, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
    </button>
  )
}

function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

function DiffModal({ title, diffs, labels, onCancel, onConfirm }: {
  title: string; diffs: { key: string; from: unknown; to: unknown }[]
  labels: Record<string, { label: string }>; onCancel: () => void; onConfirm: () => void
}) {
  return (
    <Portal>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.card, borderRadius: 14, padding: 28, maxWidth: 480, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <h3 style={{ fontFamily: SORA, fontWeight: 700, fontSize: 17, color: C.heading, margin: '0 0 14px' }}>Confirm changes — {title}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {diffs.map(d => (
            <div key={d.key} style={{ display: 'grid', gridTemplateColumns: '40% 25% 10% 25%', gap: 4, fontSize: 13, alignItems: 'center', padding: '6px 10px', background: C.bg, borderRadius: 6 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>{labels[d.key]?.label ?? d.key}</span>
              <span style={{ color: '#DC2626', textDecoration: 'line-through', fontSize: 13 }}>{String(d.from)}</span>
              <span style={{ color: C.muted, textAlign: 'center' }}>→</span>
              <span style={{ color: '#16A34A', fontWeight: 600 }}>{String(d.to)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '9px 18px', background: C.bg, color: C.body, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '9px 18px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Save Changes</button>
        </div>
      </div>
    </div>
    </Portal>
  )
}

function diffEntries(original: Record<string, unknown>, edited: Record<string, unknown>): { key: string; from: unknown; to: unknown }[] {
  return Object.keys(edited).filter(k => String(edited[k]) !== String(original[k])).map(k => ({ key: k, from: original[k], to: edited[k] }))
}

export default function StrategiesTab({ strategies, capitalConfig, fixedRules, cronMode, onModeChange, targetCustomerId, availableWatchlists, platformConfig }: {
  strategies: StrategyRow[]
  capitalConfig: CapitalConfig
  fixedRules: FixedRule[]
  cronMode: string
  onModeChange: (m: string) => void
  targetCustomerId?: string
  availableWatchlists?: { list_key: string; name: string }[]
  platformConfig?: { key: string; value: string }[]
}) {
  const router = useRouter()
  const locked = cronMode === 'auto'
  // Single accordion open at a time. IDs: 'fixed', 'capital', or strategy.id
  const [openId, setOpenId] = useState<string | null>(null)
  const toggle = (id: string) => setOpenId(prev => prev === id ? null : id)

  // Capital state
  const [capitalDraft, setCapitalDraft] = useState<Record<string, unknown>>(capitalConfig ? { ...capitalConfig as Record<string, unknown> } : {})
  const [capitalDiff, setCapitalDiff] = useState<{ key: string; from: unknown; to: unknown }[] | null>(null)
  const [capitalMsg, setCapitalMsg] = useState('')
  const [savingCapital, setSavingCapital] = useState(false)
  const capitalOrig = capitalConfig ? { ...capitalConfig as Record<string, unknown> } : {}
  const capitalChanges = Object.keys(CAPITAL_LABELS).filter(k => String(capitalDraft[k]) !== String(capitalOrig[k])).map(k => ({ key: k, from: capitalOrig[k], to: capitalDraft[k] }))

  async function confirmCapitalSave() {
    setSavingCapital(true); setCapitalDiff(null); setCapitalMsg('')
    try {
      const res = await fetch('/api/dalgo/customer/capital', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...capitalDraft, ...(targetCustomerId ? { targetCustomerId } : {}) }) })
      const data = await res.json()
      if (!res.ok) setCapitalMsg(data.error || 'Failed.')
      else { setCapitalMsg('Saved!'); router.refresh() }
    } catch { setCapitalMsg('Connection error.') }
    finally { setSavingCapital(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* 1. Fixed Rules accordion — always read-only */}
      {fixedRules.length > 0 && (
        <div style={{ border: `1px solid ${openId === 'fixed' ? C.primary : C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <AccordionHeader title="Fixed Rules" subtitle="Platform — read only" open={openId === 'fixed'} onClick={() => toggle('fixed')} />
          {openId === 'fixed' && (
            <div style={{ padding: '16px 18px', borderTop: `1px solid ${C.border}`, background: C.card }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                {fixedRules.map(r => (
                  <div key={r.rule_key} style={{ padding: '8px 12px', background: C.bg, borderRadius: 7, border: `1px solid ${C.border}` }}>
                    <p style={{ margin: 0, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.rule_name ?? r.display_name ?? r.rule_key.replace(/_/g, ' ')}</p>
                    <p style={{ margin: '2px 0 0', fontWeight: 600, fontSize: 13, color: C.heading }}>{r.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Shared Capital accordion */}
      {capitalConfig && (
        <div style={{ border: `1px solid ${openId === 'capital' ? C.primary : C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <AccordionHeader title="Shared Capital" subtitle={locked ? 'manual mode required to edit' : undefined} open={openId === 'capital'} onClick={() => toggle('capital')} />
          {openId === 'capital' && (
            <div style={{ padding: '16px 18px', borderTop: `1px solid ${C.border}`, background: C.card }}>
              {locked && (
                <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 7, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#92400E' }}>
                  ⚠ Switch to <strong>Manual</strong> mode to edit.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {(() => {
                  const platformSkipVal = platformConfig?.find(p => p.key === 'SKIPPED_EMAILS_ENABLED')?.value
                  const platformSkipEnabled = !(platformSkipVal === 'false' || platformSkipVal === '0')
                  return Object.entries(CAPITAL_LABELS).map(([key, meta]) => {
                    const isSkipField = key === 'send_skipped_emails' || key === 'skipped_email_to'
                    const lockedForField = locked || (isSkipField && !platformSkipEnabled)
                    return (
                      <ParamField key={key} label={meta.label} desc={isSkipField && !platformSkipEnabled ? meta.desc + ' (disabled by platform policy)' : meta.desc}
                        value={capitalDraft[key] ?? ''} unit={meta.unit} type={(meta as any).type as any} locked={lockedForField} onChange={v => setCapitalDraft(d => ({ ...d, [key]: v }))} />
                    )
                  })
                })()}
              </div>
              {!locked && (
                <>
                  {capitalMsg && <p style={{ fontSize: 13, color: capitalMsg === 'Saved!' ? '#16A34A' : '#DC2626', margin: '0 0 8px' }}>{capitalMsg}</p>}
                  <button onClick={() => capitalChanges.length > 0 && setCapitalDiff(capitalChanges)} disabled={savingCapital || capitalChanges.length === 0}
                    style={{ padding: '9px 22px', background: capitalChanges.length > 0 ? C.primary : '#E2E8F0', color: capitalChanges.length > 0 ? '#fff' : C.muted, border: 'none', borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 14, cursor: capitalChanges.length > 0 ? 'pointer' : 'not-allowed' }}>
                    Review & Save Changes{capitalChanges.length > 0 ? ` (${capitalChanges.length})` : ''}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. Per-strategy accordions */}
      {strategies.map(s => (
        <StrategyAccordion key={s.id} strategy={s} locked={locked} open={openId === s.id} onToggle={() => toggle(s.id)} onSaved={() => router.refresh()} targetCustomerId={targetCustomerId} availableWatchlists={availableWatchlists} />
      ))}

      {/* Capital diff modal */}
      {capitalDiff && (
        <DiffModal title="Shared Capital" diffs={capitalDiff} labels={CAPITAL_LABELS} onCancel={() => setCapitalDiff(null)} onConfirm={confirmCapitalSave} />
      )}
    </div>
  )
}

function StrategyAccordion({ strategy, locked, open, onToggle, onSaved, targetCustomerId, availableWatchlists }: {
  strategy: StrategyRow; locked: boolean; open: boolean; onToggle: () => void; onSaved: () => void; targetCustomerId?: string
  availableWatchlists?: { list_key: string; name: string }[]
}) {
  const [params, setParams] = useState<Record<string, unknown>>({ ...((strategy.params as Record<string, unknown>) ?? {}) })
  const [exits, setExits] = useState<Record<string, unknown>>({ ...((strategy.exits as Record<string, unknown>) ?? {}) })
  const [giftGate, setGiftGate] = useState<Record<string, unknown>>({ ...((strategy.gift_nifty_gate as Record<string, unknown>) ?? { enabled: false, minPct: null, maxPct: null }) })
  const [scanInterval, setScanInterval] = useState(strategy.scan_interval_min)
  const [active, setActive] = useState(strategy.active)
  const [watchlistKeys, setWatchlistKeys] = useState<string[]>(Array.isArray(strategy.watchlist_keys) ? strategy.watchlist_keys : ['listA'])

  // Sync local form state when the parent refreshes strategy data (e.g. after reset or external save)
  const strategyParamsKey = JSON.stringify(strategy.params)
  useEffect(() => {
    setParams({ ...((strategy.params as Record<string, unknown>) ?? {}) })
    setExits({ ...((strategy.exits as Record<string, unknown>) ?? {}) })
    setGiftGate({ ...((strategy.gift_nifty_gate as Record<string, unknown>) ?? { enabled: false, minPct: null, maxPct: null }) })
    setScanInterval(strategy.scan_interval_min)
    setActive(strategy.active)
    setWatchlistKeys(Array.isArray(strategy.watchlist_keys) ? strategy.watchlist_keys : ['listA'])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyParamsKey])
  const [diff, setDiff] = useState<{ key: string; from: unknown; to: unknown }[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [showDisclaimer, setShowDisclaimer] = useState(false)
  const [msg, setMsg] = useState('')

  const origParams = (strategy.params as Record<string, unknown>) ?? {}
  const origExits = (strategy.exits as Record<string, unknown>) ?? {}

  const origGiftGate = (strategy.gift_nifty_gate as Record<string, unknown>) ?? { enabled: false, minPct: null, maxPct: null }

  // Detect changes by serialising — more reliable than String() for mixed types
  const hasParamChanges = JSON.stringify(params) !== JSON.stringify(origParams)
  const hasExitChanges = JSON.stringify(exits) !== JSON.stringify(origExits)
  const hasGiftGateChanges = JSON.stringify(giftGate) !== JSON.stringify(origGiftGate)
  const hasScalarChanges = scanInterval !== strategy.scan_interval_min || active !== strategy.active
  const origWatchlistKeys = Array.isArray(strategy.watchlist_keys) ? strategy.watchlist_keys : ['listA']
  const hasWatchlistChanges = JSON.stringify([...watchlistKeys].sort()) !== JSON.stringify([...origWatchlistKeys].sort())
  const hasChanges = hasParamChanges || hasExitChanges || hasGiftGateChanges || hasScalarChanges || hasWatchlistChanges

  // Build change list only when needed (for the diff modal)
  const paramChanges = diffEntries(origParams, params)
  const exitChanges = diffEntries(origExits, exits)
  const scalarChanges = diffEntries(
    { scan_interval_min: strategy.scan_interval_min, active: strategy.active },
    { scan_interval_min: scanInterval, active }
  )
  const changes = [...paramChanges, ...exitChanges, ...scalarChanges]

  async function confirmSave() {
    setSaving(true); setDiff(null); setMsg('')
    try {
      const res = await fetch(`/api/dalgo/customer/strategy/${strategy.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params, exits, gift_nifty_gate: giftGate, scan_interval_min: scanInterval, active, watchlist_keys: watchlistKeys, ...(targetCustomerId ? { targetCustomerId } : {}) }) })
      const data = await res.json()
      if (!res.ok) setMsg(data.error || 'Failed.')
      else { setMsg('Saved!'); onSaved() }
    } catch { setMsg('Connection error.') }
    finally { setSaving(false) }
  }

  const paramDefs = Object.entries(PARAM_LABELS).filter(([k]) => k in params && k !== 't1Pct' && k !== 't2Pct')
  const allLabels: Record<string, { label: string }> = { ...PARAM_LABELS, scan_interval_min: { label: 'Scan Interval' }, active: { label: 'Active' } }

  async function handleToggleActive(agreed: boolean) {
    setToggling(true); setMsg('')
    try {
      const res = await fetch('/api/dalgo/customer/strategy', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId: strategy.id, active: !strategy.active, agreed, ...(targetCustomerId ? { targetCustomerId } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) setMsg(data.error || 'Failed.')
      else { setMsg(''); onSaved() }
    } catch { setMsg('Connection error.') }
    finally { setToggling(false) }
  }

  async function handleReset() {
    if (!confirm(`Reset "${strategy.name}" to the master template? All customisations will be overwritten.`)) return
    setResetting(true); setMsg('')
    try {
      const res = await fetch(`/api/dalgo/customer/strategy/${strategy.id}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(targetCustomerId ? { targetCustomerId } : {}) })
      const data = await res.json()
      if (!res.ok) setMsg(data.error || 'Reset failed.')
      else { setMsg('Reset to template.'); onSaved() }
    } catch { setMsg('Connection error.') }
    finally { setResetting(false) }
  }

  return (
    <div style={{ border: `1px solid ${open ? C.primary : C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <AccordionHeader title={strategy.name} subtitle={strategy.type} open={open} onClick={onToggle}
        badge={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? '#16A34A' : '#CBD5E1', flexShrink: 0 }} />
            {strategy.watchlist_keys && strategy.watchlist_keys.length > 0 && (
              <span style={{ fontSize: 11, color: C.primary, background: '#DBEAFE', padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>
                {strategy.watchlist_keys.join(', ')}
              </span>
            )}
          </div>
        } />

      {open && (
        <div style={{ padding: '20px 18px', borderTop: `1px solid ${C.border}`, background: C.card }}>
          {locked && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 7, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#92400E' }}>
              ⚠ Switch to <strong>Manual</strong> mode to edit strategies.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <ParamField label="Active" value={active} type="bool" locked={locked} onChange={v => setActive(v as boolean)} />
            <ParamField label="Scan Interval" value={scanInterval} unit="min" locked={locked} onChange={v => setScanInterval(Number(v))} />
            {PARAM_LABELS.t1Pct && 't1Pct' in exits && <ParamField label="Target 1" value={exits.t1Pct} unit="%" locked={locked} onChange={v => setExits(p => ({ ...p, t1Pct: v }))} />}
            {PARAM_LABELS.t2Pct && 't2Pct' in exits && <ParamField label="Target 2" value={exits.t2Pct} unit="%" locked={locked} onChange={v => setExits(p => ({ ...p, t2Pct: v }))} />}
            {/* Watchlist selector */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 16, alignItems: 'start', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.heading }}>Watchlist</p>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Which watchlist(s) this strategy scans for entry signals.</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Selected pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 28 }}>
                  {watchlistKeys.length === 0 && <span style={{ fontSize: 12, color: C.muted }}>None selected</span>}
                  {watchlistKeys.map(k => {
                    const found = (availableWatchlists ?? []).find(w => w.list_key === k)
                    return (
                      <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#DBEAFE', color: C.primary, borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                        {found?.name ?? k}
                        {!locked && (
                          <button onClick={() => setWatchlistKeys(prev => prev.filter(x => x !== k))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.primary, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                        )}
                      </span>
                    )
                  })}
                </div>
                {/* Add from dropdown */}
                {!locked && (
                  <select
                    value=""
                    onChange={e => { if (e.target.value && !watchlistKeys.includes(e.target.value)) setWatchlistKeys(prev => [...prev, e.target.value]) }}
                    style={{ padding: '6px 10px', fontFamily: INTER, fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 6, color: C.body, background: C.bg, cursor: 'pointer', outline: 'none' }}>
                    <option value="">+ Add list…</option>
                    {(availableWatchlists ?? []).filter(w => !watchlistKeys.includes(w.list_key)).map(w => (
                      <option key={w.list_key} value={w.list_key}>{w.name} ({w.list_key})</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
          {paramDefs.length > 0 && (
            <>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.heading, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Parameters</p>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {paramDefs.map(([key, meta]) => (
                  <ParamField key={key} label={meta.label} desc={meta.desc} value={params[key]} unit={meta.unit} type={meta.type} locked={locked} onChange={v => setParams(p => ({ ...p, [key]: v }))} />
                ))}
              </div>
            </>
          )}
          <p style={{ fontSize: 11, fontWeight: 700, color: C.heading, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>GIFT Nifty Gate</p>
          <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
            <ParamField label="Enabled" value={giftGate.enabled} type="bool" locked={locked} onChange={v => setGiftGate(g => ({ ...g, enabled: v }))} />
            <ParamField label="Min Change %" value={giftGate.minPct ?? ''} unit="%" locked={locked} onChange={v => setGiftGate(g => ({ ...g, minPct: v === '' ? null : v }))} />
            <ParamField label="Max Change %" value={giftGate.maxPct ?? ''} unit="%" locked={locked} onChange={v => setGiftGate(g => ({ ...g, maxPct: v === '' ? null : v }))} />
          </div>

          {!locked && (
            <>
              {msg && <p style={{ fontSize: 13, color: msg.includes('Reset') || msg === 'Saved!' ? '#16A34A' : '#DC2626', margin: '0 0 8px' }}>{msg}</p>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => hasChanges && setDiff(changes)} disabled={saving || !hasChanges}
                  style={{ padding: '9px 22px', background: hasChanges ? C.primary : '#E2E8F0', color: hasChanges ? '#fff' : C.muted, border: 'none', borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 14, cursor: hasChanges ? 'pointer' : 'not-allowed' }}>
                  Review & Save Changes{hasChanges ? ` (${changes.length})` : ''}
                </button>
                <button onClick={handleReset} disabled={resetting}
                  style={{ padding: '9px 18px', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  {resetting ? 'Resetting…' : '↺ Reset to Template'}
                </button>
              </div>

              {/* Activate / Deactivate */}
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                <button
                  onClick={() => strategy.active ? handleToggleActive(false) : setShowDisclaimer(true)}
                  disabled={toggling}
                  style={{
                    padding: '10px 28px', border: 'none', borderRadius: 8, fontFamily: INTER, fontWeight: 700, fontSize: 14, cursor: toggling ? 'not-allowed' : 'pointer',
                    background: strategy.active ? '#FEE2E2' : '#DCFCE7',
                    color: strategy.active ? '#DC2626' : '#16A34A',
                  }}>
                  {toggling ? '…' : strategy.active ? '⏸ Deactivate Strategy' : '▶ Activate Strategy'}
                </button>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: C.muted }}>
                  {strategy.active ? 'Strategy is currently active — cron will scan and place orders.' : 'Strategy is inactive — cron will not scan or place orders.'}
                </p>
              </div>
            </>
          )}
        </div>
      )}
      {diff && <DiffModal title={strategy.name} diffs={diff} labels={allLabels} onCancel={() => setDiff(null)} onConfirm={confirmSave} />}

      {/* Activate disclaimer modal */}
      {showDisclaimer && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: C.card, borderRadius: 14, padding: 28, maxWidth: 520, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <h3 style={{ fontFamily: SORA, fontWeight: 700, fontSize: 17, color: C.heading, margin: '0 0 14px' }}>Activate: {strategy.name}</h3>
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#92400E', margin: 0, lineHeight: 1.7, fontFamily: INTER }}>
                The trading strategies provided on this platform are sample templates for informational and educational purposes only. By activating this strategy, you acknowledge and agree that: (i) all trading decisions are made solely at your discretion and are your own financial responsibility; (ii) DAlgo does not provide investment advice, financial advisory services, or securities recommendations; (iii) DAlgo is not registered with SEBI as an investment advisor or portfolio manager; (iv) you are free to modify any strategy parameters to suit your individual risk profile; and (v) past performance is not indicative of future results. All trading carries inherent risk and you may lose capital.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDisclaimer(false)} style={{ padding: '9px 18px', background: C.bg, color: C.body, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { setShowDisclaimer(false); handleToggleActive(true) }} style={{ padding: '9px 18px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: 8, fontFamily: INTER, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>I Agree — Activate</button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  )
}
