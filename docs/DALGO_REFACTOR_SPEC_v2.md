# DAlgo — Complete Refactor Specification
**Version:** 2.0 (Complete — No Detail Omitted)
**Date:** 09 Aug 2026
**Author:** Dinesh Wadhwani
**Status:** FINAL — Elaboration phase complete
**Purpose:** Single source of truth for Claude Code. Read this ENTIRE document before writing a single line of code. Do not assume anything not written here.

---

## PART 1 — CONTEXT AND BACKGROUND

---

## 1. What Is DAlgo

DAlgo (D = Dinesh, the founder) is an AI-powered algorithmic trading platform for Indian retail investors on NSE. It connects to broker APIs, scans watchlists for entry signals, places CNC delivery orders automatically, monitors positions for exit targets, and manages capital across multiple strategies — entirely without human intervention during market hours.

### 1.1 Core Trading Philosophy (Non-Negotiable)
- **Never sell at a loss in auto mode** — the foundational engine rule
- **Never trade F&O** — NSE cash equity CNC delivery only, always
- **Never short sell** — only buy stocks you intend to hold
- **Blue-chip stocks on dips always recover** — mean reversion is the primary strategy
- **LIFO approach** — ensure last trade on each script is always profitable
- **No intraday MIS** — delivery (CNC) orders only
- **Consistent rules-based execution** — zero emotion, zero overrides

### 1.2 Verified Track Record (Real Data — Use in Marketing)
| Account | Net Realised P&L (FY2020–2026) | Best Year ROC |
|---|---|---|
| Dinesh | ₹7,28,820 | 17.5% (FY23-24) |
| Kiran | ₹27,68,752 | 20.8% (FY23-24) |
| Sheela | ₹19,35,215 | 11.1% (FY23-24) |
| Sonia | ₹4,96,373 | 2.2% (FY24-26) |
| **TOTAL** | **₹59,28,726** | **FY23-24: ₹26.56L in one year** |

- Win rate: 94–100% in peak years
- Sheela: 96.6% win rate, 87-day average hold (gold standard)
- Average monthly return: ~2%
- Total brokerage paid over 6 years: ₹4,89,748 (7.6% of gross profit)

### 1.3 V1 Current State (Single User)
- Single user: Dinesh Wadhwani, Zerodha account (DINESH)
- JSON files on disk for all state
- Formula-based password: ddmmyyyyhh IST (changes hourly)
- Production: `https://dineshtrade.online` (Elastic IP 3.111.255.172)
- AWS EC2 ap-south-1, PM2 + Caddy, Node 20 LTS

### 1.4 What the Refactor Does
Transforms single-user JSON app into multi-tenant SaaS called DAlgo at `dalgo.online`:
1. JSON files → Supabase PostgreSQL
2. Single user → Multi-tenant with four distinct roles
3. Zerodha hardcoded → IBroker abstraction (Zerodha first, others pluggable)

### 1.5 What Does NOT Change (Preserve Exactly)
- `lib/strategyEngine.ts` — buy scan dispatcher
- `lib/strategy1.ts` — Accumulator sell monitor
- `lib/strategy2.ts` — Catalyst/Momentum sell monitor
- `lib/pivotal.ts` — Pivotal scanner + monitor
- `lib/preflight.ts` — All preflight gates (only broker API calls change)
- `lib/cronEOD.ts` — EOD square-off logic
- `lib/backtest.ts` — Backtesting engine
- `lib/ema.ts` — EMA calculations
- `lib/retrospective.ts` — Report builder
- All strategy logic, trading rules, entry/exit conditions
- All charge estimation calculations

---

## 2. App Identity and Branding

### 2.1 Identity
- **Name:** DAlgo (D = Dinesh)
- **Config key:** `DALGO_APP_NAME` in platform_config table
- **Domain:** dalgo.online
- **Tagline:** "Trade Smarter. Automate Faster."
- **Logo:** Text — "D" in Blue 900 (`#1E3A8A`), "A" in Amber 500 (`#F59E0B`), font Sora weight 700

### 2.2 Colour Palette (Locked — Dinesh's personal selection)

**Primary — Blue:**
| Shade | Hex | Usage |
|---|---|---|
| Blue 50 | `#EFF6FF` | Light backgrounds, hover fills |
| Blue 200 | `#BFDBFE` | Borders, subtle highlights |
| Blue 500 ★ | `#3B82F6` | Primary buttons, active states, links |
| Blue 700 | `#1D4ED8` | Button hover |
| Blue 900 | `#1E3A8A` | Headings, dark text |

**Secondary — Teal:**
| Shade | Hex | Usage |
|---|---|---|
| Teal 200 ★ | `#7DD8E0` | Tags, chips, info states, live indicators |
| Teal 500 | `#0EA5B8` | Teal hover |
| Teal 900 | `#0D5C6B` | Dark teal text |

**Accent — Amber:**
| Shade | Hex | Usage |
|---|---|---|
| Amber 200 ★ | `#FCD28A` | Strategy badges (light), warm accents |
| Amber 500 ★ | `#F59E0B` | Logo "A", highlights, warnings |
| Amber 700 | `#B45309` | Dark amber |

**Status (NEVER substitute brand colours for these):**
| Name | Hex | Usage |
|---|---|---|
| Profit | `#22C55E` | Profit P&L values |
| Profit light | `#DCFCE7` | Profit backgrounds |
| Loss | `#EF4444` | Loss P&L values |
| Loss light | `#FEE2E2` | Loss backgrounds |

**Dark mode surfaces:**
| Token | Hex |
|---|---|
| Page bg | `#050D1A` |
| Card bg | `#0D1B3E` |
| Nav bg | `#0A1628` |
| Border | `rgba(59,130,246,0.18)` |

**Strategy badge colours:**
| Strategy | Light bg/text | Dark bg/text |
|---|---|---|
| Accumulator (Dip) | `#DCFCE7` / `#166534` | `#14532D` / `#86EFAC` |
| Catalyst (Momentum) | `#EFF6FF` / `#1D4ED8` | `#1E3A8A` / `#BFDBFE` |
| Market Boom (Momentum) | `#E6FAFA` / `#0D5C6B` | `#0D5C6B` / `#7DD8E0` |
| Pivotal | `#FFFBEB` / `#92400E` | `#78350F` / `#FCD28A` |

### 2.3 Typography
- Headings: Sora (Google Fonts), weight 600/700
- Body/UI: Inter (Google Fonts), weight 400/500
- Numbers/mono: JetBrains Mono
- Sizes: h1=22px, h2=18px, h3=16px (weight 500). Body=16px weight 400.

### 2.4 Theme
- Default: Light mode for all new users
- Toggle: Dark mode in user menu dropdown
- Persistence: localStorage per device
- Light: `#F8FAFF` page, `#FFFFFF` cards
- Dark: `#050D1A` page, `#0D1B3E` cards
- NEVER hardcode colours — always use CSS variables

### 2.5 Mobile First
- All pages mobile-first
- Customer dashboard: optimised for mobile (primary usage)
- Admin/AM dashboards: desktop-heavy but still responsive
- Breakpoint: < 768px = mobile

---

## PART 2 — ROLES AND PERMISSIONS

---

## 3. Four Roles

### 3.1 Role Definitions

**SuperAdmin**
- Created by: Migration seed script (first one). Subsequent by other SuperAdmins.
- Multiple SuperAdmins allowed — all have identical permissions
- Uses: `www.dalgo.online`
- Full platform access including:
  - Edit Fixed Rules (warning + audit log required)
  - Edit any customer's Shared Capital (Manual mode only)
  - Publish/unpublish platform strategy templates
  - Enable/disable brokers on platform
  - View all customers' health dashboard
  - Consolidated P&L filtered by: customer, Account Manager, Broking Company
  - Platform config (Surepass KYC, SMS OTP, DB storage options)
  - Assign registrations to Account Managers
  - Create Account Managers and other SuperAdmins

**Account Manager**
- Created by: SuperAdmin only. Active immediately. No approval needed.
- Welcome email with password setup link sent on creation.
- Uses: `www.dalgo.online`
- Manages ONLY their assigned customers:
  - Review/approve/reject customer KYC (Step 1)
  - Assist with broker setup and strategy config (Step 2)
  - Click "Activate Account"
  - Edit assigned customers' Shared Capital (Manual mode only)
  - Edit assigned customers' strategy copies (Manual mode only)
  - View assigned customers' reports
  - Receive email when assigned customer changes strategy
  - CC on token-missing alerts for assigned customers

**Broking Company**
- Physical stock broker or sub-broker (NOT the technology broker like Zerodha)
- Example: "John Doe Financial Services" brings 20 retail clients
- Self-registers (same two-step approval as Customer)
- Uses: `www.dalgo.online`
- Can: Register customers on behalf of clients (fills full registration form), view own clients' capital config (read only), view own clients' strategy templates (read only), view own clients' P&L reports
- Cannot: Edit capital config or strategies, see other BCs' customers

**Customer**
- The end trader whose money is being invested
- Self-registers OR Broking Company registers on their behalf
- Requires two-step approval before trading
- Uses: Their own `customername.dalgo.online` instance
- Can: View own dashboard/holdings/positions/orders, edit own strategy copies (Manual mode only), add/remove symbols from personal watchlists, enable/disable own strategies
- Cannot: See any other customer's data, edit Fixed Rules, edit Shared Capital

### 3.2 Access Matrix

