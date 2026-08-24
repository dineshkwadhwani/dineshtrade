import { getState } from './state'
import { getAccountList } from './accounts'
import { getPivotalLists, type PivotalScriptEntry } from './pivotalListStore'
import { asPivotalParams, getCapital, getStrategyById, getStrategies, type Strategy } from './strategyConfig'
import { resolveAccountCreds, getQuotes, placeKiteOrder, type KiteCreds } from './kite'
import { getInstrumentTokens } from './instruments'
import { loadAndRefreshCloses } from './dailyCloses'
import { getCachedQuotes, getCachedHistoricalCandles } from './marketDataCache'
import { runPreflight, markPlaced } from './preflight'
import { getBroker } from './broker'
import { appendJournal, classifyVerdict, istDateString, journalOrder } from './journal'
import { applyLotSell, listPositionLots, listPositions, removePosition, setStrategyId, type Position } from './positions'
import { sendEmail, isSkipTradeMailsEnabled } from './email'

export interface PivotalRecommendation {
  symbol: string
  name: string
  price: number
  priceSource: 'kite_live'
  dayChangePct: number
  action: string
  source: string
  reason: string
  target1: number
  target2: number
  suggestedQty: number
  confidence: 'normal' | 'high'
}

export interface PivotalScanResult {
  recommendations: PivotalRecommendation[]
  message?: string
}

export type PivotalMonitorAction = 'sold' | 'sold_failed' | 'held' | 'handoff' | 'skipped'

export interface PivotalMonitorEntry {
  account: string
  accountDisplayName?: string
  symbol: string
  action: PivotalMonitorAction
  quantity?: number
  entryPrice?: number
  ltp?: number
  gainPct?: number
  orderId?: string
  reason?: string
}

export interface PivotalMonitorResult {
  account: string
  ranAt: string
  positionsChecked: number
  entries: PivotalMonitorEntry[]
}

function istNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

