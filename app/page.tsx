import type { CSSProperties, ReactNode } from 'react'
import type { Metadata } from 'next'
import TaglineRotator from '@/components/marketing/TaglineRotator'

export const metadata: Metadata = {
  title: 'DAlgo - The California FinTech Trading Engine',
  description:
    'Build, simulate, and automate NSE equity strategies with elegant controls, disciplined risk rails, and modern broker connectivity.',
}

const MARKETING_LINES = [
  'Precision automation for all market moods.',
  'Bull, bear, or sideways: your rules stay in control.',
  'Calm execution when markets get chaotic.',
  'Disciplined entries. Smarter exits. Zero panic clicks.',
  'Consistent process, not emotional trading.',
]

const palette = {
  ink: '#071226',
  text: '#0f172a',
  muted: '#475569',
  bg: '#f6fbff',
  card: '#ffffff',
  line: 'rgba(29, 78, 216, 0.18)',
  blue: '#2563eb',
  cyan: '#06b6d4',
  mint: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
}

const scopedCss = `
@keyframes driftA {
  0% { transform: translate3d(0,0,0); }
  50% { transform: translate3d(0,-14px,0); }
  100% { transform: translate3d(0,0,0); }
}
@keyframes driftB {
  0% { transform: translate3d(0,0,0); }
  50% { transform: translate3d(0,10px,0); }
  100% { transform: translate3d(0,0,0); }
}
@keyframes pulseGlow {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.8; }
}
@keyframes riseIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.lp-wrap {
  font-family: 'Sora', 'Inter', system-ui, sans-serif;
  color: ${palette.text};
  background:
    radial-gradient(900px 480px at 6% -12%, rgba(6,182,212,0.14), transparent 62%),
    radial-gradient(900px 520px at 98% 0%, rgba(37,99,235,0.13), transparent 60%),
    linear-gradient(180deg, #f0f8ff 0%, #f6fbff 30%, #f8fcff 100%);
}

.lp-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 86px;
  padding: 0 5vw;
  backdrop-filter: blur(16px);
  background: rgba(246, 251, 255, 0.83);
  border-bottom: 1px solid rgba(37,99,235,0.15);
}

.lp-logo {
  font-size: 2.85rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-decoration: none;
  color: ${palette.ink};
  line-height: 1;
}

.lp-links {
  display: flex;
  align-items: center;
  gap: 24px;
}

.lp-links a {
  font-size: 0.9rem;
  color: #334155;
  text-decoration: none;
}

.lp-links a:hover {
  color: ${palette.blue};
}

.lp-shell {
  width: min(1220px, 92vw);
  margin: 0 auto;
}

.lp-hero {
  padding: 56px 0 28px;
  display: grid;
  grid-template-columns: 1.04fr 0.96fr;
  gap: 34px;
  align-items: stretch;
}

.lp-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  font-size: 0.74rem;
  padding: 8px 14px;
  border: 1px solid rgba(6,182,212,0.32);
  color: #0e7490;
  background: rgba(236, 254, 255, 0.9);
}

.lp-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: ${palette.mint};
  animation: pulseGlow 1.7s ease-in-out infinite;
}

.lp-title {
  margin-top: 16px;
  font-size: clamp(2.1rem, 5.4vw, 4.3rem);
  line-height: 1.02;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: ${palette.ink};
}

.lp-title-accent {
  background: linear-gradient(95deg, #0ea5e9 0%, #2563eb 36%, #0ea5e9 70%, #14b8a6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.lp-subtitle {
  margin-top: 16px;
  color: #334155;
  max-width: 56ch;
  font-size: clamp(0.98rem, 1.7vw, 1.14rem);
  line-height: 1.7;
}

.lp-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 26px;
}

.lp-btn-primary,
.lp-btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  border-radius: 12px;
  padding: 12px 20px;
  font-size: 0.92rem;
  font-weight: 600;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.lp-btn-primary {
  color: white;
  background: linear-gradient(115deg, #0ea5e9 0%, #2563eb 48%, #1d4ed8 100%);
  box-shadow: 0 10px 25px rgba(37, 99, 235, 0.28);
}

.lp-btn-secondary {
  color: #1e3a8a;
  background: rgba(255,255,255,0.9);
  border: 1px solid rgba(37,99,235,0.25);
}

.lp-btn-primary:hover,
.lp-btn-secondary:hover {
  transform: translateY(-1px);
}

.lp-trust-row {
  margin-top: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.lp-pill {
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  color: #1e3a8a;
  background: rgba(37,99,235,0.08);
  border: 1px solid rgba(37,99,235,0.2);
}

.lp-glass {
  border-radius: 22px;
  border: 1px solid rgba(37,99,235,0.18);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.78) 100%);
  box-shadow: 0 18px 55px rgba(15, 23, 42, 0.13);
}

.lp-chart-pane {
  position: relative;
  padding: 18px;
  overflow: hidden;
}

.lp-orbA,
.lp-orbB {
  position: absolute;
  border-radius: 999px;
  filter: blur(24px);
  pointer-events: none;
}

.lp-orbA {
  width: 230px;
  height: 230px;
  right: -42px;
  top: -42px;
  background: rgba(37,99,235,0.27);
  animation: driftA 6.4s ease-in-out infinite;
}

.lp-orbB {
  width: 180px;
  height: 180px;
  left: -28px;
  bottom: -30px;
  background: rgba(20,184,166,0.28);
  animation: driftB 5.7s ease-in-out infinite;
}

.lp-chart-head {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.lp-mini-label {
  font-size: 0.73rem;
  letter-spacing: 0.02em;
  color: #0f766e;
  background: rgba(204, 251, 241, 0.9);
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(20,184,166,0.35);
}

.lp-chart-foot {
  position: relative;
  z-index: 2;
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.lp-kpi {
  border-radius: 12px;
  padding: 10px;
  background: rgba(255,255,255,0.84);
  border: 1px solid rgba(37,99,235,0.16);
}

.lp-kpi strong {
  display: block;
  font-size: 0.96rem;
  color: #0f172a;
}

.lp-kpi span {
  font-size: 0.72rem;
  color: #475569;
}

.lp-strip {
  margin-top: 18px;
  border: 1px solid rgba(37,99,235,0.16);
  border-radius: 16px;
  background: rgba(255,255,255,0.72);
  padding: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.lp-strip-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #1e293b;
  font-size: 0.82rem;
}

.lp-section {
  margin-top: 84px;
}

.lp-section-header {
  max-width: 760px;
}

.lp-section-kicker {
  font-size: 0.72rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #0e7490;
}

.lp-section-title {
  font-size: clamp(1.75rem, 4vw, 2.7rem);
  margin-top: 8px;
  letter-spacing: -0.02em;
  color: ${palette.ink};
}

.lp-section-copy {
  margin-top: 10px;
  color: #475569;
  max-width: 64ch;
}

.lp-grid-3 {
  margin-top: 24px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.lp-grid-2 {
  margin-top: 24px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.lp-feature {
  animation: riseIn 0.45s ease both;
  padding: 18px;
}

.lp-feature h3 {
  margin-top: 10px;
  font-size: 1.02rem;
  color: #0f172a;
}

.lp-feature p {
  margin-top: 8px;
  font-size: 0.9rem;
  line-height: 1.62;
  color: #475569;
}

.lp-ux-pad {
  padding: 18px;
}

.lp-control-row {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 14px;
  margin-top: 12px;
}

.lp-rail {
  border-radius: 12px;
  border: 1px solid rgba(37,99,235,0.16);
  background: rgba(255,255,255,0.86);
  padding: 12px;
}

.lp-segment {
  display: inline-grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid rgba(37,99,235,0.2);
  background: rgba(241,245,249,0.84);
}

.lp-segment span {
  text-align: center;
  font-size: 0.75rem;
  border-radius: 8px;
  padding: 8px 9px;
  color: #334155;
}

.lp-segment span[data-on='1'] {
  background: linear-gradient(120deg, #bae6fd, #bfdbfe);
  color: #1e3a8a;
  font-weight: 600;
}

.lp-range {
  margin-top: 12px;
}

.lp-range-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.76rem;
  color: #334155;
}

.lp-track {
  margin-top: 7px;
  height: 7px;
  border-radius: 999px;
  background: rgba(148,163,184,0.35);
  overflow: hidden;
}

.lp-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(95deg, #06b6d4, #2563eb);
}

.lp-chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.lp-chip {
  border-radius: 999px;
  font-size: 0.72rem;
  padding: 7px 10px;
  border: 1px solid rgba(37,99,235,0.2);
  background: rgba(255,255,255,0.92);
  color: #1e3a8a;
}

.lp-cta-band {
  margin: 88px 0 72px;
  padding: 28px;
  border-radius: 22px;
  border: 1px solid rgba(37,99,235,0.22);
  background:
    radial-gradient(340px 160px at 10% 20%, rgba(34, 211, 238, 0.24), transparent 80%),
    radial-gradient(360px 180px at 95% 90%, rgba(59, 130, 246, 0.22), transparent 80%),
    linear-gradient(135deg, #eff6ff 0%, #ecfeff 100%);
}

.lp-footer {
  padding: 24px 0 40px;
  color: #475569;
  font-size: 0.8rem;
}

.lp-footer-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 14px;
}

.lp-footer a {
  text-decoration: none;
  color: #334155;
}

.lp-footer a:hover {
  color: #1d4ed8;
}

@media (max-width: 1040px) {
  .lp-hero,
  .lp-control-row {
    grid-template-columns: 1fr;
  }
  .lp-chart-pane {
    min-height: 360px;
  }
}

@media (max-width: 880px) {
  .lp-links {
    display: none;
  }
  .lp-grid-3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .lp-footer-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .lp-nav {
    height: 74px;
  }
  .lp-logo {
    font-size: 2.2rem;
  }
  .lp-shell {
    width: min(1220px, 94vw);
  }
  .lp-hero {
    padding-top: 34px;
    gap: 18px;
  }
  .lp-grid-2,
  .lp-grid-3,
  .lp-chart-foot {
    grid-template-columns: 1fr;
  }
  .lp-section {
    margin-top: 64px;
  }
  .lp-cta-band {
    margin-top: 66px;
  }
}
`

