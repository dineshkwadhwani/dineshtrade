export const dynamic = 'force-dynamic'

import { getSupabaseAdmin } from '@/lib/supabase'
import { getProfile } from '@/lib/dalgoAuth'
import { isMarketOpen } from '@/lib/market'
import DashboardLiveTiles from './DashboardLiveTiles'
import DashboardBriefing from './DashboardBriefing'

const C = {
  bg: '#F8FAFF', card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A',
  body: '#475569', muted: '#94A3B8', primary: '#3B82F6',
  green: '#16A34A', greenBg: '#DCFCE7', red: '#DC2626', redBg: '#FEE2E2',
  amber: '#D97706', amberBg: '#FEF3C7',
}
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(30,58,138,0.04)', ...style }}>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px', fontFamily: INTER }}>{children}</p>
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p style={{ fontSize: 22, fontWeight: 700, color: C.heading, margin: 0, fontFamily: SORA }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: C.muted, margin: '2px 0 0', fontFamily: INTER }}>{sub}</p>}
    </div>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'green' | 'red' | 'amber' | 'blue' }) {
  const map = {
    green: { color: C.green, bg: C.greenBg },
    red: { color: C.red, bg: C.redBg },
    amber: { color: C.amber, bg: C.amberBg },
    blue: { color: C.primary, bg: '#DBEAFE' },
  }
  const { color, bg } = map[tone]
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, color, background: bg, fontFamily: INTER }}>
      {children}
    </span>
  )
}

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return '—'
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals })
}

export default async function DashboardPage() {
  const profile_session = await getProfile()
  if (!profile_session) return null
  const customerId = profile_session.id
  const admin = getSupabaseAdmin()

  const [capitalRes, instanceRes, strategiesRes, stateRes, positionsRes] = await Promise.all([
    admin.from('customer_capital_config').select('*').eq('customer_id', customerId).maybeSingle(),
    admin.from('customer_instances').select('kite_token_status, cron_mode, todays_buy_count, todays_sell_count').eq('customer_id', customerId).maybeSingle(),
    admin.from('customer_strategies').select('id, name, type, scan_interval_min').eq('customer_id', customerId).eq('active', true).order('name'),
    admin.from('customer_state').select('cron_mode, daily_buy_count, daily_sell_count, gift_nifty_change_pct').eq('customer_id', customerId).maybeSingle(),
    admin.from('customer_positions').select('symbol', { count: 'exact', head: true }).eq('customer_id', customerId),
  ])

  const cap = capitalRes.data
  const instance = instanceRes.data
  const strategies = strategiesRes.data ?? []
  const state = stateRes.data

  const market = await isMarketOpen()
  const firstName = profile_session.full_name?.split(' ')[0] ?? 'there'
  const hour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false })
  const greeting = parseInt(hour) < 12 ? 'Good morning' : parseInt(hour) < 17 ? 'Good afternoon' : 'Good evening'

  const cronMode = instance?.cron_mode ?? state?.cron_mode ?? 'manual'
  const tokenStatus = instance?.kite_token_status ?? 'missing'
  const openPositions = positionsRes.count ?? 0
  const buysToday = instance?.todays_buy_count ?? state?.daily_buy_count ?? 0
  const sellsToday = instance?.todays_sell_count ?? state?.daily_sell_count ?? 0

  return (
    <div style={{ fontFamily: INTER }}>
      {/* Welcome banner */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: SORA, fontSize: 24, fontWeight: 700, color: C.heading, margin: '0 0 4px' }}>
          {greeting}, {firstName} 👋
        </h1>
        <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}
        </p>
      </div>

      {/* Status row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Label>Market</Label>
          <Badge tone={market.open ? 'green' : 'red'}>{market.open ? 'Open' : 'Closed'}</Badge>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
          <Label>Cron</Label>
          <Badge tone={cronMode === 'auto' ? 'green' : 'amber'}>{cronMode === 'auto' ? 'AUTO' : 'MANUAL'}</Badge>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
          <Label>Zerodha</Label>
          <Badge tone={tokenStatus === 'connected' ? 'green' : 'red'}>
            {tokenStatus === 'connected' ? 'Connected' : tokenStatus === 'expired' ? 'Expired' : 'Not connected'}
          </Badge>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 20 }}>
        <Card><Stat label="Open Positions" value={openPositions} /></Card>
        <Card><Stat label="Buys Today" value={buysToday} /></Card>
        <Card><Stat label="Sells Today" value={sellsToday} /></Card>
        <DashboardLiveTiles />
      </div>

      {/* Capital config */}
      {cap && (
        <Card style={{ marginBottom: 20 }}>
          <h2 style={{ fontFamily: SORA, fontSize: 16, fontWeight: 600, color: C.heading, margin: '0 0 16px' }}>Capital Configuration</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            <Stat label="Per Trade" value={`₹${fmt(cap.per_trade)}`} />
            <Stat label="Max Positions" value={cap.max_positions} />
            <Stat label="Max Buys/Day" value={cap.max_buys_per_day} />
            <Stat label="Max Sells/Day" value={cap.max_sells_per_day} />
            <Stat label="Max Deploy" value={`${cap.max_deploy_pct ?? 100}%`} />
            <Stat label="Circuit Breaker" value={`${cap.circuit_breaker_pct ?? -5}%`} />
          </div>
        </Card>
      )}

      {/* Active strategies */}
      <Card>
        <h2 style={{ fontFamily: SORA, fontSize: 16, fontWeight: 600, color: C.heading, margin: '0 0 12px' }}>
          Active Strategies ({strategies.length})
        </h2>
        {strategies.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 14 }}>No active strategies configured.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {strategies.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: C.bg, borderRadius: 8 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.heading }}>{s.name}</p>
                  <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{s.type}</p>
                </div>
                <Badge tone="blue">Every {s.scan_interval_min}m</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* World Indices + Broker Tips — fetched once daily after 08:30 IST, stored in DB */}
      <DashboardBriefing />
    </div>
  )
}