function istDateOffset(daysOffset = 0): string {
  const now = istNow()
  now.setDate(now.getDate() + daysOffset)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function istHHMM(): string {
  const now = istNow()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesElapsedInSession(): number {
  const nowMin = hhmmToMinutes(istHHMM())
  return Math.max(1, Math.min(375, nowMin - hhmmToMinutes('09:15')))
}

async function firstConnectedCreds(): Promise<KiteCreds | null> {
  const state = await getState()
  for (const account of Object.keys(state.kiteTokens)) {
    const creds = await resolveAccountCreds(account)
    if (creds.ok) return { apiKey: creds.apiKey, accessToken: creds.accessToken }
  }
  return null
}

function findScript(strategy: Strategy, lists: Awaited<ReturnType<typeof getPivotalLists>>, symbol: string): PivotalScriptEntry | null {
  const params = asPivotalParams(strategy)
  return (lists.lists[params.pivotalListId] || []).find(entry => entry.nse.toUpperCase() === symbol.toUpperCase()) || null
}

export async function scanPivotalStrategy(strategy: Strategy): Promise<PivotalScanResult> {
  const creds = await firstConnectedCreds()
  if (!creds) return { recommendations: [], message: 'No Kite account connected — Login with Kite in Settings to run Pivotal.' }

  const params = asPivotalParams(strategy)
  const lists = await getPivotalLists()
  const scripts = (lists.lists[params.pivotalListId] || []).filter(entry => entry.enabled)
  if (scripts.length === 0) {
    const listName = lists.meta[params.pivotalListId]?.name || params.pivotalListId
    return { recommendations: [], message: `${listName} has no enabled scripts.` }
  }

  const symbols = scripts.map(entry => entry.nse.toUpperCase())
  const quotes = await getCachedQuotes(creds, symbols).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))
  const tokens = await getInstrumentTokens(creds, symbols).catch(() => ({} as Record<string, number>))
  const sessionElapsed = minutesElapsedInSession()
  const today = istDateOffset(0)
  const intradayFrom = `${today} 09:15:00`
  const intradayTo = `${today} 15:30:00`
  const nowMinutes = hhmmToMinutes(istHHMM())

  // Daily closes for the consolidation/volume windows — shared, Supabase-backed
  // rolling cache (same one Strategy 1/2 use), fetched once for all scripts
  // instead of one uncached Kite historical call per script.
  const dailyClosesBySymbol = await loadAndRefreshCloses(creds, symbols).catch(() => ({} as Record<string, Awaited<ReturnType<typeof loadAndRefreshCloses>>[string]>))

  const recommendations: PivotalRecommendation[] = []
  for (const script of scripts) {
    const quote: any = quotes[`NSE:${script.nse.toUpperCase()}`]
    const ltp = Number(quote?.last_price || 0)
    const currentVolume = Number(quote?.volume || quote?.volume_traded || 0)
    const prevClose = Number(quote?.ohlc?.close || 0)
    const dayGainPct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0
    if (!(ltp > 0 && prevClose > 0)) continue
    if (dayGainPct < params.minDayGainPct || dayGainPct > params.maxDayGainPct) continue
    if (ltp <= script.breakoutTriggerPrice) continue

    const token = tokens[script.nse.toUpperCase()]
    if (!token) continue

    const daily = (dailyClosesBySymbol[script.nse.toUpperCase()] || [])
    const priorDaily = daily.filter(candle => candle.date < today)
    const consolidationWindow = priorDaily.slice(-params.consolidationDays)
    if (consolidationWindow.length < params.consolidationDays) continue
    const consolidationHigh = Math.max(...consolidationWindow.map(candle => candle.high ?? candle.close))
    const consolidationLow = Math.min(...consolidationWindow.map(candle => candle.low ?? candle.close))
    const midpoint = (consolidationHigh + consolidationLow) / 2
    const consolidationRangePct = midpoint > 0 ? ((consolidationHigh - consolidationLow) / midpoint) * 100 : Number.POSITIVE_INFINITY
    if (consolidationRangePct > params.consolidationMaxRangePct) continue
    if (script.breakoutTriggerPrice < consolidationHigh) continue

    const volumeWindow = priorDaily.slice(-params.volumeAvgDays)
    if (volumeWindow.length < params.volumeAvgDays) continue
    const avgVolume = volumeWindow.reduce((sum, candle) => sum + candle.volume, 0) / volumeWindow.length
    if (!(avgVolume > 0)) continue

    if (script.executionMode === 'normal') {
      if (nowMinutes < hhmmToMinutes(params.scanStartHHMM) || nowMinutes > hhmmToMinutes(params.scanEndHHMM)) continue
      if (nowMinutes < hhmmToMinutes(params.minProjectedVolumeCheckHHMM)) continue
      const projectedDayVolume = currentVolume / (sessionElapsed / 375)
      if (projectedDayVolume < avgVolume * params.minVolumeSurgeRatio) continue
      const intraday = await getCachedHistoricalCandles(creds, token, intradayFrom, intradayTo, '5minute').catch(() => [])
      const closes = intraday.map(candle => candle.close)
      if (closes.length < params.breakoutConfirmCandles) continue
      const lastN = closes.slice(-params.breakoutConfirmCandles)
      let rising = true
      for (let idx = 1; idx < lastN.length; idx++) {
        if (lastN[idx] <= lastN[idx - 1]) { rising = false; break }
      }
      if (!rising || lastN[lastN.length - 1] <= script.breakoutTriggerPrice) continue
    } else {
      if (nowMinutes < hhmmToMinutes(params.dayEndExecutionTime)) continue
      if (currentVolume < avgVolume * params.minVolumeSurgeRatio) continue
    }

    const capital = getCapital()
    const suggestedQty = Math.max(1, Math.floor(capital.perTrade / ltp))
    recommendations.push({
      symbol: script.nse.toUpperCase(),
      name: script.name || script.nse.toUpperCase(),
      price: Number(ltp.toFixed(2)),
      priceSource: 'kite_live',
      dayChangePct: Number(dayGainPct.toFixed(2)),
      action: script.executionMode === 'dayEnd' ? 'BUY near close' : 'BUY breakout',
      source: `${strategy.name} · ${lists.meta[params.pivotalListId]?.name || params.pivotalListId}`,
      reason: `${script.executionMode === 'dayEnd' ? 'Held above trigger into close' : 'Breakout above trigger'} ₹${script.breakoutTriggerPrice.toFixed(2)} with volume confirmation`,
      target1: Number((ltp * (1 + script.t1Pct / 100)).toFixed(2)),
      target2: Number((ltp * (1 + script.t2Pct / 100)).toFixed(2)),
      suggestedQty,
      confidence: script.executionMode === 'dayEnd' ? 'high' : 'normal',
    })
  }

  recommendations.sort((a, b) => b.dayChangePct - a.dayChangePct || a.symbol.localeCompare(b.symbol))
  return { recommendations: recommendations.slice(0, 5), message: recommendations.length === 0 ? `No ${strategy.name} breakouts qualified right now.` : undefined }
}