| Feature | SuperAdmin | Account Manager | Broking Company | Customer |
|---|---|---|---|---|
| Fixed Rules — view | ✅ | ✅ Read only | ✅ Read only | ✅ Read only |
| Fixed Rules — edit | ✅ Warning+audit | ❌ | ❌ | ❌ |
| Shared Capital — view | ✅ All | ✅ Assigned | ✅ Their customers | ✅ Own only |
| Shared Capital — edit | ✅ | ✅ Manual mode | ❌ | ❌ |
| Platform templates — create/publish | ✅ | ❌ | ❌ | ❌ |
| Customer strategy copies — edit | ✅ | ✅ Manual mode | ❌ | ✅ Manual mode |
| Register a customer | ✅ | ✅ | ✅ Their customers | ❌ |
| Approve KYC Step 1 | ✅ | ✅ Assigned | ❌ | ❌ |
| Activate account Step 2 | ✅ | ✅ Assigned | ❌ | ❌ |
| View P&L reports | ✅ All | ✅ Assigned | ✅ Their customers | ✅ Own |
| System health dashboard | ✅ | ❌ | ❌ | ❌ |
| Audit log | ✅ | ❌ | ❌ | ❌ |
| Broker management | ✅ | ❌ | ❌ | ❌ |
| Create Account Managers | ✅ | ❌ | ❌ | ❌ |

### 3.3 Strategy Edit Lock Rule (Critical)
When customer's cron is in **Auto mode** — NOBODY can edit that customer's strategy config or Shared Capital. Not the customer, not their AM, not SuperAdmin.

UI shows: *"Switch to Manual mode to edit strategies or capital configuration. This prevents configuration changes during live trading."*

Only way to unlock: customer (or AM on behalf) switches to Manual mode.

### 3.4 Strategy Change Notification
Every time a customer saves a strategy change:
- Automatic email to their assigned Account Manager
- Contains: customer name, strategy name, what changed (before/after), timestamp
- AM does NOT approve — email is informational only

### 3.5 Customer Reassignment
- SuperAdmin can move customers between Account Managers
- No cap on customers per AM
- New AM notified by email, old AM loses access

---

## PART 3 — REGISTRATION AND ONBOARDING

---

## 4. Registration Flows

### 4.1 Customer Registration Form Fields
1. Email address — required, unique, Email OTP verified
2. Mobile number — required (SMS OTP — V2, TODO in code)
3. Name as in Aadhar card — required
4. Date of birth — required, date picker
5. Address — required
6. City — required
7. State — required, dropdown (all Indian states)
8. Pincode — required, 6 digits
9. Aadhar card number — required, 12 digits (masked after entry)
10. Aadhar front image — required (JPEG/PNG/PDF, max 5MB)
11. Aadhar back image — required (JPEG/PNG/PDF, max 5MB)

**Surepass V2 Aadhar validation:** Configurable ON/OFF via `SUREPASS_KYC_ENABLED` platform config. Default OFF. When ON: full name-match via Surepass API V2. When OFF: images stored but not validated. TODO comment in code for Surepass integration.

**Registration disclaimer** (from `DALGO_REGISTRATION_DISCLAIMER` config):
> *"DAlgo is a software platform that enables automated trading. We are not a SEBI-registered investment advisor and do not provide investment advice. All trading strategies, parameters, and decisions are yours. By registering, you confirm you have read and understood our Terms of Service, Privacy Policy, and Risk Disclosure."*

### 4.2 Broking Company Registration Form
**Section 1 — Company Details:**
1. Company name, 2. GST number, 3. Company registration number, 4. Company address, 5. City, 6. State, 7. Pincode, 8. Company email, 9. Company mobile

**Section 2 — Authorised Person KYC** (same as Customer Aadhar fields):
10. Name as in Aadhar, 11. DOB, 12. Aadhar number, 13. Aadhar front, 14. Aadhar back

### 4.3 Broking Company Registering a Customer
- BC fills entire Customer Registration Form on behalf of client
- Customer does NOT need to be present
- Email OTP still sent to customer's email (customer verifies own OTP)
- BC automatically recorded as `broking_company_id` on customer profile

### 4.4 Email on Registration
To: Customer. Subject: "Your DAlgo application has been submitted."
Body: Under review, 1–2 business days, contact support@dalgo.online.

### 4.5 Two-Step Approval Flow

**Step 1 — Identity Verification:**
```
Customer submits + OTP verified → Status: under_review
→ Email to customer: "Under review"
→ SuperAdmin sees in /admin/registrations
→ SA assigns to Account Manager
→ AM gets email notification
→ AM reviews: all fields + Aadhar images + Surepass result
→ AM clicks "Approve Identity"
    → Status: identity_verified
    → Email to customer: "Identity verified, complete setup"
→ OR AM clicks "Reject" (reason required)
    → Status: rejected
    → Email to customer with rejection reason
    → Customer can re-apply (new registration record)
```

**Step 2 — Broker Setup and Account Activation:**
```
Customer logs in → sees "Complete Your Setup" banner
→ SCREEN 1: Broker Setup
    - Select broker (V1: Zerodha only, others "Coming Soon")
    - Enter API Key + API Secret
    - Helper: "Zerodha → Kite Connect → Create App → Copy Key/Secret"
    - Keys AES-256 encrypted before storing
    - "Test Connection" button
→ SCREEN 2: Strategy Setup
    - All published platform strategies listed with details
    - Customer clicks Enable → confirmation dialog (DALGO_STRATEGY_DISCLAIMER)
    - Capital config set per strategy (perTrade, maxPositions, etc.)
    - Capital config is part of strategy activation, not a separate screen
→ Account Manager reviews setup
→ AM clicks "Activate Account"
    → Status: active
    → EC2 provisioning (manual V1)
    → Email to customer: "Account active. Log in at www.dalgo.online"
```

### 4.6 Customer Status State Machine
```
pending → under_review → identity_verified → active
                               ↓
                           rejected (can re-apply)
```

### 4.7 Holding Page (Under Review State)
While status is `under_review` or `identity_verified`:
- Customer sees holding page at www.dalgo.online
- Current status displayed with badge
- "Usually 1–2 business days" note
- Support email link
- No trading features accessible

---

## PART 4 — DEPLOYMENT ARCHITECTURE

---

## 5. Deployment Architecture

### 5.1 Two-Tier Model

**Tier 1 — Main Instance (www.dalgo.online)**
- Always running. Never trades.
- Also serves dinesh.dalgo.online (same EC2, same Elastic IP)
- `CRON_ENABLED=false`, `INSTANCE_TYPE=main`
- Handles: auth, registration, approval, admin dashboards

**Tier 2 — Customer Instances (customername.dalgo.online)**
- One per customer. Has own Elastic IP (Zerodha whitelist requirement).
- `CRON_ENABLED=true`, `INSTANCE_TYPE=customer`
- Handles: customer trading dashboard + cron for that customer only

**Dinesh's special case:**
- `www.dalgo.online` and `dinesh.dalgo.online` → same EC2, same Elastic IP
- `INSTANCE_TYPE=both`, `CRON_ENABLED=true`, `CUSTOMER_ID=dinesh-uuid`

### 5.2 Login and Redirect Flow (All Users)
```
ALL USERS → www.dalgo.online/login
         ↓
Email + password → Supabase Auth
         ↓
Role = superadmin/account_manager/broking_company:
  Stay on www.dalgo.online → appropriate dashboard
         ↓
Role = customer:
  Main instance reads customer's instance_url from Supabase
  Generates SHORT-LIVED SIGNED JWT (60 seconds, one-time use)
  JWT: { customerId, email, role, issuedAt, expiresAt }
  Signed with SHARED_SSO_SECRET
         ↓
  Redirect: customername.dalgo.online/sso?token=eyJhbGc...
         ↓
  Customer instance validates:
    1. Signature valid (SHARED_SSO_SECRET)
    2. Not expired (< 60 seconds)
    3. Not already used (check sso_tokens table)
    4. customerId matches this instance's CUSTOMER_ID env var
  All valid → mark used → issue session cookie → show dashboard
  Any invalid → redirect to www.dalgo.online/login
```

### 5.3 DNS Setup
```
www.dalgo.online         → 3.111.255.172 (main EC2, existing IP)
dinesh.dalgo.online      → 3.111.255.172 (same Elastic IP as main)
customername.dalgo.online → Customer's EC2 Elastic IP
*.dalgo.online           → wildcard → Route 53 per customer
```
Caddy handles TLS via Let's Encrypt on each EC2.

### 5.4 .env Per Instance Type

**Main instance:**
```bash
INSTANCE_TYPE=main
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
ENCRYPTION_KEY=xxx          # 32-byte hex — key vault
SHARED_SSO_SECRET=xxx       # 32-byte hex — MUST be same on ALL instances
SESSION_SECRET=xxx          # 32-byte hex — can differ per instance
CRON_ENABLED=false
NODE_ENV=production
DALGO_APP_NAME=DAlgo
SMTP_USER=dinesh.k.wadhwani@gmail.com
SMTP_PASS=xxx               # Google App Password
NOTIFY_TO=dinesh.k.wadhwani@gmail.com
AI_PROVIDER=GEMINI
AI_GEMINI_API_KEY=xxx
AI_MODEL=gemini-2.5-flash
```

**Customer instance:**
```bash
INSTANCE_TYPE=customer
CUSTOMER_ID=uuid-of-this-customer   # ONLY thing that differs between instances
SUPABASE_URL=https://xxx.supabase.co   # same as main
SUPABASE_SERVICE_KEY=xxx               # same as main
ENCRYPTION_KEY=xxx                     # MUST be same as main
SHARED_SSO_SECRET=xxx                  # MUST be same as main
SESSION_SECRET=xxx                     # can differ
CRON_ENABLED=true
NODE_ENV=production
DALGO_APP_NAME=DAlgo
SMTP_USER=dinesh.k.wadhwani@gmail.com
SMTP_PASS=xxx
NOTIFY_TO=dinesh.k.wadhwani@gmail.com
AI_PROVIDER=GEMINI
AI_GEMINI_API_KEY=xxx
AI_MODEL=gemini-2.5-flash
```

