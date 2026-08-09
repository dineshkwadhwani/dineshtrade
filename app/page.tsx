// app/page.tsx — DAlgo public landing page (Phase 7, Task 7.1).
//
// Faithful Next.js conversion of public/landing_light.html. Per the task
// brief, colors/fonts/spacing/sizing are inline `style` props rather than
// Tailwind classes. The handful of rules plain inline styles cannot express
// — hover states, the badge-dot keyframe animation, and the mobile
// (max-width:768px) media query that collapses the grids/nav — stay as a
// small scoped <style> block using `dl-` prefixed classes copied 1:1 from
// the original CSS. Everything else (colors, type, spacing, radius) is an
// inline style object built from the same CSS custom properties the
// original file declared under :root.
//
// Static Server Component — the original HTML has no interactive script
// (the nav-menu hamburger is decorative, no click handler was ever wired),
// so no 'use client' is needed here.

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DAlgo — Trade Smarter. Automate Faster.',
  description:
    "India's AI-powered algorithmic trading platform. Automate your NSE strategies on Zerodha. No coding required.",
}

const C = {
  blue: '#3B82F6',
  blueDark: '#1D4ED8',
  blueLight: '#BFDBFE',
  teal: '#0EA5B8',
  amber: '#F59E0B',
  amberLight: '#B45309',
  green: '#16A34A',
  red: '#DC2626',
  bg: '#F8FAFF',
  bg2: '#EFF6FF',
  card: '#FFFFFF',
  border: 'rgba(59,130,246,0.15)',
  text: '#1E3A8A',
  muted: '#475569',
  subtle: '#94A3B8',
  radius: 12,
}

const FONT_SORA = "'Sora', sans-serif"
const FONT_INTER = "'Inter', sans-serif"

// Scoped, non-inline styles: hover states, the pulsing badge dot, and the
// one mobile breakpoint the original CSS defined at max-width:768px.
const RESPONSIVE_CSS = `
@keyframes dl-pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.dl-badge-dot{animation:dl-pulse 2s infinite}
.dl-nav-links a:hover{color:#1E3A8A}
.dl-nav-cta:hover{background:${C.blueDark}}
.dl-btn-primary:hover{background:${C.blueDark}}
.dl-btn-secondary:hover{border-color:${C.blue}}
.dl-feat-card:hover{border-color:#3B82F6}
.dl-footer-col-list a:hover{color:#fff}
.dl-footer-legal a:hover{color:rgba(255,255,255,0.8)}
@media(max-width:768px){
  .dl-nav-links{display:none}
  .dl-nav-menu{display:flex}
  .dl-hero-visual{display:none}
  .dl-hero-content{max-width:100%}
  .dl-stats-bar{grid-template-columns:repeat(2,1fr)}
  .dl-ps-grid,.dl-features-grid,.dl-steps-grid,.dl-perf-grid,.dl-faq-grid,.dl-footer-grid{grid-template-columns:1fr}
  .dl-steps-line{display:none}
  .dl-section{padding:60px 5vw}
}
`

function BtnPrimary({
  href,
  children,
  style,
}: {
  href: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <a
      href={href}
      className="dl-btn-primary"
      style={{
        background: C.blue,
        color: '#fff',
        padding: '13px 28px',
        borderRadius: 10,
        fontSize: 15,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        transition: 'background 0.2s',
        fontFamily: FONT_INTER,
        textDecoration: 'none',
        ...style,
      }}
    >
      {children}
    </a>
  )
}

function BtnSecondary({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="dl-btn-secondary"
      style={{
        background: '#fff',
        color: C.blueDark,
        padding: '13px 28px',
        borderRadius: 10,
        fontSize: 15,
        fontWeight: 500,
        border: '0.5px solid #BFDBFE',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        transition: 'border-color 0.2s',
        fontFamily: FONT_INTER,
        textDecoration: 'none',
      }}
    >
      {children}
    </a>
  )
}

