import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { MOCK_MARKET_DATA } from '@/lib/marketMock'
import { callAI } from '@/lib/ai'

export async function GET(req: NextRequest) {
  const token = cookies().get('dt_session')?.value
  if (!token || !(await verifySession(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Dev/test toggle — skip the AI call and return canned data.
  if (process.env.USE_MOCK_MARKET === 'true') {
    return NextResponse.json({ success: true, data: MOCK_MARKET_DATA, generatedAt: new Date().toISOString(), mock: true })
  }

  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday:'long', day:'numeric', month:'long', year:'numeric' })

  const prompt = `Today is ${today}. You are a professional Indian equity market analyst. Search the web for latest data and provide a concise market briefing in JSON format ONLY (no markdown, no explanation outside JSON).

Return this exact JSON structure:
{
  "globalIndices": [
    { "name": "S&P 500", "value": "7,444", "change": "+0.58%", "direction": "up" },
    { "name": "Nasdaq", "value": "26,402", "change": "+1.20%", "direction": "up" },
    { "name": "Dow Jones", "value": "49,693", "change": "-0.14%", "direction": "down" },
    { "name": "DAX", "value": "24,162", "change": "+0.87%", "direction": "up" },
    { "name": "FTSE 100", "value": "10,324", "change": "+0.58%", "direction": "up" },
    { "name": "Nikkei", "value": "63,455", "change": "+0.29%", "direction": "up" },
    { "name": "Hang Seng", "value": "26,576", "change": "+0.71%", "direction": "up" },
    { "name": "Kospi", "value": "7,906", "change": "+0.79%", "direction": "up" },
    { "name": "Brent Crude", "value": "$98.43", "change": "+3.10%", "direction": "down" }
  ],
  "giftNifty": {
    "value": "24,218",
    "change": "-0.26%",
    "direction": "down",
    "impliedOpen": "Gap down ~60 pts",
    "signal": "cautious"
  },
  "indiaOutlook": {
    "bias": "cautious-positive",
    "expectedRange": "24,180–24,260",
    "keyFactors": ["S&P 500 at ATH", "Nasdaq +1.2%", "Iran ceasefire concerns"],
    "support": "24,100",
    "resistance": "24,600",
    "strategy": "Wait for 9:30 AM candle confirmation before entering"
  },
  "topRecommendations": [
    { "symbol": "BAJFINANCE", "name": "Bajaj Finance", "action": "BUY", "source": "ICICI Direct", "reason": "20-EMA support, strong NBFC sector" },
    { "symbol": "RELIANCE", "name": "Reliance Industries", "action": "BUY", "source": "HDFC Securities", "reason": "Oil price decline, telecom growth" }
  ],
  "headline": "Markets cautiously positive on global tech rally"
}`

  try {
    const result = await callAI({ prompt, useWebSearch: true, maxTokens: 3000 })

    if (!result.ok) {
      console.error(`[api/market] ${result.provider} HTTP ${result.status}:`, result.error?.slice(0, 500))
      return NextResponse.json({ success: false, error: `${result.provider} API ${result.status}`, detail: result.error?.slice(0, 500) }, { status: 502 })
    }

    // Strip common markdown fences (```json ... ```) some models wrap output in.
    const cleaned = result.text
      .replace(/^[\s\S]*?```(?:json)?\s*/i, '')
      .replace(/```[\s\S]*$/, '')
      .trim() || result.text

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[api/market] No JSON in response. Text head:', result.text.slice(0, 400))
      return NextResponse.json({ success: false, error: 'No JSON in model output', textHead: result.text.slice(0, 400), provider: result.provider }, { status: 502 })
    }

    try {
      const marketData = JSON.parse(jsonMatch[0])
      return NextResponse.json({
        success: true,
        data: marketData,
        generatedAt: new Date().toISOString(),
        provider: result.provider,
        model: result.model,
        webSearchUsed: result.webSearchUsed,
      })
    } catch (e) {
      console.error('[api/market] JSON.parse failed:', e, '\nText head:', result.text.slice(0, 800))
      return NextResponse.json({
        success: false,
        error: 'Model output is not valid JSON',
        parseError: String(e),
        textHead: result.text.slice(0, 800),
        provider: result.provider,
      }, { status: 502 })
    }
  } catch (error) {
    console.error('[api/market] Exception:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch market data', detail: String(error) }, { status: 500 })
  }
}