**Dinesh's instance (dual role):**
```bash
INSTANCE_TYPE=both
CUSTOMER_ID=dinesh-uuid
SUPABASE_URL=xxx
SUPABASE_SERVICE_KEY=xxx
ENCRYPTION_KEY=xxx
SHARED_SSO_SECRET=xxx
SESSION_SECRET=xxx
CRON_ENABLED=true
NODE_ENV=production
DALGO_APP_NAME=DAlgo
SMTP_USER=dinesh.k.wadhwani@gmail.com
SMTP_PASS=xxx
NOTIFY_TO=dinesh.k.wadhwani@gmail.com
AI_PROVIDER=GEMINI
AI_GEMINI_API_KEY=xxx
AI_MODEL=gemini-2.5-flash
```

### 5.5 Secret Generation and Storage
All secrets generated once:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Stored in **AWS Secrets Manager** (or equivalent key vault). Never hardcoded. Never committed to git. Never human-readable strings.

`ENCRYPTION_KEY` — encrypts broker credentials in DB
`SHARED_SSO_SECRET` — signs SSO JWT tokens (same on ALL instances)
`SUPABASE_SERVICE_KEY` — Supabase connection (same on ALL instances)
`SESSION_SECRET` — signs session cookies (can differ per instance)

### 5.6 Cron Scoping
Each customer EC2 cron:
- Reads `CUSTOMER_ID` from env
- Loads ONLY that customer's data from Supabase
- All Supabase reads/writes include `customer_id = CUSTOMER_ID` filter
- Writes heartbeat to `customer_instances.last_cron_tick_at` on each tick
- Writes token status to `customer_instances.kite_token_status`

### 5.7 V1 Provisioning Runbook (Manual — Per New Customer)
1. Spin up EC2 (t3.micro, Ubuntu 22.04, ap-south-1)
2. Assign Elastic IP
3. Tell customer: "Whitelist this IP in Zerodha API settings: [IP]"
4. Git clone repo, create .env (only CUSTOMER_ID changes)
5. npm install && npm run build
6. pm2 start npm --name dalgo -- start && pm2 save && pm2 startup
7. Configure Caddy for customername.dalgo.online
8. Update customer_instances table in Supabase
9. AM marks customer activated in UI

### 5.8 Deployment Roadmap
- **V1.0:** One EC2 per customer. Simple, safe. Each has own Elastic IP.
- **V1.1:** Proxy layer — one EC2, per-customer proxy containers with individual Elastic IPs. Triggered ~10-15 customers.
- **V2.0:** Zerodha vendor partner key. One deployment, one IP. Triggered ~50 customers. Customers currently pay ₹500/month own Kite Connect key.

### 5.9 Daily Token Paste (V1 Limitation)
Zerodha tokens expire 6AM IST. No auto-refresh. Customer must paste daily:
- Customer logs in → Settings → Broker → paste access token
- Token AES-256 encrypted → stored in `broker_accounts.access_token_enc`

**9:00 AM IST Token Alert:** Cron on main instance checks all active customers. For any with missing/expired token → email to customer, CC Account Manager.
Subject: "Action required: Paste your Zerodha token before market opens at 9:15 AM"

---

## PART 5 — BROKER ABSTRACTION

---

## 6. IBroker Interface

### 6.1 Core Principle
Engine, cron, preflight — NONE ever call ZerodhaAdapter directly. Always via IBroker. Adding new broker = one adapter file + one case in factory. Zero engine changes.

### 6.2 IBroker Interface Definition
```typescript
// lib/broker/IBroker.ts

export type CandleInterval = 'day' | '5minute' | '15minute' | '60minute'
export type ProductType = 'delivery' | 'intraday'
export type OrderSide = 'BUY' | 'SELL'
export type BrokerOrderStatus = 'COMPLETE' | 'OPEN' | 'CANCELLED' | 'REJECTED' | 'PENDING'

export interface BrokerSession {
  accessToken: string
  refreshToken?: string
  expiresAt: string
}

export interface BrokerMargins { available: number; used: number }

export interface BrokerProfile { clientId: string; name: string; email: string }

export interface BrokerHolding {
  symbol: string
  quantity: number
  t1Quantity: number         // T+1 unsettled — must add to quantity for live qty
  averagePrice: number
  lastPrice: number
  pnl: number
  closePrice?: number
}

export interface BrokerPosition {
  symbol: string; quantity: number; averagePrice: number; lastPrice: number
  pnl: number; product: ProductType; buyQuantity?: number
  sellQuantity?: number; dayBuyPrice?: number; closePrice?: number
}

export interface BrokerPositions { net: BrokerPosition[]; day: BrokerPosition[] }

export interface BrokerOrder {
  orderId: string; symbol: string; side: OrderSide; quantity: number
  filledQuantity: number; averagePrice: number; status: BrokerOrderStatus
  timestamp: string; product: ProductType; tag?: string
}

export interface BrokerQuote {
  symbol: string; lastPrice: number; open: number; high: number
  low: number; close: number; volume: number
  netChange: number; netChangePct: number
}

export type BrokerQuoteMap = Record<string, BrokerQuote>

export interface BrokerCandle {
  date: string; open: number; high: number; low: number; close: number; volume: number
}

export interface BrokerOrderInput {
  symbol: string; side: OrderSide; quantity: number; product: ProductType
  orderType: 'MARKET' | 'LIMIT'; price?: number
  tag?: string               // max 20 chars (Zerodha limit)
}

export interface BrokerOrderResult { orderId: string; status: BrokerOrderStatus }

export interface IBroker {
  // Auth
  getLoginUrl(): string
  generateSession(authCode: string): Promise<BrokerSession>
  refreshSession?(refreshToken: string): Promise<BrokerSession>

  // Account
  getMargins(): Promise<BrokerMargins>
  getProfile(): Promise<BrokerProfile>

  // Portfolio
  getHoldings(): Promise<BrokerHolding[]>
  getPositions(): Promise<BrokerPositions>
  getOrders(): Promise<BrokerOrder[]>

  // Market data
  getQuotes(symbols: string[]): Promise<BrokerQuoteMap>
  getHistoricalCandles(symbol: string, from: string, to: string, interval: CandleInterval): Promise<BrokerCandle[]>
  resolveInstrumentToken(symbol: string): Promise<number>

  // Orders
  placeOrder(input: BrokerOrderInput): Promise<BrokerOrderResult>
  cancelOrder(orderId: string): Promise<void>
}
```

### 6.3 Broker Factory
```typescript
// lib/broker/index.ts
export function getBroker(customer: {
  brokerName: string
  brokerCredentials: { accessToken: string; apiKey: string }
}): IBroker {
  switch (customer.brokerName) {
    case 'zerodha': return new ZerodhaAdapter(customer.brokerCredentials)
    case 'angelone': throw new Error('Angel One adapter not yet implemented — V2')
    case 'upstox': throw new Error('Upstox adapter not yet implemented — V2')
    default: throw new Error(`Unsupported broker: ${customer.brokerName}`)
  }
}
```

### 6.4 ZerodhaAdapter Notes
Existing `lib/kite.ts` → becomes `lib/broker/ZerodhaAdapter.ts`:
- `CNC` → maps to our `delivery` product type
- Symbols get `NSE:` prefix internally for quotes
- Historical data requires instrument tokens — adapter resolves internally
- `placeOrder` adds `exchange: 'NSE'`, `validity: 'DAY'`, `market_protection: '-1'`
- Tag max 20 characters — adapter enforces `tag.slice(0, 20)`
- T+1: `holding.quantity + holding.t1_quantity`

### 6.5 Preflight Gates — Broker Migration (Critical)
`lib/preflight.ts` has private `kiteGet()` calling Zerodha directly. This MUST be replaced with `getBroker(customer).method()`. The private `kiteGet()` function must be DELETED.

### 6.6 Broker Roadmap
| Broker | API | V1 Status |
|---|---|---|
| Zerodha | Kite Connect | ✅ Build now |
| Upstox | Upstox API v2 | V2 stub |
| Angel One | SmartAPI (free) | V2 stub |
| Alice Blue | Ant API 3.0 (free) | V3 stub |
| Dhan | DhanHQ API (free) | V3 stub |
| 5paisa | 5paisa API (free) | V3 stub |

SuperAdmin enables/disables brokers via Settings → Brokers. V1: only Zerodha selectable, others "Coming Soon".

### 6.7 Zerodha Kite Connect Plan Architecture (Cost Optimised)

Zerodha offers three Kite Connect plan types:
- **Connect** — ₹500/month. Full API access: historical data, live quotes, WebSockets, order placement.
- **Personal** — Free. Order placement and reports only. No historical data, no live quotes.
- **Publisher** — Free. No API access. HTML buttons only.

**Key insight:** Market data (quotes, historical candles, GIFT Nifty) is identical for all customers — NSE prices are the same regardless of whose API key fetches them. Only order placement requires each customer's own credentials.

**DAlgo architecture leverages this:**

| Account | Zerodha Plan | Cost | Purpose |
|---|---|---|---|
| Primary (Dinesh) | Connect | ₹500/month | Fetches ALL market data for all customers |
| Family account 2 (Kiran) | Personal | Free | Order placement only |
| Family account 3 (Sonia) | Personal | Free | Order placement only |
| Family account 4 (Jaya) | Personal | Free | Order placement only |

**Cost saving: 4 accounts for ₹500/month instead of ₹2,000/month (75% reduction)**

**Primary account rules:**
- The first UUID in `CUSTOMER_IDS` is always the primary account
- Primary account MUST have a Connect plan (historical data + quotes)
- All market data fetched using primary account's credentials
- If primary account token is missing → entire tick skipped for ALL customers
  → alert email sent to all customers and their Account Managers

**Per-customer account rules:**
- Each customer uses their OWN broker credentials for order placement
- BUY orders → placed via customer's own API key → hits their own Zerodha account
- SELL orders → placed via customer's own API key → hits their own Zerodha account
- Holdings check → via customer's own API key
- Margins check → via customer's own API key

