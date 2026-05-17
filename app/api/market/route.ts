import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const token = cookies().get('dt_session')?.value
  if (!token || !(await verifySession(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday:'long', day:'numeric', month:'long', year:'numeric' })

  try {
    const response = await fetch(process.env.AI_API_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.AI_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL,
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Today is ${today}. You are a professional Indian equity market analyst. Search the web for latest data and provide a concise market briefing in JSON format ONLY (no markdown, no explanation outside JSON).

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
        }]
      })
    })

    const data = await response.json()
    // Extract text content from Claude response
    let textContent = ''
    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') textContent += block.text
      }
    }

    // Parse JSON from response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const marketData = JSON.parse(jsonMatch[0])
      return NextResponse.json({ success: true, data: marketData, generatedAt: new Date().toISOString() })
    }

    return NextResponse.json({ success: false, error: 'Could not parse market data' }, { status: 500 })
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to fetch market data' }, { status: 500 })
  }
}
