'use client'
import { useEffect, useState } from 'react'

interface IndexEntry { name: string; value: string; change: string; direction: string }
interface GiftNifty { value: string; change: string; direction: string; impliedOpen?: string; signal?: string }
interface IndiaOutlook { bias: string; expectedRange?: string; strategy?: string }
interface BriefingRec { symbol: string; name?: string; cmp?: string; action?: string; source?: string; reason?: string }
interface BriefingData {
  headline?: string
  globalIndices?: IndexEntry[]
  giftNifty?: GiftNifty
  indiaOutlook?: IndiaOutlook
  topRecommendations?: BriefingRec[]
}
const C = {
  card: '#FFFFFF', border: '#BFDBFE', heading: '#1E3A8A', body: '#475569', muted: '#94A3B8',
  green: '#16A34A', greenBg: '#DCFCE7', red: '#DC2626', redBg: '#FEE2E2', amber: '#D97706', amberBg: '#FEF3C7',
}
const SORA = "'Sora', sans-serif"
const INTER = "'Inter', sans-serif"

function dirColor(d: string) { return d === 'up' ? C.green : d === 'down' ? C.red : C.amber }
function dirArrow(d: string) { return d === 'up' ? '▲' : d === 'down' ? '▼' : '—' }

// privileged=true (SA/AM): auto-fetches on mount like customer, and additionally
// shows a Refresh button to re-fetch mid-day (force=true bypasses the DB cache).
export default function DashboardBriefing({ privileged = false }: { privileged?: boolean }) {
  const [data, setData] = useState<BriefingData | null>(null)
  const [source, setSource] = useState<'ai' | 'mock' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load(force = false) {
    const params = new URLSearchParams()
    if (force) params.set('force', 'true')
    if (privileged) params.set('privileged', 'true')
    const url = `/api/dalgo/customer/daily-briefing?${params.toString()}`
    try {
      const r = await fetch(url, { cache: 'no-store' })
      const d = await r.json()
      setData(d.data ?? null)
      setSource(d.source ?? null)
      setError(d.error ?? null)
    } catch (e) {
      console.error('[DashboardBriefing] fetch failed:', e)
      setData(null)
      setError(null)
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  if (loading) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(30,58,138,0.04)', marginTop: 16 }}>
        <p style={{ color: C.muted, fontSize: 13, fontFamily: INTER }}>Loading market briefing…</p>
      </div>
    )
  }

  if (!data) {
    if (!privileged) return null
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(30,58,138,0.04)', marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p style={{ margin: '0 0 2px', fontFamily: SORA, fontWeight: 600, fontSize: 14, color: C.heading }}>Market Briefing</p>
          {error ? (
            <p style={{ margin: 0, fontSize: 12, color: C.red, fontFamily: INTER }}>AI Error: {error}</p>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: INTER }}>No briefing for today yet. Click Fetch to pull live data from AI.</p>
          )}
        </div>
        <button onClick={() => { setLoading(true); load(true).finally(() => setLoading(false)) }}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: INTER, fontWeight: 600, fontSize: 13, background: '#3B82F6', color: '#fff' }}>
          Fetch
        </button>
      </div>
    )
  }

  return (
    <>
      {/* Error banner for privileged users */}
      {error && privileged && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 12, padding: 14, marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontFamily: SORA, fontWeight: 600, fontSize: 13, color: C.red }}>⚠ AI Fetch Failed</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.red, fontFamily: INTER }}>{error}</p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: C.red, opacity: 0.8, fontFamily: INTER }}>Showing fallback data. Check quota or API limits.</p>
          </div>
        </div>
      )}
      {/* World Indices */}
      {data.globalIndices && data.globalIndices.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(30,58,138,0.04)', marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontFamily: SORA, fontSize: 16, fontWeight: 600, color: C.heading, margin: 0 }}>World Indices</h2>
              {source === 'mock' && (
                <span style={{ fontSize: 10, fontWeight: 600, fontFamily: INTER, padding: '2px 7px', borderRadius: 999, background: C.amberBg, color: C.amber }}>INDICATIVE</span>
              )}
            </div>
            {privileged && (
              <button onClick={handleRefresh} disabled={refreshing}
                style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${C.border}`, cursor: refreshing ? 'not-allowed' : 'pointer', fontFamily: INTER, fontWeight: 600, fontSize: 12, background: '#fff', color: C.heading, opacity: refreshing ? 0.6 : 1 }}>
                {refreshing ? 'Refreshing…' : '↻ Refresh'}
              </button>
            )}
          </div>

          {/* GIFT Nifty highlight row */}
          {data.giftNifty && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: '#F0F9FF', borderRadius: 8, border: '1px solid #BAE6FD', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.heading, fontFamily: INTER }}>GIFT Nifty</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: dirColor(data.giftNifty.direction), fontFamily: SORA }}>
                {data.giftNifty.value}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: dirColor(data.giftNifty.direction), fontFamily: INTER }}>
                {dirArrow(data.giftNifty.direction)} {data.giftNifty.change}
              </span>
              {data.giftNifty.impliedOpen && (
                <span style={{ fontSize: 11, color: C.muted, fontFamily: INTER }}>{data.giftNifty.impliedOpen}</span>
              )}
              {data.giftNifty.signal && (
                <span style={{
                  fontSize: 11, fontWeight: 700, fontFamily: INTER, padding: '2px 8px', borderRadius: 999,
                  background: data.giftNifty.signal === 'bullish' ? C.greenBg : data.giftNifty.signal === 'bearish' ? C.redBg : C.amberBg,
                  color:      data.giftNifty.signal === 'bullish' ? C.green  : data.giftNifty.signal === 'bearish' ? C.red    : C.amber,
                }}>{data.giftNifty.signal}</span>
              )}
            </div>
          )}

          {/* Index grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {data.globalIndices.map(idx => (
              <div key={idx.name} style={{ padding: '10px 12px', background: '#F8FAFF', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 600, color: C.muted, fontFamily: INTER }}>{idx.name}</p>
                <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 700, color: dirColor(idx.direction), fontFamily: SORA }}>{idx.value}</p>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: dirColor(idx.direction), fontFamily: INTER }}>
                  {dirArrow(idx.direction)} {idx.change}
                </p>
              </div>
            ))}
          </div>

          {/* India Outlook */}
          {data.indiaOutlook && (
            <div style={{ marginTop: 12, padding: '8px 14px', background: '#F8FAFF', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: INTER, textTransform: 'uppercase', letterSpacing: '0.05em' }}>India Outlook · </span>
              <span style={{ fontSize: 12, color: C.body, fontFamily: INTER }}>{data.indiaOutlook.strategy || `Bias: ${data.indiaOutlook.bias}`}</span>
              {data.indiaOutlook.expectedRange && (
                <span style={{ fontSize: 11, color: C.muted, fontFamily: INTER }}> · Nifty {data.indiaOutlook.expectedRange}</span>
              )}
            </div>
          )}

          {data.headline && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: C.body, fontFamily: INTER, fontStyle: 'italic' }}>{data.headline}</p>
          )}
        </div>
      )}

      {/* Broker Tips */}
      {data.topRecommendations && data.topRecommendations.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(30,58,138,0.04)', marginTop: 16 }}>
          <h2 style={{ fontFamily: SORA, fontSize: 16, fontWeight: 600, color: C.heading, margin: '0 0 14px' }}>
            Broker Tips Today
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.topRecommendations.map((rec, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', background: '#F8FAFF', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                <div style={{ minWidth: 88 }}>
                  <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: C.heading, fontFamily: SORA }}>{rec.symbol}</p>
                  {rec.cmp && <p style={{ margin: 0, fontSize: 11, color: C.muted, fontFamily: INTER }}>₹{rec.cmp}</p>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {rec.name && <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 600, color: C.body, fontFamily: INTER }}>{rec.name}</p>}
                  {rec.reason && <p style={{ margin: 0, fontSize: 12, color: C.body, fontFamily: INTER }}>{rec.reason}</p>}
                  {rec.source && <p style={{ margin: '3px 0 0', fontSize: 11, color: C.muted, fontFamily: INTER }}>via {rec.source}</p>}
                </div>
                {rec.action && (
                  <span style={{
                    flexShrink: 0, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: INTER,
                    background: rec.action === 'BUY' ? C.greenBg : C.redBg,
                    color:      rec.action === 'BUY' ? C.green   : C.red,
                  }}>{rec.action}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