**Cron tick flow with multiple customers:**
```
1. Load primary customer's broker (first in CUSTOMER_IDS)
2. Fetch shared market data ONCE:
   - Live quotes for all watchlist symbols
   - Historical candles for EMA calculations
   - GIFT Nifty reading
   - Nifty 50 intraday data

3. Loop ALL customers in CUSTOMER_IDS:
   For each customer:
   a. Load their broker credentials from broker_accounts
   b. Construct their own IBroker instance
   c. Check their own holdings and positions
   d. Run buy scan using shared market data + their own broker for orders
   e. Run sell monitor using shared market data + their own broker for orders
   f. Run EOD logic using their own broker
   g. Write heartbeat to customer_instances for this customer

4. One customer failure never stops others (try/catch per customer)
```

**Environment variable:**
```bash
# Single customer
CUSTOMER_IDS=dinesh-uuid

# Multiple customers — first is always primary (Connect plan)
CUSTOMER_IDS=dinesh-uuid,kiran-uuid,sonia-uuid,jaya-uuid
```

**Zerodha callback URL:**
All customers use the same callback URL regardless of plan:
```
https://www.dalgo.online/api/zerodha/callback
```
The callback identifies the customer via their `dalgo_access_token` session cookie,
exchanges the `request_token` for an `access_token`, encrypts it, and saves to
`broker_accounts` in Supabase. The customer's EC2 reads the token from Supabase
on every cron tick — it doesn't matter which server saved it.

---

## PART 6 — STRATEGY LAYER

---

## 7. Strategy System

### 7.1 Three Strategy Types

**Dip (Accumulator) — type: `dip`**
- Mean-reversion: buy below 20-day EMA, sell at recovery in two tranches
- Universal parking lot — all momentum strategies hand off here after deliveryHandoffDays
- Cannot be deactivated or deleted (structural keeper)
- Exits anchored to `firstBuyPrice` — pyramid buys do NOT change exit anchor

**Momentum — type: `momentum`**
- Two platform templates: Catalyst and Market Boom
- Same engine, different params and EOD behaviour
- Catalyst: conservative, `exitSameDayOnPositive`
- Market Boom: aggressive, `squareOffEOD` (sell all at EOD regardless of P&L)

**Pivotal — type: `pivotal`**
- Livermore breakout concept
- Per-symbol config: `breakoutTriggerPrice`, `t1Pct`, `t2Pct`, `executionMode` (normal/dayEnd), optional `stopLossPrice`
- Stop loss bypasses no-loss gate: `bypassNoLossSellReason = 'pivotalStopLoss'`

### 7.2 Platform Strategy Templates (Seed Values — Fixed V1 Bugs Noted)

**Accumulator (Dip):**
```json
{
  "id": "accumulator",
  "name": "Accumulator",
  "type": "dip",
  "active": true,
  "published": true,
  "color": "#52b788",
  "scanIntervalMin": 15,
  "watchlist": ["listA"],
  "params": {
    "emaPeriod": 20,
    "entryBelowPct": 5,
    "strongBuyBelowPct": 8,
    "minDownDays": 3,
    "capitulationFloorPct": 12,
    "tranche2AboveEMAPct": 3,
    "reactiveDrop": 2,
    "reactiveIntervalMin": 30,
    "firesOnAnyMode": true,
    "maxPerSector": 3,
    "retraceAfterHit": false,
    "retractPercentAllowed": 0.25
  },
  "exits": { "t1Pct": 3, "t2Pct": 5 },
  "giftNiftyGate": { "enabled": true, "minPct": null, "maxPct": -0.5 }
}
```

**Catalyst (Momentum):**
```json
{
  "id": "catalyst",
  "name": "Catalyst (Momentum)",
  "type": "momentum",
  "active": true,
  "published": true,
  "color": "#c9a84c",
  "scanIntervalMin": 5,
  "watchlist": ["listA"],
  "params": {
    "minDayGainPct": 0.5,
    "maxDayGainPct": 0.75,
    "consecutiveCandles": 3,
    "emaProximityPct": 3,
    "volumeAvgDays": 10,
    "scanStartHHMM": "09:30",
    "scanEndHHMM": "15:00",
    "deliveryHandoffDays": 30,
    "exitSameDayTime": "15:15",
    "exitSameDayOnPositive": true,
    "squareOffEOD": false,
    "recentHighDays": 20,
    "ceilingBufferPct": 2,
    "retraceAfterHit": true,
    "retractPercentAllowed": 0.5
  },
  "exits": { "t1Pct": 1.5, "t2Pct": 2 },
  "giftNiftyGate": { "enabled": false, "minPct": null, "maxPct": null }
}
```
Note: `scanStartHHMM` is 09:30 not 09:15 — V1 bug fixed in seed.

**Market Boom (Momentum):**
```json
{
  "id": "market_boom",
  "name": "Market Boom",
  "type": "momentum",
  "active": true,
  "published": true,
  "color": "#60a5fa",
  "scanIntervalMin": 3,
  "watchlist": ["listA"],
  "params": {
    "minDayGainPct": 0.25,
    "maxDayGainPct": 0.5,
    "consecutiveCandles": 2,
    "emaProximityPct": 5,
    "volumeAvgDays": 5,
    "scanStartHHMM": "09:15",
    "scanEndHHMM": "15:15",
    "deliveryHandoffDays": 0,
    "exitSameDayTime": "15:10",
    "exitSameDayOnPositive": true,
    "squareOffEOD": true,
    "recentHighDays": 20,
    "ceilingBufferPct": 5,
    "retraceAfterHit": true,
    "retractPercentAllowed": 0.25
  },
  "exits": { "t1Pct": 1, "t2Pct": 1.5 },
  "giftNiftyGate": { "enabled": false, "minPct": null, "maxPct": null }
}
```
Notes: `squareOffEOD: true` (V1 had false — bug fixed), `deliveryHandoffDays: 0` (V1 had 15 — bug fixed).

**New Pivotal:**
```json
{
  "id": "new_pivotal",
  "name": "New Pivotal Strategy",
  "type": "pivotal",
  "active": true,
  "published": true,
  "color": "#f97316",
  "scanIntervalMin": 5,
  "watchlist": ["listA"],
  "params": {
    "consolidationDays": 10,
    "consolidationMaxRangePct": 6,
    "volumeAvgDays": 10,
    "minVolumeSurgeRatio": 1.5,
    "minDayGainPct": 1,
    "maxDayGainPct": 4,
    "breakoutConfirmCandles": 2,
    "scanStartHHMM": "10:00",
    "scanEndHHMM": "13:00",
    "minProjectedVolumeCheckHHMM": "10:00",
    "dayEndExecutionTime": "15:10",
    "deliveryHandoffDays": 15,
    "pivotalListId": "pivotalA",
    "retraceAfterHit": true,
    "retractPercentAllowed": 1
  },
  "exits": { "t1Pct": 2, "t2Pct": 3.5 },
  "giftNiftyGate": { "enabled": false, "minPct": null, "maxPct": null }
}
```
Note: `minVolumeSurgeRatio: 1.5` (V1 had 1.2 — bug fixed).

### 7.3 Platform Templates → Customer Copies
On customer activation, ALL published platform strategies are copied to `customer_strategies`:
- `platform_strategy_id` = original template ID (keeps reference)
- All params copied exactly
- `active = false` (customer must explicitly enable)
- Customer modifies their own copy independently

### 7.4 Creating a New Strategy (Customer)
1. Customer selects "Add Strategy"
2. Shown: "Dip", "Momentum", or "Pivotal" — pick type
3. Corresponding platform template copied as new customer strategy
4. Customer names it, modifies params
5. CANNOT create from scratch — always starts from template

### 7.5 Platform Template Updates Push to Customers
When SA edits and saves a published template:
- All customers with that strategy `active = true` get params auto-updated
- Email to each affected customer (48h to respond, no response = acceptance)
- AM notified with list of affected customers

### 7.6 Reset to Platform Template
Each customer strategy has "Reset to template" button:
- Warning dialog → on confirm → customer's params overwritten with current platform template
- Same for watchlists: "Reset to platform watchlist" button

### 7.7 Strategy Activation Confirmation Dialog
Text from `DALGO_STRATEGY_DISCLAIMER` config:
> *"This is a strategy template, not investment advice. By enabling this strategy you confirm that these are your own trading decisions, you have reviewed all parameters, and you take full responsibility for all trades placed by this strategy. DAlgo is a software platform only."*

### 7.8 Fixed Rules
Stored in `platform_fixed_rules` table. SuperAdmin edits. Customers/AMs cannot touch.

| Rule Key | Default | Description |
|---|---|---|
| `sell_monitor_cadence_min` | 5 | Minutes between SELL monitor runs |
| `no_short_selling` | true | Block SELL when account doesn't hold symbol |
| `no_fo_trading` | true | NSE cash equity only |
| `no_loss_sell_auto` | true | Never sell below avg cost in auto mode |
| `order_product_type` | "CNC" | Always CNC |
| `exchange` | "NSE" | NSE only |

Warning on edit:
> *"You are about to change a platform-wide engine rule. This takes effect IMMEDIATELY and affects ALL customers in Auto mode. Are you absolutely sure?"*

Every change → audit_log entry. Changes apply immediately (rules read from Supabase on each cron tick).

### 7.9 Shared Capital Config (Per Customer)

| Parameter | Default | Description |
|---|---|---|
| `perTrade` | ₹5,000 | Max ₹ per auto-mode trade |
| `maxBuysPerDay` | 3 | Shared quota across all strategies |
| `maxSellsPerDay` | 10 | Shared quota |
| `maxPositions` | 10 | Max simultaneous open positions |
| `maxBuysPerSymbol` | 3 | Pyramid cap |
| `minDropBetweenBuysPct` | 10 | % drop required between pyramid buys |
| `maxDeployPct` | 80 | Max % of capital to deploy |
| `deliveryDpCharge` | ₹15.34 | DP charge per delivery SELL day |
| `circuitBreakerPct` | -5 | GIFT Nifty % that blocks new buys |
| `intradayCircuitTripPct` | -3 | Live Nifty % drop trips circuit |
| `intradayCircuitResumePct` | -2 | Live Nifty % recovery resumes buys |
| `panicDropPct` | 0 | Per-symbol panic drop % (0 = disabled) |
| `panicWindowMin` | 0 | Panic detection lookback (0 = disabled) |