function SectionHead({ badge, children, sub }: { badge: string; children: React.ReactNode; sub: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 56 }}>
      <div
        style={{
          display: 'inline-block',
          background: 'rgba(59,130,246,0.1)',
          border: '0.5px solid rgba(59,130,246,0.25)',
          borderRadius: 20,
          padding: '4px 14px',
          fontSize: 12,
          color: C.blueLight,
          marginBottom: 16,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {badge}
      </div>
      <h2
        style={{
          fontFamily: FONT_SORA,
          fontSize: 'clamp(28px,4vw,44px)',
          fontWeight: 700,
          color: '#1E3A8A',
          marginBottom: 12,
          letterSpacing: '-0.01em',
          lineHeight: 1.2,
        }}
      >
        {children}
      </h2>
      <p style={{ fontSize: 16, color: C.muted, maxWidth: 520, margin: '0 auto' }}>{sub}</p>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div style={{ fontFamily: FONT_INTER, background: C.bg, color: C.text, lineHeight: 1.6, overflowX: 'hidden' }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@400;600;700&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: RESPONSIVE_CSS }} />

      {/* NAV */}
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'rgba(248,250,255,0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: `0.5px solid ${C.border}`,
          padding: '0 5vw',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 60,
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: FONT_SORA,
            fontSize: 22,
            fontWeight: 700,
            color: '#1E3A8A',
            letterSpacing: '-0.02em',
            textDecoration: 'none',
          }}
        >
          D<span style={{ color: C.amber }}>A</span>lgo
        </a>
        <div className="dl-nav-links" style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          <a href="#features" style={{ fontSize: 13, color: '#475569', transition: 'color 0.2s', textDecoration: 'none' }}>
            Features
          </a>
          <a href="#how" style={{ fontSize: 13, color: '#475569', transition: 'color 0.2s', textDecoration: 'none' }}>
            How it works
          </a>
          <a href="#performance" style={{ fontSize: 13, color: '#475569', transition: 'color 0.2s', textDecoration: 'none' }}>
            Performance
          </a>
          <a href="#faq" style={{ fontSize: 13, color: '#475569', transition: 'color 0.2s', textDecoration: 'none' }}>
            FAQ
          </a>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/login" style={{ fontSize: 13, color: C.muted, textDecoration: 'none' }}>
            Sign in
          </a>
          <a
            href="/register"
            className="dl-nav-cta"
            style={{
              background: C.blue,
              color: '#fff',
              padding: '8px 20px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              transition: 'background 0.2s',
              textDecoration: 'none',
            }}
          >
            Start free
          </a>
        </div>
        <div
          className="dl-nav-menu"
          aria-label="Menu"
          style={{ display: 'none', flexDirection: 'column', gap: 4, cursor: 'pointer', padding: 4 }}
        >
          <span style={{ display: 'block', width: 20, height: 2, background: '#475569', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 20, height: 2, background: '#475569', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 20, height: 2, background: '#475569', borderRadius: 2 }} />
        </div>
      </nav>

      {/* HERO */}
      <section
        style={{
          minHeight: '92vh',
          display: 'flex',
          alignItems: 'center',
          padding: '80px 5vw 60px',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(135deg,#EFF6FF 0%,#F8FAFF 60%,#E0F2FE 100%)',
        }}
      >
        <div className="dl-hero-content" style={{ position: 'relative', zIndex: 2, maxWidth: 600 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(59,130,246,0.08)',
              border: '0.5px solid rgba(59,130,246,0.25)',
              borderRadius: 20,
              padding: '5px 14px',
              fontSize: 12,
              color: '#1D4ED8',
              marginBottom: 24,
            }}
          >
            <span
              className="dl-badge-dot"
              style={{ width: 6, height: 6, borderRadius: '50%', background: C.green }}
            />
            Now live on NSE · Zerodha · Upstox · Angel One
          </div>
          <h1
            style={{
              fontFamily: FONT_SORA,
              fontSize: 'clamp(36px,5.5vw,64px)',
              fontWeight: 700,
              color: '#1E3A8A',
              marginBottom: 8,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            Trade Smarter.
            <br />
            <em style={{ color: C.blue, fontStyle: 'normal' }}>Automate Faster.</em>
          </h1>
          <p style={{ fontSize: 'clamp(16px,2vw,20px)', color: '#334155', marginBottom: 32, maxWidth: 520, lineHeight: 1.6 }}>
            Build, backtest, and deploy trading strategies on NSE.
            <br />
            Connect your broker in 2 minutes.{' '}
            <strong style={{ color: C.amberLight, fontWeight: 500 }}>No coding required.</strong>
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <BtnPrimary href="/register">&#9654; Start trading free</BtnPrimary>
            <BtnSecondary href="#how">See how it works</BtnSecondary>
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 40, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
              <span style={{ color: C.green }}>&#10003;</span>
              Bank-grade encryption
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
              <span style={{ color: C.green }}>&#10003;</span>
              We never hold your funds
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
              <span style={{ color: C.green }}>&#10003;</span>
              Your API keys are yours
            </div>
          </div>
        </div>

        {/* Animated candlestick background */}
        <div
          className="dl-hero-visual"
          style={{
            position: 'absolute',
            right: -40,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 'min(560px,55vw)',
            opacity: 0.8,
            zIndex: 1,
            pointerEvents: 'none',
          }}
        >
          <svg style={{ width: '100%', height: 'auto' }} viewBox="0 0 560 380" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="40" y1="60" x2="540" y2="60" stroke="#BFDBFE" strokeOpacity="0.8" strokeWidth="0.5" />
            <line x1="40" y1="120" x2="540" y2="120" stroke="#BFDBFE" strokeOpacity="0.8" strokeWidth="0.5" />
            <line x1="40" y1="180" x2="540" y2="180" stroke="#BFDBFE" strokeOpacity="0.8" strokeWidth="0.5" />
            <line x1="40" y1="240" x2="540" y2="240" stroke="#BFDBFE" strokeOpacity="0.8" strokeWidth="0.5" />
            <line x1="40" y1="300" x2="540" y2="300" stroke="#BFDBFE" strokeOpacity="0.8" strokeWidth="0.5" />
            <path
              d="M60,280 L100,240 L140,220 L180,200 L220,210 L260,170 L300,150 L340,130 L380,110 L420,90 L460,75 L500,60 L500,360 L60,360 Z"
              fill="url(#chartGrad)"
            />
            <polyline
              points="60,280 100,240 140,220 180,200 220,210 260,170 300,150 340,130 380,110 420,90 460,75 500,60"
              fill="none"
              stroke="#3B82F6"
              strokeWidth="2"
            />
            {/* Candles — green */}
            <line x1="70" y1="270" x2="70" y2="295" stroke="#22C55E" strokeWidth="1" />
            <rect x="64" y="270" width="12" height="18" rx="1" fill="#22C55E" fillOpacity="0.8" />
            <line x1="110" y1="228" x2="110" y2="255" stroke="#22C55E" strokeWidth="1" />
            <rect x="104" y="230" width="12" height="18" rx="1" fill="#22C55E" fillOpacity="0.8" />
            <line x1="150" y1="212" x2="150" y2="235" stroke="#22C55E" strokeWidth="1" />
            <rect x="144" y="214" width="12" height="16" rx="1" fill="#22C55E" fillOpacity="0.8" />
            <line x1="270" y1="162" x2="270" y2="185" stroke="#22C55E" strokeWidth="1" />
            <rect x="264" y="164" width="12" height="16" rx="1" fill="#22C55E" fillOpacity="0.8" />
            <line x1="310" y1="142" x2="310" y2="165" stroke="#22C55E" strokeWidth="1" />
            <rect x="304" y="144" width="12" height="15" rx="1" fill="#22C55E" fillOpacity="0.8" />
            <line x1="350" y1="122" x2="350" y2="145" stroke="#22C55E" strokeWidth="1" />
            <rect x="344" y="124" width="12" height="15" rx="1" fill="#22C55E" fillOpacity="0.8" />
            <line x1="430" y1="82" x2="430" y2="105" stroke="#22C55E" strokeWidth="1" />
            <rect x="424" y="84" width="12" height="14" rx="1" fill="#22C55E" fillOpacity="0.8" />
            {/* Candles — red */}
            <line x1="190" y1="193" x2="190" y2="218" stroke="#EF4444" strokeWidth="1" />
            <rect x="184" y="196" width="12" height="16" rx="1" fill="#EF4444" fillOpacity="0.8" />
            <line x1="230" y1="204" x2="230" y2="225" stroke="#EF4444" strokeWidth="1" />
            <rect x="224" y="206" width="12" height="15" rx="1" fill="#EF4444" fillOpacity="0.8" />
            <line x1="390" y1="103" x2="390" y2="124" stroke="#EF4444" strokeWidth="1" />
            <rect x="384" y="106" width="12" height="14" rx="1" fill="#EF4444" fillOpacity="0.8" />
            {/* BUY signal */}
            <circle cx="260" cy="200" r="14" fill="rgba(34,197,94,0.15)" stroke="#22C55E" strokeWidth="1" />
            <text x="260" y="205" textAnchor="middle" fontSize="10" fill="#22C55E" fontFamily="Inter">
              BUY
            </text>
            {/* SELL signal */}
            <circle cx="460" cy="65" r="14" fill="rgba(239,68,68,0.15)" stroke="#EF4444" strokeWidth="1" />
            <text x="460" y="70" textAnchor="middle" fontSize="10" fill="#EF4444" fontFamily="Inter">
              SELL
            </text>
            {/* Profit label */}
            <rect
              x="370"
              y="30"
              width="100"
              height="24"
              rx="6"
              fill="rgba(34,197,94,0.12)"
              stroke="rgba(34,197,94,0.3)"
              strokeWidth="0.5"
            />
            <text x="420" y="46" textAnchor="middle" fontSize="12" fill="#22C55E" fontFamily="Inter,sans-serif">
              +2.1% this month
            </text>
            {/* Y-axis labels */}
            <text x="30" y="64" textAnchor="end" fontSize="10" fill="#475569" fontFamily="Inter">
              2450
            </text>
            <text x="30" y="124" textAnchor="end" fontSize="10" fill="#475569" fontFamily="Inter">
              2380
            </text>
            <text x="30" y="184" textAnchor="end" fontSize="10" fill="#475569" fontFamily="Inter">
              2310
            </text>
            <text x="30" y="244" textAnchor="end" fontSize="10" fill="#475569" fontFamily="Inter">
              2240
            </text>
            <text x="30" y="304" textAnchor="end" fontSize="10" fill="#475569" fontFamily="Inter">
              2170
            </text>
          </svg>
        </div>
      </section>

      {/* STATS BAR */}
      <div
        className="dl-stats-bar"
        style={{
          background: '#1E3A8A',
          padding: '24px 5vw',
          display: 'grid',
          gridTemplateColumns: 'repeat(4,1fr)',
          gap: 16,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_SORA, fontSize: 'clamp(22px,3vw,32px)', fontWeight: 700, color: C.green }}>
            ~2%
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Avg monthly returns</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_SORA, fontSize: 'clamp(22px,3vw,32px)', fontWeight: 700, color: C.blue }}>
            94%+
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Win rate in peak years</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_SORA, fontSize: 'clamp(22px,3vw,32px)', fontWeight: 700, color: C.amber }}>
            0
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Emotional trades</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_SORA, fontSize: 'clamp(22px,3vw,32px)', fontWeight: 700, color: '#fff' }}>
            24/7
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Engine runs while you sleep</div>
        </div>
      </div>

      {/* PROBLEM → SOLUTION */}
      <section id="why" className="dl-section" style={{ padding: '80px 5vw' }}>
        <SectionHead badge="Why DAlgo" sub="Every trade you make manually comes with baggage. DAlgo removes it entirely.">
          Manual trading is broken.
          <br />
          Here&apos;s the fix.
        </SectionHead>
        <div className="dl-ps-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div
            style={{
              borderRadius: C.radius,
              padding: 32,
              border: '0.5px solid transparent',
              background: 'rgba(239,68,68,0.06)',
              borderColor: 'rgba(239,68,68,0.2)',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 16 }}>&#128532;</div>
            <h3 style={{ fontFamily: FONT_SORA, fontSize: 20, fontWeight: 600, marginBottom: 12, color: '#FCA5A5' }}>
              Manual trading
            </h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
              {[
                'Emotion drives entries and exits',
                "Missed signals while you're busy",
                'Panic selling at the worst moment',
                'No discipline, no consistency',
                'Watching charts at 2AM',
              ].map(t => (
                <li key={t} style={{ fontSize: 14, color: C.muted, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ flexShrink: 0, marginTop: 2 }}>&#10007;</span> {t}
                </li>
              ))}
            </ul>
          </div>
          <div
            style={{
              borderRadius: C.radius,
              padding: 32,
              border: '0.5px solid transparent',
              background: 'rgba(34,197,94,0.06)',
              borderColor: 'rgba(34,197,94,0.2)',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 16 }}>&#9889;</div>
            <h3 style={{ fontFamily: FONT_SORA, fontSize: 20, fontWeight: 600, marginBottom: 12, color: '#86EFAC' }}>
              DAlgo automated trading
            </h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
              {[
                'Rules-based execution, zero emotion',
                'Engine runs every 3–5 minutes all day',
                'Built-in panic sell detection',
                'Consistent strategy, every single day',
                "Sleep well. DAlgo doesn't.",
              ].map(t => (
                <li key={t} style={{ fontSize: 14, color: C.muted, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ flexShrink: 0, marginTop: 2 }}>&#10003;</span> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="dl-section" style={{ padding: '80px 5vw', background: C.bg2 }}>
        <SectionHead
          badge="Features"
          sub="Built for Indian markets. Designed for retail traders who want institutional discipline."
        >
          Everything you need.
          <br />
          Nothing you don&apos;t.
        </SectionHead>
        <div className="dl-features-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
          {[
            {
              icon: '🎮',
              iconBg: 'rgba(59,130,246,0.15)',
              title: 'Three proven strategies',
              body:
                'Dip buying (Accumulator), intraday momentum (Catalyst), and breakout (Pivotal). Each with configurable entry, exit and capital rules. Copy a template, tune the parameters.',
            },
            {
              icon: '📈',
              iconBg: 'rgba(34,197,94,0.15)',
              title: 'Live backtesting',
              body:
                'Test your strategy against real NSE historical data. See P&L, win rate, drawdown, and per-trade breakdown instantly. Know it works before it goes live.',
            },
            {
              icon: '🔗',
              iconBg: 'rgba(125,216,224,0.15)',
              title: 'One-click broker connect',
              body:
                'Connect Zerodha, Upstox, or Angel One in 2 minutes. Enter your API key and the engine handles the rest. Your credentials never leave your control.',
            },
            {
              icon: '🛡',
              iconBg: 'rgba(245,158,11,0.15)',
              title: 'Built-in risk management',
              body:
                'Panic sell detection, falling knife guard, intraday circuit breaker, per-trade capital cap, daily buy/sell limits. Your capital is protected at every step.',
            },
            {
              icon: '📸',
              iconBg: 'rgba(59,130,246,0.15)',
              title: 'No-loss auto mode',
              body:
                'The engine never sells below your average cost in auto mode. Every exit is evaluated against estimated net P&L after charges. Hold until profitable.',
            },
            {
              icon: '📋',
              iconBg: 'rgba(34,197,94,0.15)',
              title: 'Full trade journal',
              body:
                'Every order, every signal, every skip — logged with strategy attribution. Download monthly reports. Know exactly why every trade happened.',
            },
          ].map(f => (
            <div
              key={f.title}
              className="dl-feat-card"
              style={{
                background: '#fff',
                border: '0.5px solid #BFDBFE',
                borderRadius: C.radius,
                padding: 28,
                transition: 'border-color 0.2s',
                boxShadow: '0 1px 4px rgba(59,130,246,0.06)',
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 18,
                  fontSize: 20,
                  background: f.iconBg,
                }}
              >
                {f.icon}
              </div>
              <h3 style={{ fontFamily: FONT_SORA, fontSize: 16, fontWeight: 600, color: '#1E3A8A', marginBottom: 8 }}>
                {f.title}
              </h3>
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="dl-section" style={{ padding: '80px 5vw', background: C.bg2 }}>
        <SectionHead badge="How it works" sub="No technical expertise required. If you can use a smartphone, you can use DAlgo.">
          From signup to live trading
          <br />
          in under 10 minutes.
        </SectionHead>
        <div
          className="dl-steps-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 32, position: 'relative' }}
        >
          <div
            className="dl-steps-line"
            style={{
              content: '""',
              position: 'absolute',
              top: 32,
              left: '17%',
              right: '17%',
              height: 0.5,
              background: 'linear-gradient(90deg,transparent,#BFDBFE,#BFDBFE,transparent)',
            }}
          />
          {[
            {
              n: 1,
              title: 'Register and verify',
              body:
                'Create your account. Complete a quick KYC. Our team reviews and activates your account — usually within 24 hours.',
            },
            {
              n: 2,
              title: 'Connect your broker',
              body:
                'Enter your Zerodha, Upstox, or Angel One API key. The engine connects to your account. You keep full control at all times.',
            },
            {
              n: 3,
              title: 'Enable strategies and go',
              body:
                'Pick your strategies, set your capital rules, switch to Auto mode. DAlgo scans the market every few minutes and places orders on your behalf.',
            },
          ].map(s => (
            <div key={s.n} style={{ textAlign: 'center', position: 'relative' }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  border: `2px solid ${C.blue}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONT_SORA,
                  fontSize: 22,
                  fontWeight: 700,
                  color: C.blue,
                  margin: '0 auto 20px',
                  background: '#fff',
                }}
              >
                {s.n}
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#1E3A8A', marginBottom: 8, fontFamily: FONT_SORA }}>
                {s.title}
              </h3>
              <p style={{ fontSize: 13, color: '#475569' }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PERFORMANCE */}
      <section id="performance" className="dl-section" style={{ padding: '80px 5vw' }}>
        <SectionHead
          badge="Track record"
          sub="These are verified P&L figures from live accounts over 6 years of NSE equity trading."
        >
          Real numbers. Real trades.
        </SectionHead>
        <div className="dl-perf-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'center' }}>
          <div
            style={{
              background: '#fff',
              border: '0.5px solid #BFDBFE',
              borderRadius: C.radius,
              padding: 28,
              boxShadow: '0 1px 4px rgba(59,130,246,0.06)',
            }}
          >
            {[
              { label: 'Total realised P&L (FY2020–2026)', val: '+₹59.3 Lakhs', color: C.green },
              { label: 'Best year return on capital', val: '20.8%', color: C.green },
              { label: 'Average monthly return', val: '~2%', color: C.green },
              { label: 'Peak win rate', val: '94–100%', color: C.blue },
              { label: 'Strategy', val: 'NSE cash equity, CNC only', color: C.amber },
              { label: 'Instruments traded', val: 'Blue-chip NSE only', color: '#fff' },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 0',
                  borderBottom: i === arr.length - 1 ? 'none' : '0.5px solid #EFF6FF',
                }}
              >
                <span style={{ fontSize: 13, color: '#475569' }}>{row.label}</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: row.color }}>{row.val}</span>
              </div>
            ))}
          </div>
          <div>
            <h2
              style={{
                fontFamily: FONT_SORA,
                fontSize: 'clamp(26px,3.5vw,38px)',
                fontWeight: 700,
                color: '#1E3A8A',
                marginBottom: 16,
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              No F&amp;O. No short selling.
              <br />
              No sleepless nights.
            </h2>
            <p style={{ fontSize: 15, color: '#334155', marginBottom: 20, lineHeight: 1.7 }}>
              DAlgo trades only NSE cash equity on delivery (CNC). No futures, no options, no leverage. Blue-chip
              stocks that always come back — bought on dips, sold at targets.
            </p>
            <p style={{ fontSize: 15, color: '#334155', marginBottom: 20, lineHeight: 1.7 }}>
              The engine applies the same rules every single day. No overrides, no gut calls, no panic. Just
              consistent, rules-based execution.
            </p>
            <BtnPrimary href="/register" style={{ display: 'inline-flex' }}>
              See your strategy&apos;s backtest &#8594;
            </BtnPrimary>
            <div
              style={{
                fontSize: 11,
                color: C.subtle,
                marginTop: 16,
                lineHeight: 1.5,
                padding: 12,
                background: C.bg,
                borderRadius: 8,
                border: '0.5px solid #BFDBFE',
              }}
            >
              Past performance is not indicative of future results. All returns shown are from live trading accounts
              and are net of brokerage and applicable charges. Trading in equity markets involves risk of capital
              loss. DAlgo is a software platform and is not a SEBI-registered investment advisor. Please read our
              Risk Disclosure before trading.
            </div>
          </div>
        </div>
      </section>

      {/* BROKER INTEGRATIONS */}
      <section className="dl-section" style={{ padding: '80px 5vw', background: C.bg2 }}>
        <SectionHead
          badge="Integrations"
          sub="Connect your existing broker account. We support all major NSE-connected brokers with live API access."
        >
          Works with your broker.
        </SectionHead>
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginTop: 40 }}>
          {[
            { dot: '#E8401C', label: 'Zerodha · Kite Connect' },
            { dot: '#6633CC', label: 'Upstox · API v2' },
            { dot: '#E8401C', label: 'Angel One · SmartAPI' },
            { dot: '#0066CC', label: 'Alice Blue · Ant API' },
            { dot: '#00C853', label: 'Dhan · HQ API' },
          ].map(b => (
            <div
              key={b.label}
              style={{
                background: '#fff',
                border: '0.5px solid #BFDBFE',
                borderRadius: 10,
                padding: '12px 24px',
                fontSize: 14,
                fontWeight: 500,
                color: '#1D4ED8',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.dot }} />
              {b.label}
            </div>
          ))}
        </div>
        <p style={{ textAlign: 'center', fontSize: 12, color: C.subtle, marginTop: 20 }}>
          More brokers added regularly. Your broker not listed?{' '}
          <a href="/contact" style={{ color: '#3B82F6' }}>
            Let us know.
          </a>
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="dl-section" style={{ padding: '80px 5vw', background: C.bg }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div
            style={{
              display: 'inline-block',
              background: 'rgba(59,130,246,0.1)',
              border: '0.5px solid rgba(59,130,246,0.25)',
              borderRadius: 20,
              padding: '4px 14px',
              fontSize: 12,
              color: C.blueLight,
              marginBottom: 16,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            FAQ
          </div>
          <h2
            style={{
              fontFamily: FONT_SORA,
              fontSize: 'clamp(28px,4vw,44px)',
              fontWeight: 700,
              color: '#1E3A8A',
              marginBottom: 12,
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
            }}
          >
            Common questions answered.
          </h2>
        </div>
        <div className="dl-faq-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 860, margin: '0 auto' }}>
          {[
            {
              q: 'Is my money safe with DAlgo?',
              a: 'We never hold your funds. All orders go directly from your broker account to NSE. DAlgo only has API access to place orders — your money stays in your Zerodha, Upstox, or Angel One account at all times.',
            },
            {
              q: 'Do I need to know how to code?',
              a: 'Not at all. DAlgo comes with three proven strategy templates. You pick one, set your capital rules, and the engine handles everything. If you do know Python, you can customise further.',
            },
            {
              q: 'Will DAlgo ever sell at a loss?',
              a: 'In auto mode, the engine never sells below your average cost unless you explicitly enable the end-of-day square-off feature. The no-loss rule is the foundation of how DAlgo works.',
            },
            {
              q: 'What happens if the market crashes?',
              a: 'DAlgo has a built-in circuit breaker. If Nifty drops more than a configured threshold, the engine pauses all new buys for the day. Panic sell detection also protects against catching falling knives.',
            },
            {
              q: 'How is DAlgo different from a PMS or advisory?',
              a: "DAlgo is a software platform, not an investment advisor. We don't manage your money — we execute the strategies you configure. You are always in full control of every parameter and can switch to manual mode anytime.",
            },
            {
              q: 'Which markets and segments does DAlgo support?',
              a: 'Currently NSE cash equity (CNC delivery) only. No F&O, no intraday MIS, no BSE at launch. This is intentional — delivery-only trading is our core philosophy.',
            },
          ].map(item => (
            <div
              key={item.q}
              style={{
                background: '#fff',
                border: '0.5px solid #BFDBFE',
                borderRadius: C.radius,
                padding: 24,
                boxShadow: '0 1px 3px rgba(59,130,246,0.05)',
              }}
            >
              <h4 style={{ fontFamily: FONT_SORA, fontSize: 14, fontWeight: 600, color: '#1E3A8A', marginBottom: 8 }}>
                {item.q}
              </h4>
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section
        style={{
          textAlign: 'center',
          padding: '100px 5vw',
          background: 'linear-gradient(135deg,#EFF6FF,#F8FAFF)',
        }}
      >
        <h2
          style={{
            fontFamily: FONT_SORA,
            fontSize: 'clamp(28px,4.5vw,52px)',
            fontWeight: 700,
            color: '#1E3A8A',
            marginBottom: 16,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          Stop trading with emotions.
          <br />
          Start trading with <em style={{ color: C.blue, fontStyle: 'normal' }}>DAlgo.</em>
        </h2>
        <p style={{ fontSize: 16, color: '#475569', marginBottom: 36, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          Join traders who let rules — not feelings — drive their portfolio.
        </p>
        <BtnPrimary href="/register" style={{ fontSize: 16, padding: '16px 40px' }}>
          Create your free account &#8594;
        </BtnPrimary>
        <div style={{ fontSize: 12, color: C.subtle, marginTop: 16 }}>
          No credit card required · Setup in under 10 minutes · Cancel anytime
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#1E3A8A', borderTop: '0.5px solid rgba(255,255,255,0.1)', padding: '60px 5vw 32px' }}>
        <div className="dl-footer-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 40, marginBottom: 48 }}>
          <div>
            <div style={{ fontFamily: FONT_SORA, fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
              D<span style={{ color: '#F59E0B' }}>A</span>lgo
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 12, lineHeight: 1.7, maxWidth: 260 }}>
              India&apos;s AI-powered algorithmic trading platform. Rules-based, emotion-free, NSE equity trading for
              retail investors.
            </p>
            <p style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              &#169; 2026 DAlgo Technologies Pvt. Ltd.
              <br />
              All rights reserved.
            </p>
          </div>
          <div>
            <h5
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 16,
              }}
            >
              Product
            </h5>
            <ul className="dl-footer-col-list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
              <li>
                <a href="#features" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  Features
                </a>
              </li>
              <li>
                <a href="#how" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  How it works
                </a>
              </li>
              <li>
                <a href="/backtest" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  Backtesting
                </a>
              </li>
              <li>
                <a href="/changelog" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  Changelog
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h5
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 16,
              }}
            >
              Company
            </h5>
            <ul className="dl-footer-col-list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
              <li>
                <a href="/about" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  About us
                </a>
              </li>
              <li>
                <a href="/blog" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  Blog
                </a>
              </li>
              <li>
                <a href="/careers" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  Careers
                </a>
              </li>
              <li>
                <a href="/contact" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  Contact
                </a>
              </li>
              <li>
                <a href="/press" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  Press kit
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h5
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 16,
              }}
            >
              Support
            </h5>
            <ul className="dl-footer-col-list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
              <li>
                <a href="/docs" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  Documentation
                </a>
              </li>
              <li>
                <a href="/faq" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  FAQ
                </a>
              </li>
              <li>
                <a href="/status" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  System status
                </a>
              </li>
              <li>
                <a href="mailto:support@dalgo.online" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', transition: 'color 0.2s', textDecoration: 'none' }}>
                  support@dalgo.online
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.4)',
            marginTop: 16,
            lineHeight: 1.6,
            padding: 16,
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 8,
            border: '0.5px solid rgba(255,255,255,0.1)',
          }}
        >
          <strong style={{ color: C.muted }}>Risk Disclosure:</strong> Trading in equity markets involves substantial
          risk of loss and is not suitable for all investors. Past performance is not indicative of future results.
          DAlgo Technologies Pvt. Ltd. is a technology platform and is not registered as a stockbroker, sub-broker, or
          investment advisor with SEBI. DAlgo does not provide investment advice or recommendations. All trading
          decisions, strategies, and parameters are set by the user. Please consult a SEBI-registered investment
          advisor before making investment decisions. By using DAlgo, you confirm that you have read and understood
          our Terms of Service, Privacy Policy, and Risk Disclosure.
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 24,
            borderTop: '0.5px solid rgba(255,255,255,0.1)',
            flexWrap: 'wrap',
            gap: 16,
            marginTop: 24,
          }}
        >
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Built with &#9829; for Indian retail traders</div>
          <div className="dl-footer-legal" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { href: '/privacy', label: 'Privacy policy' },
              { href: '/terms', label: 'Terms of service' },
              { href: '/risk', label: 'Risk disclosure' },
              { href: '/cookies', label: 'Cookie policy' },
              { href: '/refund', label: 'Refund policy' },
              { href: '/grievance', label: 'Grievance redressal' },
            ].map(l => (
              <a
                key={l.href}
                href={l.href}
                style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', transition: 'color 0.2s', textDecoration: 'none' }}
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