type ActionBtnProps = {
  href: string
  variant?: 'primary' | 'secondary'
  children: ReactNode
  style?: CSSProperties
}

function ActionBtn({ href, variant = 'primary', children, style }: ActionBtnProps) {
  return (
    <a href={href} className={variant === 'primary' ? 'lp-btn-primary' : 'lp-btn-secondary'} style={style}>
      {children}
    </a>
  )
}

type SectionHeaderProps = {
  kicker: string
  title: ReactNode
  copy: string
}

function SectionHeader({ kicker, title, copy }: SectionHeaderProps) {
  return (
    <div className="lp-section-header">
      <div className="lp-section-kicker">{kicker}</div>
      <h2 className="lp-section-title">{title}</h2>
      <p className="lp-section-copy">{copy}</p>
    </div>
  )
}

function BrandWordmark({ color = '#071226' }: { color?: string }) {
  return (
    <>
      <span style={{ color }}>D</span>
      <span style={{ color: '#F59E0B' }}>A</span>
      <span style={{ color }}>lgo</span>
    </>
  )
}

export default function Page() {
  return (
    <main className="lp-wrap">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: scopedCss }} />

      <nav className="lp-nav">
        <a href="/" className="lp-logo">
          <BrandWordmark />
        </a>
        <div className="lp-links">
          <a href="#features">Platform</a>
          <a href="#ux">UX Controls</a>
          <a href="#performance">Performance</a>
          <a href="#security">Security</a>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <ActionBtn href="/login" variant="secondary" style={{ padding: '9px 14px' }}>
            Sign in
          </ActionBtn>
          <ActionBtn href="/register" style={{ padding: '9px 14px' }}>
            Start free
          </ActionBtn>
        </div>
      </nav>

      <section className="lp-shell lp-hero">
        <div>
          <div className="lp-badge">
            <span className="lp-dot" />
            <TaglineRotator lines={MARKETING_LINES} />
          </div>
          <h1 className="lp-title">
            Beautiful automation for
            <br />
            <span className="lp-title-accent">serious equity traders.</span>
          </h1>
          <p className="lp-subtitle">
            DAlgo helps you build, backtest, and execute rules-based NSE strategies with broker-native execution.
            Zero dashboard clutter, intelligent controls, and strong risk rails from day one.
          </p>
          <div className="lp-cta">
            <ActionBtn href="/register">Launch your strategy</ActionBtn>
            <ActionBtn href="#how" variant="secondary">
              See the flow
            </ActionBtn>
          </div>

          <div className="lp-trust-row">
            <span className="lp-pill">Delivery-only discipline</span>
            <span className="lp-pill">No emotional overrides</span>
            <span className="lp-pill">Zerodha / Upstox / Angel One ready</span>
          </div>
        </div>

        <div className="lp-glass lp-chart-pane">
          <div className="lp-orbA" />
          <div className="lp-orbB" />
          <div className="lp-chart-head">
            <strong style={{ color: '#0f172a', fontSize: '0.98rem' }}>Live strategy pulse</strong>
            <span className="lp-mini-label">Simulation + execution</span>
          </div>

          <svg viewBox="0 0 520 280" width="100%" height="280" style={{ position: 'relative', zIndex: 2 }}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.30" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
              </linearGradient>
            </defs>

            {[40, 85, 130, 175, 220].map(y => (
              <line key={y} x1="14" y1={y} x2="506" y2={y} stroke="rgba(37,99,235,0.14)" strokeWidth="1" />
            ))}

            <path
              d="M22 224 L72 204 L122 184 L172 194 L222 164 L272 148 L322 122 L372 114 L422 92 L472 72 L472 252 L22 252 Z"
              fill="url(#areaFill)"
            />
            <polyline
              points="22,224 72,204 122,184 172,194 222,164 272,148 322,122 372,114 422,92 472,72"
              fill="none"
              stroke="#2563eb"
              strokeWidth="3"
            />

            <circle cx="272" cy="148" r="5" fill="#10b981" />
            <circle cx="422" cy="92" r="5" fill="#10b981" />
            <circle cx="172" cy="194" r="5" fill="#ef4444" />

            <rect x="300" y="26" width="186" height="38" rx="10" fill="rgba(255,255,255,0.88)" stroke="rgba(37,99,235,0.28)" />
            <text x="314" y="49" fontSize="13" fill="#0f766e" fontFamily="Inter, sans-serif">
              PnL trend: +2.1% this month
            </text>
          </svg>

          <div className="lp-chart-foot">
            <div className="lp-kpi">
              <strong style={{ color: palette.mint }}>+2.0%</strong>
              <span>Avg monthly return</span>
            </div>
            <div className="lp-kpi">
              <strong>94%+</strong>
              <span>Win-rate in strongest cycles</span>
            </div>
            <div className="lp-kpi">
              <strong>24x7</strong>
              <span>Scanning with guardrails</span>
            </div>
          </div>
        </div>

        <div className="lp-strip" id="security">
          <div className="lp-strip-item">Encrypted API key vault</div>
          <div className="lp-strip-item">You keep custody with your broker</div>
          <div className="lp-strip-item">Rules first, panic last</div>
        </div>
      </section>

      <section className="lp-shell lp-section" id="features">
        <SectionHeader
          kicker="Platform"
          title={
            <>
              A modern fintech cockpit,
              <br />
              grounded in trading discipline.
            </>
          }
          copy="DAlgo combines strategy templates, simulation intelligence, and risk-protected execution so every click has context and every action has constraints."
        />

        <div className="lp-grid-3">
          {[
            {
              title: 'Strategy Modules',
              copy: 'Accumulator, Catalyst, and Pivotal flows with configurable entries, exits, and per-strategy capital.',
            },
            {
              title: 'Smart Backtests',
              copy: 'Run historical scenarios, inspect drawdowns, and verify behavior before a rupee goes live.',
            },
            {
              title: 'Broker Sync',
              copy: 'Plug into Zerodha, Upstox, and Angel One in minutes with account-aware execution checks.',
            },
            {
              title: 'Risk Rails',
              copy: 'Circuit breaker, falling-knife protection, daily limits, and no-loss constraints for auto mode.',
            },
            {
              title: 'Audit Timeline',
              copy: 'Every order, skip, and signal is logged for review, attribution, and reporting clarity.',
            },
            {
              title: 'Multi-device UX',
              copy: 'Large touch targets, compact cards, and responsive spacing for phones, tablets, and desktops.',
            },
          ].map((item, idx) => (
            <article key={item.title} className="lp-glass lp-feature" style={{ animationDelay: `${idx * 0.06}s` }}>
              <div style={{ fontSize: '1.45rem' }}>{['01', '02', '03', '04', '05', '06'][idx]}</div>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-shell lp-section" id="ux">
        <SectionHeader
          kicker="UX Controls"
          title={
            <>
              Smart controls that feel calm,
              <br />
              even when markets are noisy.
            </>
          }
          copy="The interface surfaces key decisions quickly: mode, exposure, risk, and strategy posture. Fast to understand on a phone, precise enough for power users."
        />

        <div className="lp-grid-2">
          <article className="lp-glass lp-ux-pad">
            <div style={{ fontWeight: 600, fontSize: '0.96rem' }}>Execution profile</div>
            <div className="lp-control-row">
              <div className="lp-rail">
                <div className="lp-segment" role="tablist" aria-label="Execution mode preview">
                  <span data-on="1">Auto</span>
                  <span>Guarded</span>
                  <span>Manual</span>
                </div>

                <div className="lp-range">
                  <div className="lp-range-label">
                    <span>Daily capital deployment</span>
                    <span>65%</span>
                  </div>
                  <div className="lp-track">
                    <span className="lp-fill" style={{ width: '65%' }} />
                  </div>
                </div>

                <div className="lp-range">
                  <div className="lp-range-label">
                    <span>Profit booking aggressiveness</span>
                    <span>Balanced</span>
                  </div>
                  <div className="lp-track">
                    <span className="lp-fill" style={{ width: '58%' }} />
                  </div>
                </div>
              </div>

              <div className="lp-rail">
                <div style={{ fontSize: '0.75rem', color: '#334155' }}>Active safety rules</div>
                <div className="lp-chip-group">
                  <span className="lp-chip">No-loss sell lock</span>
                  <span className="lp-chip">Intraday circuit break</span>
                  <span className="lp-chip">Panic-sell filter</span>
                  <span className="lp-chip">Max buys/day</span>
                </div>
              </div>
            </div>
          </article>

          <article className="lp-glass lp-ux-pad" id="performance">
            <div style={{ fontWeight: 600, fontSize: '0.96rem' }}>Performance glance</div>
            <p style={{ marginTop: 6, color: '#475569', fontSize: '0.86rem' }}>
              Clean, readable bars for account outcomes across market phases.
            </p>

            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              {[
                { year: 'FY 2022', pct: 48, tone: '#38bdf8' },
                { year: 'FY 2023', pct: 64, tone: '#22c55e' },
                { year: 'FY 2024', pct: 39, tone: '#60a5fa' },
                { year: 'FY 2025', pct: 71, tone: '#10b981' },
              ].map(item => (
                <div key={item.year}>
                  <div className="lp-range-label">
                    <span>{item.year}</span>
                    <span>{item.pct}% performance index</span>
                  </div>
                  <div className="lp-track" style={{ height: 10 }}>
                    <span className="lp-fill" style={{ width: `${item.pct}%`, background: item.tone }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="lp-chip-group" style={{ marginTop: 12 }}>
              <span className="lp-chip" style={{ borderColor: 'rgba(16,185,129,0.3)', color: '#047857' }}>
                Drawdown aware
              </span>
              <span className="lp-chip" style={{ borderColor: 'rgba(245,158,11,0.3)', color: '#b45309' }}>
                Delivery-focused
              </span>
              <span className="lp-chip" style={{ borderColor: 'rgba(239,68,68,0.3)', color: '#b91c1c' }}>
                Crash protocols ready
              </span>
            </div>
          </article>
        </div>
      </section>

      <section className="lp-shell lp-section" id="how">
        <SectionHeader
          kicker="How It Works"
          title={
            <>
              Three steps from idea
              <br />
              to automated execution.
            </>
          }
          copy="The onboarding flow is intentionally sharp and minimal: connect, configure, and deploy with confidence."
        />
        <div className="lp-grid-3">
          {[
            {
              title: 'Connect account',
              copy: 'Authorize your broker and keep full account ownership. DAlgo only executes within your rules.',
            },
            {
              title: 'Tune strategy',
              copy: 'Choose your strategy style, set capital limits, and preview outcomes using historical behavior.',
            },
            {
              title: 'Go live safely',
              copy: 'Start in guarded mode, monitor decisions, then scale automation when confidence is earned.',
            },
          ].map((step, idx) => (
            <article key={step.title} className="lp-glass lp-feature">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '999px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(37,99,235,0.12)',
                  color: '#1e3a8a',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                }}
              >
                {idx + 1}
              </div>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-shell">
        <div className="lp-cta-band">
          <div style={{ maxWidth: 760 }}>
            <div className="lp-section-kicker">Ready To Launch</div>
            <h2 className="lp-section-title" style={{ marginTop: 6 }}>
              Turn your trading process into a product.
            </h2>
            <p className="lp-section-copy">
              Bring strategy discipline, cleaner execution, and mobile-first control to your daily workflow with DAlgo.
            </p>
            <div className="lp-cta" style={{ marginTop: 18 }}>
              <ActionBtn href="/register">Create free account</ActionBtn>
              <ActionBtn href="/contact" variant="secondary">
                Talk to the team
              </ActionBtn>
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-shell lp-footer">
        <div className="lp-footer-grid">
          <div>
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
              <BrandWordmark color="#0f172a" />
            </div>
            <div>Modern algorithmic trading platform for NSE delivery equity workflows.</div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/risk">Risk disclosure</a>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
            <a href="mailto:support@dalgo.online">support@dalgo.online</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