AM sets during Step 2. Customer reads only. Locked during Auto mode for all roles.

---

## PART 7 — DATABASE AND STORAGE

---

## 8. Database Architecture

### 8.1 Storage Strategy (Optimised)
Full journal at 100 users = 500MB exhausted in 2 months.
Lean design (orders + trades + signals only) = 186MB/year → free tier supports ~270 users/year.

Journal breakdown per user per day: 401 records, 88KB
- strategy_scan: 73% → configurable, default OFF
- monitor_heartbeat: 18% → dropped entirely
- signal_skipped: 6% → stored permanently
- order: 3% → stored permanently
- trade: <1% → stored permanently

### 8.2 Storage Decisions
| Record Type | Stored In | Default |
|---|---|---|
| orders | Supabase `orders` | Always on |
| trades | Supabase `trades` | Always on |
| signal_skipped | Supabase `signals_skipped` | Always on |
| strategy_scan | Supabase `strategy_scans` | OFF (SA configurable) |
| monitor_heartbeat | Dropped | OFF (not configurable) |
| Cron operational logs | EC2 flat file (rolling 7-day) | Always |

### 8.3 Daily Closes — Shared Table
NSE OHLC data identical for all users. Stored once in `daily_closes` (not per user). 506KB for 48 symbols × 60 days. Saves 48MB at 100 users.

### 8.4 Complete SQL Schema

