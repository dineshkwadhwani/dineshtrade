# DineshTrade — Private Trading Desk

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Edit `.env.local`:
```
AI_API_KEY=your_anthropic_api_key
ZERODHA_API_KEY=your_kite_connect_api_key
ZERODHA_API_SECRET=your_kite_connect_secret
SESSION_SECRET=any-random-secret-string-32-chars-min
```

### 3. Run locally
```bash
npm run dev
# Open http://localhost:3000
```

### 4. Deploy to Vercel
```bash
npm i -g vercel
vercel --prod
# Add env vars in Vercel dashboard > Settings > Environment Variables
```

## Login
Password = current date+hour in IST: `ddmmyyyyhh`
Example: 17 May 2026, 14:00 IST → `1705202614`

Session expires at midnight IST.

## Zerodha Setup
1. Sign up at developers.kite.trade (₹500/month)
2. Create an app, get API key + secret
3. Add to .env.local
4. Each morning: login to kite.zerodha.com, get access_token, paste in Settings

## Domain
Currently: dineshtrade.vercel.app
To use dineshtrade.online: Vercel Dashboard > Settings > Domains > Add

## Files
- `config/watchlist.json` — List A (84 stocks) + List B (29 stocks)
- `config/accounts.json` — Account configuration
- `config/strategy.json` — Strategy rules
- `lib/strategy.ts` — Strategy logic engine
- `lib/auth.ts` — Time-based password & session
- `lib/market.ts` — Market hours & NSE holidays

## Strategy Rules
- Capital: ₹50,000 total, ₹5,000 per trade
- Max 3 buys + 3 sells per day
- Target 1: +1.5% (intraday exit)
- Target 2: +2.0% (intraday exit)
- If not hit: take to delivery, manage as 20-EMA strategy
- No short selling, no F&O, no margin