export async function monitorPivotalAccount(account: string): Promise<PivotalMonitorResult> {
  const ranAt = new Date().toISOString()
  const displayName = getAccountList().find(item => item.name === account)?.displayName
  const pivotalIds = new Set(getStrategies().filter(strategy => strategy.type === 'pivotal').map(strategy => strategy.id))
  const positions = (await listPositions({ account })).filter(position => pivotalIds.has(position.strategyId))
  if (positions.length === 0) return { account, ranAt, positionsChecked: 0, entries: [] }

  const credsResult = await resolveAccountCreds(account)
  if (!credsResult.ok) {
    return { account, ranAt, positionsChecked: 0, entries: [{ account, accountDisplayName: displayName, symbol: '—', action: 'skipped', reason: credsResult.error }] }
  }
  const creds: KiteCreds = { apiKey: credsResult.apiKey, accessToken: credsResult.accessToken }
  const broker = getBroker({ brokerName: 'zerodha', brokerCredentials: { apiKey: creds.apiKey, accessToken: creds.accessToken } })
  const quotes = await getQuotes(creds, positions.map(position => position.symbol)).catch(() => ({} as Awaited<ReturnType<typeof getQuotes>>))
  const pivotalLists = await getPivotalLists()
  const entries: PivotalMonitorEntry[] = []

  for (const pos of positions) {
    const ownerStrategy = getStrategyById(pos.strategyId)
    if (!ownerStrategy) continue
    const params = asPivotalParams(ownerStrategy)
    const retraceAfterHit = params.retraceAfterHit !== false
    const retractAllowed = (typeof params.retractPercentAllowed === 'number' && Number.isFinite(params.retractPercentAllowed) && params.retractPercentAllowed >= 0)
      ? params.retractPercentAllowed
      : null
    const script = findScript(ownerStrategy, pivotalLists, pos.symbol)
    const quote: any = quotes[`NSE:${pos.symbol.toUpperCase()}`]
    const ltp = Number(quote?.last_price || 0)
    if (!(ltp > 0)) {
      entries.push({ account, accountDisplayName: displayName, symbol: pos.symbol, action: 'skipped', reason: 'No LTP from Kite' })
      continue
    }

    const lots = (await listPositionLots(pos)).sort((a, b) => a.boughtAt.localeCompare(b.boughtAt))
    let soldAnyLot = false
    for (const lot of lots) {
      if (lot.remainingQty < 1) continue
      const entryStopLoss = script?.stopLossPrice ?? null
      const t1Pct = script?.t1Pct ?? ownerStrategy.exits.t1Pct
      const t2Pct = script?.t2Pct ?? ownerStrategy.exits.t2Pct
      const gainPct = ((ltp - lot.entryPrice) / lot.entryPrice) * 100
      const lotT1Price = lot.entryPrice * (1 + t1Pct / 100)
      const lotT2Price = lot.entryPrice * (1 + t2Pct / 100)
      const observedHigh = Math.max(ltp, Number(quote?.ohlc?.high || 0))
      const minGainAfterRetrace = (triggerPct: number): number => {
        const allowed = retractAllowed === null ? triggerPct : retractAllowed
        return Math.max(0, triggerPct - Math.max(0, allowed))
      }
      const minGainT1 = minGainAfterRetrace(t1Pct)
      const minGainT2 = minGainAfterRetrace(t2Pct)

      let sellQty = 0
      let markTranche1 = false
      let bypassNoLossSellReason: 'pivotalStopLoss' | undefined
      let tagSuffix: 't1' | 't2' | 'exit' = 'exit'
      let reason = ''

      if (entryStopLoss !== null && ltp <= entryStopLoss) {
        sellQty = lot.remainingQty
        bypassNoLossSellReason = 'pivotalStopLoss'
        reason = `Pivotal stop-loss ₹${entryStopLoss.toFixed(2)} hit — exiting regardless of no-loss gate`
        tagSuffix = 'exit'
      } else if (!lot.tranche1At && ltp >= lotT2Price) {
        sellQty = lot.remainingQty
        reason = `LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${lotT2Price.toFixed(2)} — exiting lot`
        tagSuffix = 't2'
      } else if (retraceAfterHit && !lot.tranche1At && observedHigh >= lotT2Price && ltp < lotT2Price && ltp > lot.entryPrice && gainPct >= minGainT2) {
        sellQty = lot.remainingQty
        reason = `T2 was hit intraday at ₹${observedHigh.toFixed(2)} but price retraced to ₹${ltp.toFixed(2)} — exiting lot`
        tagSuffix = 't2'
      } else if (!lot.tranche1At && ltp >= lotT1Price) {
        // Ceil (not floor) so an odd remainingQty sells the extra share now
        // and a single-share lot closes here instead of leaving a 0-qty
        // remainder for T2 to chase.
        sellQty = Math.ceil(lot.remainingQty / 2)
        markTranche1 = true
        reason = `LTP ₹${ltp.toFixed(2)} ≥ T1 ₹${lotT1Price.toFixed(2)} — tranche 1 sell`
        tagSuffix = 't1'
      } else if (retraceAfterHit && !lot.tranche1At && observedHigh >= lotT1Price && ltp < lotT1Price && ltp > lot.entryPrice && gainPct >= minGainT1) {
        sellQty = Math.ceil(lot.remainingQty / 2)
        markTranche1 = true
        reason = `T1 was hit intraday at ₹${observedHigh.toFixed(2)} but price retraced to ₹${ltp.toFixed(2)} — tranche 1 sell`
        tagSuffix = 't1'
      } else if (lot.tranche1At && ltp >= lotT2Price) {
        sellQty = lot.remainingQty
        reason = `LTP ₹${ltp.toFixed(2)} ≥ T2 ₹${lotT2Price.toFixed(2)} — closing remainder`
        tagSuffix = 't2'
      } else if (retraceAfterHit && !!lot.tranche1At && observedHigh >= lotT2Price && ltp < lotT2Price && ltp > lot.entryPrice && gainPct >= minGainT2) {
        sellQty = lot.remainingQty
        reason = `T2 was hit intraday at ₹${observedHigh.toFixed(2)} but price retraced to ₹${ltp.toFixed(2)} — closing remainder`
        tagSuffix = 't2'
      }

      if (sellQty === 0) continue

      const pre = await runPreflight({
        account,
        symbol: pos.symbol,
        side: 'SELL',
        quantity: sellQty,
        pricePerShare: ltp,
        strategyId: pos.strategyId,
        bypassNoLossSellReason,
      }, broker)
      if (!pre.ok) {
        if (pre.gate === 'noLossSell') {
          appendJournal({
            type: 'signal_skipped',
            date: istDateString(),
            time: istHHMM(),
            account,
            symbol: pos.symbol,
            signalPrice: ltp,
            reasonSkipped: `[noLossSell-exit] ${pre.reason || 'Auto mode blocked SELL at net loss'}`,
          }).catch(err => console.error('[pivotal] noLossSell journal write failed:', err))
          isSkipTradeMailsEnabled().then(enabled => {
            if (enabled) sendEmail('trade_skipped', { account, accountDisplayName: displayName, symbol: pos.symbol, side: 'SELL', quantity: sellQty, price: ltp, gate: 'noLossSell', reason: pre.reason || 'Auto mode blocked SELL at net loss' }).catch(() => {})
          }).catch(() => {})
        }
        if (pre.gate === 'noShort') {
          await removePosition(account, pos.symbol)
          entries.push({ account, accountDisplayName: displayName, symbol: pos.symbol, action: 'skipped', reason: 'Position no longer held in Kite — tracking cleared' })
        } else {
          entries.push({ account, accountDisplayName: displayName, symbol: pos.symbol, action: 'skipped', quantity: sellQty, entryPrice: lot.entryPrice, ltp, gainPct, reason: `Preflight ${pre.gate}: ${pre.reason}` })
        }
        continue
      }

      const actualQty = pre.adjustedQty ?? sellQty
      const tag = `dt-${pos.strategyId}-${tagSuffix}`
      const placed = await placeKiteOrder(creds, { symbol: pos.symbol, side: 'SELL', quantity: actualQty, tag })
      if (placed.ok && placed.data?.data?.order_id) {
        soldAnyLot = true
        await markPlaced(account, pos.symbol, 'SELL', { price: ltp, manual: false })
        await applyLotSell(account, pos.symbol, lot.id, actualQty, { markTranche1 })
        journalOrder({ account, symbol: pos.symbol, side: 'SELL', qty: actualQty, price: ltp, tag, orderId: placed.data.data.order_id })
          .catch(err => console.error('[pivotal] journalOrder failed:', err))
        appendJournal({
          type: 'trade',
          date: istDateString(),
          account,
          symbol: pos.symbol,
          qty: actualQty,
          entryPrice: lot.entryPrice,
          entryTime: lot.boughtAt,
          exitPrice: ltp,
          exitTime: new Date().toISOString(),
          pnlRupees: (ltp - lot.entryPrice) * actualQty,
          pnlPct: gainPct,
          dayHighAfterEntry: ltp,
          dayLowAfterEntry: ltp,
          leftOnTable: 0,
          verdict: classifyVerdict({ strategy: pos.strategyId, entryPrice: lot.entryPrice, exitPrice: ltp, t1TriggerPct: t1Pct, isDelivery: false }),
          strategy: pos.strategyId,
          orderIdSell: placed.data.data.order_id,
          notes: reason,
        }).catch(err => console.error('[pivotal] trade journal failed:', err))
        entries.push({ account, accountDisplayName: displayName, symbol: pos.symbol, action: 'sold', quantity: actualQty, entryPrice: lot.entryPrice, ltp, gainPct, orderId: placed.data.data.order_id, reason })
        sendEmail('trade_executed', {
          account,
          accountDisplayName: displayName,
          symbol: pos.symbol,
          side: 'SELL',
          quantity: actualQty,
          price: ltp,
          orderId: placed.data.data.order_id,
          source: `${ownerStrategy.name} auto-exit`,
          reason,
          mode: 'auto',
        }).catch(err => console.error('[pivotal] executed-email failed:', err))
      } else {
        const errMsg = placed.data?.message || placed.data?.error_type || `Kite HTTP ${placed.status}`
        entries.push({ account, accountDisplayName: displayName, symbol: pos.symbol, action: 'sold_failed', quantity: actualQty, entryPrice: lot.entryPrice, ltp, gainPct, reason: errMsg })
      }
    }

    if (!soldAnyLot) {
      const ageDays = (Date.now() - new Date(pos.firstBuyAt).getTime()) / (1000 * 60 * 60 * 24)
      if (params.deliveryHandoffDays > 0 && ageDays >= params.deliveryHandoffDays) {
        const changed = await setStrategyId(account, pos.symbol, 'accumulator')
        entries.push({
          account,
          accountDisplayName: displayName,
          symbol: pos.symbol,
          action: 'handoff',
          quantity: pos.remainingQty,
          entryPrice: pos.firstBuyPrice,
          ltp,
          gainPct: ((ltp - pos.firstBuyPrice) / pos.firstBuyPrice) * 100,
          reason: changed
            ? `${Math.floor(ageDays)} calendar days open — handed off to Accumulator`
            : `${Math.floor(ageDays)} calendar days open — already managed by Accumulator`,
        })
        continue
      }
      entries.push({
        account,
        accountDisplayName: displayName,
        symbol: pos.symbol,
        action: 'held',
        quantity: pos.remainingQty,
        entryPrice: pos.firstBuyPrice,
        ltp,
        gainPct: ((ltp - pos.firstBuyPrice) / pos.firstBuyPrice) * 100,
        reason: script?.stopLossPrice
          ? `Holding above stop-loss ₹${script.stopLossPrice.toFixed(2)} and below target`
          : 'Holding below target thresholds',
      })
    }
  }

  return { account, ranAt, positionsChecked: positions.length, entries }
}

export async function monitorAllPivotalAccounts(): Promise<PivotalMonitorResult[]> {
  const state = await getState()
  return Promise.all(Object.keys(state.kiteTokens).map(account => monitorPivotalAccount(account)))
}