```sql
-- ================================================================
-- DALGO DATABASE SCHEMA v2.0
-- Run this entire script in Supabase SQL Editor
-- ================================================================

-- Platform configuration
create table if not exists platform_config (
  key text primary key,
  value text not null,
  description text,
  value_type text not null default 'string'
    check (value_type in ('string', 'boolean', 'number', 'json')),
  updated_at timestamptz default now(),
  updated_by uuid
);

insert into platform_config (key, value, description, value_type) values
('DALGO_APP_NAME', 'DAlgo', 'Application display name', 'string'),
('DALGO_REGISTRATION_DISCLAIMER',
 'DAlgo is a software platform that enables automated trading. We are not a SEBI-registered investment advisor and do not provide investment advice. All trading strategies, parameters, and decisions are yours. By registering, you confirm you have read and understood our Terms of Service, Privacy Policy, and Risk Disclosure.',
 'Disclaimer shown on registration page', 'string'),
('DALGO_STRATEGY_DISCLAIMER',
 'This is a strategy template, not investment advice. By enabling this strategy you confirm that these are your own trading decisions, you have reviewed all parameters, and you take full responsibility for all trades placed by this strategy. DAlgo is a software platform only.',
 'Disclaimer shown when customer enables a strategy', 'string'),
('SUREPASS_KYC_ENABLED', 'false',
 'Enable Surepass V2 full Aadhar KYC validation. When false, images stored but not validated.',
 'boolean'),
('SMS_OTP_ENABLED', 'false',
 'Enable mobile SMS OTP verification (V2 feature — TODO in code)', 'boolean'),
('STRATEGY_SCAN_DB_ENABLED', 'false',
 'Store strategy_scan records in Supabase (increases DB usage 73%)', 'boolean'),
('HEARTBEAT_DB_ENABLED', 'false',
 'Store monitor_heartbeat records in Supabase. Default off — dropped entirely.', 'boolean'),
('TOKEN_ALERT_TIME_IST', '09:00',
 'Time HH:MM IST to send token-missing alerts', 'string'),
('SUPPORT_EMAIL', 'support@dalgo.online',
 'Support email shown to users', 'string')
on conflict (key) do nothing;

-- Fixed rules
create table if not exists platform_fixed_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  rule_name text not null,
  description text,
  value jsonb not null,
  value_type text not null check (value_type in ('boolean', 'number', 'string')),
  warning_message text,
  updated_at timestamptz default now(),
  updated_by uuid
);

insert into platform_fixed_rules (rule_key, rule_name, description, value, value_type, warning_message) values
('sell_monitor_cadence_min', 'Sell monitor cadence (minutes)',
 'How often the SELL monitor runs during market hours.',
 '5', 'number',
 'Changing sell monitor cadence affects all customers immediately. Lower values increase API usage significantly.'),
('no_short_selling', 'No short selling',
 'Block SELL orders when account does not hold that symbol.',
 'true', 'boolean',
 'WARNING: Disabling this allows short selling. This fundamentally changes the trading philosophy.'),
('no_fo_trading', 'No F&O trading',
 'Only NSE cash equity segment permitted.',
 'true', 'boolean',
 'WARNING: This platform is not designed for F&O trading.'),
('no_loss_sell_auto', 'Auto mode no-loss sell rule',
 'Never sell below average cost in auto mode. The foundational DAlgo rule.',
 'true', 'boolean',
 'WARNING: Disabling this allows selling at a loss in auto mode. This changes the DAlgo philosophy fundamentally.'),
('order_product_type', 'Order product type',
 'All automated orders placed as this product type.',
 '"CNC"', 'string',
 'Changing product type affects all future orders across all customers.'),
('exchange', 'Exchange',
 'Exchange for all automated orders.',
 '"NSE"', 'string',
 'Changing exchange affects all customers. NSE is the only supported exchange.')
on conflict (rule_key) do nothing;

-- User profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('superadmin', 'account_manager', 'broking_company', 'customer')),
  full_name text not null,
  email text not null,
  mobile text,
  status text not null default 'pending'
    check (status in ('pending', 'under_review', 'identity_verified', 'active', 'suspended', 'rejected')),
  assigned_account_manager_id uuid references profiles(id),
  broking_company_id uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Registrations and KYC
create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  registration_type text not null check (registration_type in ('customer', 'broking_company')),
  full_name text not null,
  dob date,
  address text,
  city text,
  state text,
  pincode text,
  mobile text,
  aadhar_number text,
  aadhar_front_url text,
  aadhar_back_url text,
  surepass_result jsonb,
  surepass_verified boolean default false,
  company_name text,
  gst_number text,
  company_registration_number text,
  company_address text,
  company_city text,
  company_state text,
  company_pincode text,
  company_email text,
  company_mobile text,
  assigned_to uuid references profiles(id),
  step1_approved_at timestamptz,
  step1_approved_by uuid references profiles(id),
  rejection_reason text,
  step2_activated_at timestamptz,
  step2_activated_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Broker accounts
create table if not exists broker_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  broker_name text not null check (broker_name in ('zerodha','upstox','angelone','aliceblue','dhan','5paisa')),
  client_code text,
  api_key_enc text,
  api_secret_enc text,
  access_token_enc text,
  refresh_token_enc text,
  token_captured_at timestamptz,
  token_expires_at timestamptz,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, broker_name)
);

-- Customer EC2 instances
create table if not exists customer_instances (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade unique,
  subdomain text not null unique,
  instance_url text not null,
  elastic_ip text,
  ec2_instance_id text,
  status text not null default 'provisioning'
    check (status in ('provisioning','active','suspended','terminated')),
  last_heartbeat_at timestamptz,
  last_cron_tick_at timestamptz,
  kite_token_status text default 'missing'
    check (kite_token_status in ('connected','missing','expired')),
  cron_mode text default 'manual' check (cron_mode in ('auto','manual')),
  open_positions_count integer default 0,
  todays_orders_count integer default 0,
  todays_buy_count integer default 0,
  todays_sell_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- SSO tokens
create table if not exists sso_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  customer_id uuid not null references profiles(id) on delete cascade,
  used boolean default false,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Platform capital defaults
create table if not exists platform_capital_defaults (
  id uuid primary key default gen_random_uuid(),
  per_trade numeric not null default 5000,
  max_buys_per_day integer not null default 3,
  max_sells_per_day integer not null default 10,
  max_positions integer not null default 10,
  max_buys_per_symbol integer not null default 3,
  min_drop_between_buys_pct numeric not null default 10,
  max_deploy_pct numeric not null default 80,
  delivery_dp_charge numeric not null default 15.34,
  circuit_breaker_pct numeric not null default -5,
  intraday_circuit_trip_pct numeric not null default -3,
  intraday_circuit_resume_pct numeric not null default -2,
  panic_drop_pct numeric not null default 0,
  panic_window_min integer not null default 0,
  updated_at timestamptz default now()
);

insert into platform_capital_defaults
  (per_trade,max_buys_per_day,max_sells_per_day,max_positions,max_buys_per_symbol,
   min_drop_between_buys_pct,max_deploy_pct,delivery_dp_charge,circuit_breaker_pct,
   intraday_circuit_trip_pct,intraday_circuit_resume_pct,panic_drop_pct,panic_window_min)
values (5000,3,10,10,3,10,80,15.34,-5,-3,-2,0,0)
on conflict do nothing;

-- Platform strategies (templates)
create table if not exists platform_strategies (
  id text primary key,
  name text not null,
  type text not null check (type in ('dip','momentum','pivotal')),
  active boolean default true,
  published boolean default false,
  color text default '#3B82F6',
  scan_interval_min integer default 5,
  watchlist_keys text[] default array['listA'],
  params jsonb not null,
  exits jsonb not null,
  gift_nifty_gate jsonb,
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Platform watchlists
create table if not exists platform_watchlists (
  id uuid primary key default gen_random_uuid(),
  list_key text not null unique,
  name text not null,
  symbols jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Platform pivotal lists
create table if not exists platform_pivotal_lists (
  id uuid primary key default gen_random_uuid(),
  list_id text not null unique,
  name text not null,
  entries jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Customer capital config
create table if not exists customer_capital_config (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade unique,
  per_trade numeric not null default 5000,
  max_buys_per_day integer not null default 3,
  max_sells_per_day integer not null default 10,
  max_positions integer not null default 10,
  max_buys_per_symbol integer not null default 3,
  min_drop_between_buys_pct numeric not null default 10,
  max_deploy_pct numeric not null default 80,
  delivery_dp_charge numeric not null default 15.34,
  circuit_breaker_pct numeric not null default -5,
  intraday_circuit_trip_pct numeric not null default -3,
  intraday_circuit_resume_pct numeric not null default -2,
  panic_drop_pct numeric not null default 0,
  panic_window_min integer not null default 0,
  updated_at timestamptz default now(),
  updated_by uuid references profiles(id)
);

-- Customer strategies (copies from platform templates)
create table if not exists customer_strategies (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  platform_strategy_id text references platform_strategies(id),
  name text not null,
  type text not null check (type in ('dip','momentum','pivotal')),
  active boolean default false,
  color text default '#3B82F6',
  scan_interval_min integer default 5,
  watchlist_keys text[] default array['listA'],
  params jsonb not null,
  exits jsonb not null,
  gift_nifty_gate jsonb,
  enabled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, name)
);

-- Customer watchlists
create table if not exists customer_watchlists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  list_key text not null,
  name text not null,
  symbols jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, list_key)
);

-- Customer pivotal lists
create table if not exists customer_pivotal_lists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  list_id text not null,
  name text not null,
  entries jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, list_id)
);

-- Customer positions
create table if not exists customer_positions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  broker_account_id uuid references broker_accounts(id),
  strategy_id uuid references customer_strategies(id),
  symbol text not null,
  total_qty integer not null default 0,
  remaining_qty integer not null default 0,
  first_buy_price numeric not null,
  first_buy_at timestamptz not null,
  tranche1_at timestamptz,
  tranche1_sold_qty integer default 0,
  lots jsonb default '[]',
  status text not null default 'open' check (status in ('open','closed','handed_off')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(customer_id, symbol)
);

-- Customer state (replaces state.json)
create table if not exists customer_state (
  customer_id uuid primary key references profiles(id) on delete cascade,
  cron_mode text not null default 'manual' check (cron_mode in ('auto','manual')),
  idempotency_ledger jsonb not null default '{}',
  buy_history jsonb not null default '{}',
  panic_skip_list jsonb not null default '{}',
  daily_buy_count integer default 0,
  daily_sell_count integer default 0,
  day_key text,
  circuit_tripped boolean default false,
  gift_nifty_change_pct numeric,
  updated_at timestamptz default now()
);

-- Orders (lean journal)
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  broker_account_id uuid references broker_accounts(id),
  strategy_id uuid references customer_strategies(id),
  symbol text not null,
  side text not null check (side in ('BUY','SELL')),
  qty integer not null,
  price numeric not null,
  broker_order_id text,
  tag text,
  status text not null,
  source text not null check (source in ('auto','manual')),
  reason text,
  trade_date date not null,
  created_at timestamptz default now()
);

-- Trades (completed pairs)
create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  strategy_id uuid references customer_strategies(id),
  symbol text not null,
  qty integer not null,
  entry_price numeric not null,
  entry_time timestamptz not null,
  exit_price numeric,
  exit_time timestamptz,
  pnl_rupees numeric,
  pnl_pct numeric,
  verdict text check (verdict in ('correct_exit','early_exit','delivery','manual')),
  buy_order_id uuid references orders(id),
  sell_order_id uuid references orders(id),
  trade_date date not null,
  created_at timestamptz default now()
);

-- Signals skipped
create table if not exists signals_skipped (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  strategy_id uuid references customer_strategies(id),
  symbol text not null,
  signal_price numeric,
  gate text not null,
  reason text not null,
  signal_date date not null,
  signal_time text,
  created_at timestamptz default now()
);

-- Strategy scans (optional — only when STRATEGY_SCAN_DB_ENABLED = true)
create table if not exists strategy_scans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  strategy_id uuid references customer_strategies(id),
  recs integer default 0,
  executed integer default 0,
  symbols text[],
  skip_reason text,
  scanned_at timestamptz default now(),
  scan_date date not null
);

-- Shared daily closes (not per user)
create table if not exists daily_closes (
  symbol text not null,
  trade_date date not null,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  close_price numeric not null,
  volume bigint,
  updated_at timestamptz default now(),
  primary key (symbol, trade_date)
);

-- Backtest runs
create table if not exists backtest_runs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  strategy_id uuid references customer_strategies(id),
  strategy_name text,
  strategy_type text,
  params jsonb,
  results jsonb,
  ai_analysis text,
  run_at timestamptz default now()
);

-- Audit log
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  actor_role text,
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  target_name text,
  before_value jsonb,
  after_value jsonb,
  ip_address text,
  created_at timestamptz default now()
);

-- Email log
create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references profiles(id),
  recipient_email text not null,
  event_type text not null,
  subject text,
  status text default 'sent' check (status in ('sent','failed','pending')),
  error_message text,
  sent_at timestamptz default now()
);

-- ================================================================
-- INDEXES
-- ================================================================

create index if not exists idx_orders_customer_date on orders(customer_id, trade_date desc);
create index if not exists idx_orders_customer_symbol on orders(customer_id, symbol);
create index if not exists idx_orders_broker_order_id on orders(broker_order_id) where broker_order_id is not null;
create index if not exists idx_trades_customer_date on trades(customer_id, trade_date desc);
create index if not exists idx_positions_customer on customer_positions(customer_id);
create index if not exists idx_positions_customer_symbol on customer_positions(customer_id, symbol);
create index if not exists idx_positions_open on customer_positions(customer_id, status) where status = 'open';
create index if not exists idx_daily_closes on daily_closes(symbol, trade_date desc);
create index if not exists idx_signals_date on signals_skipped(customer_id, signal_date desc);
create index if not exists idx_audit_log on audit_log(actor_id, created_at desc);
create index if not exists idx_sso_active on sso_tokens(token) where used = false;
create index if not exists idx_sso_expiry on sso_tokens(expires_at) where used = false;
create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_status on profiles(status);
create index if not exists idx_profiles_manager on profiles(assigned_account_manager_id) where assigned_account_manager_id is not null;
create index if not exists idx_customer_strategies on customer_strategies(customer_id);
create index if not exists idx_customer_strategies_active on customer_strategies(customer_id, active) where active = true;
create index if not exists idx_instances_active on customer_instances(status) where status = 'active';

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

alter table profiles enable row level security;
alter table registrations enable row level security;
alter table broker_accounts enable row level security;
alter table customer_instances enable row level security;
alter table customer_strategies enable row level security;
alter table customer_watchlists enable row level security;
alter table customer_pivotal_lists enable row level security;
alter table customer_capital_config enable row level security;
alter table customer_positions enable row level security;
alter table customer_state enable row level security;
alter table orders enable row level security;
alter table trades enable row level security;
alter table signals_skipped enable row level security;
alter table backtest_runs enable row level security;
alter table strategy_scans enable row level security;
alter table sso_tokens enable row level security;
alter table audit_log enable row level security;
alter table email_log enable row level security;
alter table daily_closes enable row level security;
alter table platform_strategies enable row level security;
alter table platform_watchlists enable row level security;

-- Helper functions
create or replace function is_superadmin()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'superadmin')
$$ language sql security definer;

create or replace function is_account_manager()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'account_manager')
$$ language sql security definer;

create or replace function get_my_role()
returns text as $$
  select role from profiles where id = auth.uid()
$$ language sql security definer;

-- RLS Policies
create policy "profiles_read" on profiles for select using (
  auth.uid() = id or is_superadmin() or is_account_manager()
  or exists (select 1 from profiles p where p.id = auth.uid()
    and p.role = 'broking_company' and profiles.broking_company_id = auth.uid())
);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

create policy "customer_strategies_read" on customer_strategies for select using (
  customer_id = auth.uid() or is_superadmin()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'account_manager'
    and exists (select 1 from profiles c where c.id = customer_strategies.customer_id
      and c.assigned_account_manager_id = auth.uid()))
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'broking_company'
    and exists (select 1 from profiles c where c.id = customer_strategies.customer_id
      and c.broking_company_id = auth.uid()))
);
create policy "customer_strategies_write" on customer_strategies for all using (
  customer_id = auth.uid() or is_superadmin()
);

create policy "orders_read" on orders for select using (
  customer_id = auth.uid() or is_superadmin()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'account_manager'
    and exists (select 1 from profiles c where c.id = orders.customer_id
      and c.assigned_account_manager_id = auth.uid()))
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'broking_company'
    and exists (select 1 from profiles c where c.id = orders.customer_id
      and c.broking_company_id = auth.uid()))
);
create policy "orders_insert" on orders for insert with check (
  customer_id = auth.uid() or is_superadmin()
);

create policy "positions_all" on customer_positions for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "state_all" on customer_state for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "broker_accounts_all" on broker_accounts for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "capital_all" on customer_capital_config for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "watchlists_all" on customer_watchlists for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "pivotal_all" on customer_pivotal_lists for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "trades_read" on trades for select using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "trades_insert" on trades for insert with check (
  customer_id = auth.uid() or is_superadmin()
);
create policy "signals_all" on signals_skipped for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "backtest_all" on backtest_runs for all using (
  customer_id = auth.uid() or is_superadmin()
);
create policy "instances_read" on customer_instances for select using (
  customer_id = auth.uid() or is_superadmin() or is_account_manager()
);
create policy "instances_write" on customer_instances for all using (is_superadmin());

-- Platform data: all authenticated read, SA writes
create policy "platform_strategies_read" on platform_strategies for select using (auth.role() = 'authenticated');
create policy "platform_strategies_write" on platform_strategies for all using (is_superadmin());
create policy "platform_watchlists_read" on platform_watchlists for select using (auth.role() = 'authenticated');
create policy "platform_watchlists_write" on platform_watchlists for all using (is_superadmin());
create policy "daily_closes_read" on daily_closes for select using (auth.role() = 'authenticated');
create policy "daily_closes_write" on daily_closes for all using (is_superadmin());

-- SSO and audit
create policy "sso_insert" on sso_tokens for insert with check (is_superadmin());
create policy "sso_read" on sso_tokens for select using (true);
create policy "sso_update" on sso_tokens for update using (true);
create policy "audit_read" on audit_log for select using (is_superadmin());
create policy "audit_insert" on audit_log for insert with check (true);
create policy "email_log_insert" on email_log for insert with check (true);
create policy "email_log_read" on email_log for select using (is_superadmin());
```

---

## 9. Data Migration Plan

### 9.1 Seeded Accounts
| Email | Role | Purpose | Password |
|---|---|---|---|
| dinesh.k.wadhwani@gmail.com | SuperAdmin | Primary platform owner | Set at first login |
| dinesh_wadhwani@yahoo.com | Account Manager | Test AM | Set at first login |
| wadhwani_dinesh@hotmail.com | Customer | Test Customer | Set at first login |

### 9.2 What to Migrate
| Data | From | To | Notes |
|---|---|---|---|
| Strategy config | `data/strategy.json` | `platform_strategies` | Fix 4 known bugs in seed |
| Watchlist | `data/watchlist.json` | `platform_watchlists` | listA/listB/list3 |
| Pivotal lists | `data/pivotalLists.json` | `platform_pivotal_lists` | Currently empty |
| Daily closes | `data/daily-closes.json` | `daily_closes` (shared) | 506KB OHLC |

### 9.3 What NOT to Migrate
| Data | Reason |
|---|---|
| `positions.json` | Seed fresh from Zerodha on activation |
| `journal-*.jsonl` | Fresh start. Zerodha Console = historical truth. |
| `backtest-history.json` | Re-run anytime |
| `state.json` | Ephemeral — tokens/idempotency reset daily |

### 9.4 V1 Bugs Fixed in Migration Seed
| Bug | Fix |
|---|---|
| Market Boom `squareOffEOD: false` | Seed with `squareOffEOD: true` |
| Market Boom `deliveryHandoffDays: 15` | Seed with `deliveryHandoffDays: 0` |
| Catalyst `scanStartHHMM: 09:15` | Seed with `scanStartHHMM: '09:30'` |
| Pivotal `minVolumeSurgeRatio: 1.2` | Seed with `minVolumeSurgeRatio: 1.5` |

### 9.5 Migration Script Order
```bash
npx ts-node scripts/migrate-to-supabase.ts
# 1.  verifySupabaseConnection()
# 2.  seedPlatformFixedRules()
# 3.  seedPlatformCapitalDefaults()
# 4.  seedPlatformStrategies()        # fixes known bugs in values
# 5.  seedPlatformWatchlists()
# 6.  seedPlatformPivotalLists()
# 7.  seedDailyCloses()              # → shared daily_closes table
# 8.  createSuperAdminAccount()      # dinesh.k.wadhwani@gmail.com
# 9.  createAccountManagerAccount()  # dinesh_wadhwani@yahoo.com
# 10. createTestCustomerAccount()    # wadhwani_dinesh@hotmail.com
# 11. copyPlatformTemplatesToCustomer(testCustomerId)
# 12. createCustomerCapitalConfig(testCustomerId)
# 13. printSummary()
```

---

## PART 8 — OPEN ISSUES

---

## 10. V1 Bugs to Fix in This Refactor

### 10.1 reconcileManualSells() Root Cause (HIGHEST PRIORITY)
**File:** `lib/cronReconcile.ts`
**Fix BEFORE porting any reconciliation to Supabase.**

Root cause: "absorb untracked live position" path creates phantom BUY (no order ID) → next tick sees `liveQty = 0` → creates synthetic SELL → next tick phantom re-BUY → cycle repeats → `remainingQty` corrupted into permanent journal records.

Evidence: TATASTEEL journal recorded 28,700 shares SELL against 165 lifetime bought. Same fingerprint on BSOFT, CAMS, others.

Fix approach:
- "Absorb untracked" path must NOT create journal entries with no order ID
- Must verify symbol genuinely has no corresponding order in Kite order book
- Synthetic SELL (Case 2) must only fire at EOD (15:35), not intraday — transient snapshots miss holdings
- After absorbing, mark with flag so not re-processed next tick
- Design carefully before coding — this is the riskiest piece

### 10.2 Other Bugs Fixed in Seed (Listed in Section 9.4)

---

## PART 9 — PAGES AND SCREENS

---

## 11. Complete Page List

### 11.1 Public Pages (www.dalgo.online — no auth)
| Page | Path | Notes |
|---|---|---|
| Landing | `/` | `landing.html` already built — convert to Next.js |
| Login | `/login` | Email + password + magic link OTP option |
| Register | `/register` | Customer or broking company (toggle) |
| Under review | `/pending` | Holding page during approval |
| Privacy policy | `/privacy` | Full Indian IT Act + GDPR |
| Terms of service | `/terms` | Full ToS |
| Risk disclosure | `/risk` | SEBI-style |
| Cookie policy | `/cookies` | Cookie usage |
| Refund policy | `/refund` | Subscription refund |
| Grievance redressal | `/grievance` | SEBI-mandated |
| About | `/about` | Company info |
| Contact | `/contact` | Contact form |

### 11.2 SuperAdmin Pages (www.dalgo.online)
| Page | Path |
|---|---|
| Dashboard | `/admin` |
| Customer health | `/admin/health` |
| All customers | `/admin/customers` |
| Customer detail | `/admin/customers/[id]` |
| Registrations queue | `/admin/registrations` |
| Account managers | `/admin/managers` |
| Broking companies | `/admin/broking-companies` |
| Platform strategies | `/admin/strategies` |
| Platform watchlists | `/admin/watchlists` |
| Fixed rules | `/admin/fixed-rules` |
| Platform config | `/admin/config` |
| Broker management | `/admin/brokers` |
| Consolidated report | `/admin/reports` |
| Audit log | `/admin/audit` |

### 11.3 Account Manager Pages (www.dalgo.online)
| Page | Path |
|---|---|
| Dashboard | `/manager` |
| My customers | `/manager/customers` |
| Customer detail | `/manager/customers/[id]` |
| Registration reviews | `/manager/registrations` |
| Reports | `/manager/reports` |

### 11.4 Customer Pages (customername.dalgo.online)
| Page | Path | Notes |
|---|---|---|
| Dashboard | `/dashboard` | Morning briefing, capital bar, GIFT Nifty |
| Holdings | `/holdings` | Holdings + T0 positions merged |
| Today's positions | `/positions` | Live P&L, Square Off |
| Today's orders | `/orders` | Order log with strategy badges |
| Engine | `/engine` | Recommendations, Execute, Pending Orders |
| Watchlist | `/watchlist` | Read-only, live LTP colour coding |
| Manage lists | `/manage-lists` | Create/rename/delete, Reset to platform |
| Pivotal lists | `/pivotal-lists` | Manage pivotal entries |
| Strategies | `/strategies` | Enable/edit own copies, Reset to template |
| Trade report | `/trade-report` | Date-range P&L |
| Settings | `/settings` | Broker connection, token paste |
| Health | `/health` | Zerodha/AI/Email integration health |

---

## PART 10 — EMAIL NOTIFICATIONS

---

## 12. Complete Email List

| Event | To | CC | Subject |
|---|---|---|---|
| Registration submitted (OTP verified) | Customer | — | "Your DAlgo application has been submitted" |
| Registration assigned to AM | Account Manager | — | "New registration assigned to you: [Name]" |
| Identity approved (Step 1) | Customer | — | "Identity verified — complete your DAlgo setup" |
| Identity rejected | Customer | — | "Action required: Your DAlgo application needs attention" |
| Broker setup reminder (48h no action) | Customer | Account Manager | "Complete your DAlgo broker setup" |
| Account activated | Customer | — | "Your DAlgo trading account is now active!" |
| Strategy changed by customer | Account Manager | — | "Strategy changed: [Customer] updated [Strategy]" |
| Platform template updated | Affected customers | — | "Your [Strategy] strategy has been updated by DAlgo" |
| Token missing at 9AM | Customer | Account Manager | "Action required: Paste your Zerodha token before 9:15 AM" |
| Account Manager created | Account Manager | — | "Welcome to DAlgo — set your password" |
| Customer reassigned | New AM | Old AM | "Customer [Name] has been assigned to you" |

---

## PART 11 — REPORTS

---

## 13. Reports Detail

### 13.1 Customer Report
- Source: `orders` + `trades` tables
- Filters: date range, strategy, symbol
- Shows: entry/exit per trade, P&L, charges, verdict
- Summary: total realised P&L, unrealised MTM, win rate, avg hold period, charges

### 13.2 Account Manager Report
- Aggregated across assigned customers
- Filter: individual customer
- Summary table: customer name, P&L, win rate, strategies active, open positions
- Drill-down to individual customer report

### 13.3 Broking Company Report
- Same as AM report but for their registered customers only

### 13.4 SuperAdmin Consolidated Report
- All customers on platform
- Filters: date range, Account Manager, Broking Company, individual customer
- Platform metrics: total orders, total P&L generated, most active strategies
- Export to CSV

### 13.5 SuperAdmin Health Dashboard
One row per active customer instance:

| Column | Green | Red |
|---|---|---|
| EC2 status | Heartbeat < 6min ago | No heartbeat > 6min |
| Last cron tick | < 6min (market hours) | > 6min (market hours) |
| Kite token | `connected` | `missing` or `expired` |
| Cron mode | `auto` (market hours) | `manual` (market hours) |
| Open positions | Count (info) | — |
| Orders today | Count (info) | — |

Health data written by each customer EC2 cron tick to `customer_instances` table. No SSH required.

---

## PART 12 — V2 FEATURES

---

## 14. Deferred to V2 (TODO Comments in Code)

| Feature | TODO Location |
|---|---|
| SMS OTP | `lib/auth.ts` — OTP flow |
| Zerodha vendor partner | `lib/broker/ZerodhaAdapter.ts` — auth flow |
| Proxy layer (V1.1) | `lib/broker/index.ts` — PROXY_URL routing |
| Push notifications | `lib/email.ts` — notification dispatch |
| Upstox adapter | `lib/broker/UpstoxAdapter.ts` (stub with throw) |
| Angel One adapter | `lib/broker/AngelOneAdapter.ts` (stub with throw) |
| Alice Blue adapter | `lib/broker/AliceBlueAdapter.ts` (stub with throw) |
| Dhan adapter | `lib/broker/DhanAdapter.ts` (stub with throw) |
| 5paisa adapter | `lib/broker/FivePaisaAdapter.ts` (stub with throw) |
| Surepass KYC (enabled) | `lib/kyc/surepass.ts` — API call |
| Razorpay billing | `lib/billing/razorpay.ts` |
| 5-year backtest data | `lib/backtest.ts` — date range |
| WhatsApp alerts | `lib/notifications/whatsapp.ts` |
| Strategy scan DB storage | `lib/cronState.ts` — journal write |

---

## PART 13 — FILE STRUCTURE AND BUILD PHASES

---

## 15. Repository Structure
```
dalgo/
├── app/
│   ├── (public)/           Landing, login, register, legal pages
│   ├── (admin)/            SuperAdmin pages
│   ├── (manager)/          Account Manager pages
│   ├── (customer)/         Customer trading pages
│   └── api/                API routes
├── lib/
│   ├── broker/
│   │   ├── IBroker.ts      Interface — most important file
│   │   ├── ZerodhaAdapter.ts
│   │   ├── AngelOneAdapter.ts  stub
│   │   ├── UpstoxAdapter.ts    stub
│   │   └── index.ts           getBroker() factory
│   ├── cron/
│   │   ├── cron.ts
│   │   ├── cronBuy.ts
│   │   ├── cronEOD.ts
│   │   ├── cronReconcile.ts   FIXED
│   │   └── cronState.ts
│   ├── supabase.ts
│   ├── encryption.ts
│   ├── auth.ts             + SSO token gen/validation
│   ├── preflight.ts        uses IBroker now
│   ├── strategyEngine.ts   unchanged
│   ├── strategy1.ts        unchanged
│   ├── strategy2.ts        unchanged
│   ├── pivotal.ts          unchanged
│   ├── strategyConfig.ts   unchanged
│   ├── journal.ts          → Supabase
│   ├── positions.ts        → Supabase
│   ├── state.ts            → Supabase
│   ├── email.ts            mostly unchanged
│   ├── market.ts           unchanged
│   ├── ema.ts              unchanged
│   ├── dailyCloses.ts      → Supabase shared table
│   ├── backtest.ts         unchanged
│   ├── retrospective.ts    mostly unchanged
│   └── tradeReport.ts      updated for Supabase
├── scripts/
│   └── migrate-to-supabase.ts
├── config/
│   ├── holidays.json
│   └── instruments.json
├── components/
├── docs/
│   ├── DALGO_REFACTOR_SPEC_v2.md  (this file)
│   └── DALGO_SUPABASE_SCHEMA.sql
├── middleware.ts
├── server.js
├── next.config.js
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

---

## 16. Build Phases

### Phase 1 — Foundation
1. Run SQL schema in Supabase SQL Editor
2. `lib/supabase.ts` — admin + anon clients
3. `lib/encryption.ts` — AES-256 using ENCRYPTION_KEY
4. `lib/auth.ts` — login, register, session, SSO token gen/validation
5. `middleware.ts` — route protection by role + INSTANCE_TYPE
6. Login page in DAlgo design system
7. Register page (customer + broking company)
8. Run migration script — seed all accounts and platform data
9. Basic SuperAdmin dashboard skeleton
10. Verify: dinesh.k.wadhwani@gmail.com logs in, sees dashboard

### Phase 2 — Broker Abstraction
1. `lib/broker/IBroker.ts` — full interface
2. `lib/broker/ZerodhaAdapter.ts` — wraps existing kite.ts
3. `lib/broker/index.ts` — getBroker() factory
4. Broker stubs for future adapters (all throw Error V2)
5. Replace ALL direct Kite calls in `preflight.ts` with IBroker
6. Replace ALL direct Kite calls in strategy monitors with IBroker
7. DELETE `kiteGet()` private function from preflight.ts
8. Test: place manual order via IBroker

### Phase 3 — Registration and Onboarding
1. Full customer registration form (all 11 fields)
2. Broking company registration form
3. Email OTP verification
4. `POST /api/auth/register` API
5. SuperAdmin `/admin/registrations` — view, assign to AM
6. AM `/manager/registrations` — review KYC, approve/reject
7. Step 1 approval — status update + email
8. Step 2 — broker setup screen + connection test
9. Step 2 — strategy setup screen with confirmation dialog
10. Capital config as part of strategy activation
11. AM activation flow + email to customer
12. All email notifications (Section 12)

### Phase 4 — Customer Trading Dashboard
1. Port `lib/positions.ts` → Supabase `customer_positions`
2. Port `lib/state.ts` → Supabase `customer_state`
3. Port `lib/journal.ts` → Supabase `orders` + `trades` + `signals_skipped`
4. Port `lib/watchlistStore.ts` → Supabase `customer_watchlists`
5. Port `lib/strategyConfigStore.ts` → Supabase `customer_strategies` + `customer_capital_config`
6. Port `lib/dailyCloses.ts` → Supabase `daily_closes` shared table
7. Port `lib/backtestHistory.ts` → Supabase `backtest_runs`
8. Port `lib/pivotalListStore.ts` → Supabase `customer_pivotal_lists`
9. All customer pages ported
10. SSO flow — login at main, redirect to customer instance

### Phase 5 — Multi-Tenant Cron
1. Cron reads CUSTOMER_ID from env
2. All Supabase reads/writes scoped to customer_id
3. Fix `cronReconcile.ts` root cause FIRST (Section 10.1)
4. Heartbeat + token status writes to customer_instances
5. 9:00 AM IST token alert cron on main instance
6. Test on dinesh.dalgo.online

### Phase 6 — Admin and Manager Dashboards
1. SA health dashboard — reads customer_instances
2. SA consolidated reports
3. SA platform strategy management (create/edit/publish)
4. SA fixed rules editor (warning + audit log)
5. SA platform config page
6. AM dashboard and customer detail
7. Fixed Rule propagation — immediate effect on all instances

### Phase 7 — Landing Page and Legal Pages
1. Deploy landing.html as Next.js root page
2. All 6 legal pages: Privacy, Terms, Risk, Cookies, Refund, Grievance
3. About and Contact pages
4. SEO meta tags on all pages

### Phase 8 — Testing and Cutover
1. Full E2E test with 3 seeded accounts
2. Dinesh registers as Customer, AM approves, activates
3. Customer logs in → SSO redirect to dinesh.dalgo.online
4. Token paste → Auto mode → cron fires → orders hit Zerodha
5. Health dashboard shows green
6. Point dalgo.online to new deployment
7. Keep dineshtrade.online running until confident

---

## 17. Session Start Instructions for Claude Code

Every new Claude Code session:
1. Read `docs/DALGO_REFACTOR_SPEC_v2.md` completely
2. Confirm current branch = `multitanent_refactor`
3. Ask which phase/task for this session
4. NEVER modify `main` branch — it's live production
5. NEVER change strategy logic without explicit instruction
6. NEVER call Zerodha directly — always via `getBroker()` → IBroker
7. Every Supabase write MUST include `customer_id` — zero cross-tenant data
8. After session: update CONTEXT.md with what was built + decisions + what's next

---

## 18. Key Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Database | Supabase PostgreSQL | Auth, RLS, free tier, ap-south-1 |
| Journal storage | Lean (orders+trades+signals) | 500MB free tier → 270 users/year |
| Daily closes | Shared table | NSE data identical for all users |
| strategy_scan records | Configurable, default OFF | Reduces DB 73% |
| Broker abstraction | IBroker interface | Zero engine changes per new broker |
| V1 broker | Zerodha only | Only implemented at launch |
| Deployment | One EC2 per customer V1 | Each needs own Elastic IP for Zerodha |
| Login | Single entry www → SSO redirect | Clean UX, one URL to remember |
| SSO security | 60s JWT, one-time use, customer ID check | Standard, secure, simple |
| Secrets | AWS key vault, randomBytes(32) | Never hardcode, never human-readable |
| Theme default | Light mode | Standard for financial apps |
| Colours | Blue 500 + Teal 200 + Amber 200/500 | Dinesh's personal selection |
| Templates | Platform copies to customer on activation | Customer owns copy independently |
| Template updates | Auto-push + email | No customer action required |
| Registration | Two-step: KYC first, broker second | Clean separation |
| Surepass KYC | Configurable ON/OFF (default OFF) | Avoid V1 dependency |
| SMS OTP | V2 (TODO) | Email sufficient for V1 |
| Token paste | Daily by customer, 9AM alert | V1 limitation |
| reconcileManualSells() | Fix before porting | Don't port bugs |
| App name | DAlgo | D = Dinesh |
| Pricing | Free / Pro ₹999/mo / Broker ₹4,999/mo | Simple 3-tier |
| Legal pages | All 6 | Proper commercial app |
| Tagline | "Trade Smarter. Automate Faster." | Dinesh's selection |
| Broking Company definition | Physical sub-broker (not tech broker) | Avoid confusion with Zerodha |
| Cron mode lock | No edits while Auto for anyone | Safety during live trading |
| SuperAdmin Fixed Rules | Immediate effect, warning, audit trail | SA accountability |

---

*End of DALGO_REFACTOR_SPEC_v2.md*
*Version 2.0 — Complete. No detail omitted.*
*Built with Claude AI — 09 August 2026*
*Next: Run DALGO_SUPABASE_SCHEMA.sql in Supabase → start Phase 1*
