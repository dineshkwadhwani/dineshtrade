const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const POS_FILE = path.join(DATA_DIR, 'positions.json')

function journalFiles() {
  return fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter(f => /^journal-\d{4}-\d{2}\.jsonl$/.test(f)).sort()
    : []
}

function readJournal() {
  const files = journalFiles()
  const records = []
  for (const file of files) {
    const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line))
      } catch (err) {
        console.warn(`Skipping malformed journal line in ${file}: ${err.message}`)
      }
    }
  }
  return records
}

function makeLotId(account, symbol, ts, qty, price) {
  const safeSymbol = symbol.replace(/[^A-Z0-9]/gi, '')
  const safeAccount = account.replace(/[^A-Z0-9]/gi, '')
  const hash = Buffer.from(`${ts}-${qty}-${price}`).toString('base64url').slice(0, 12)
  return `${safeAccount}:${safeSymbol}:${hash}`
}

function reconstructOpenLots(records, account, symbol) {
  const orders = records
    .filter(r => r.type === 'order' && r.account === account && r.symbol === symbol)
    .sort((a, b) => a.ts.localeCompare(b.ts))

  const openLots = []
  for (const order of orders) {
    if (order.side === 'BUY') {
      openLots.push({
        id: order.orderId ? `${order.orderId}` : makeLotId(order.account, order.symbol, order.ts, order.qty, order.price),
        boughtAt: order.ts,
        entryPrice: order.price,
        originalQty: order.qty,
        remainingQty: order.qty,
        tranche1At: null,
        strategyId: order.strategyId || null,
      })
    } else if (order.side === 'SELL') {
      let remaining = order.qty
      for (const lot of openLots) {
        if (remaining <= 0) break
        const take = Math.min(lot.remainingQty, remaining)
        lot.remainingQty -= take
        remaining -= take
      }
      if (remaining > 0) {
        throw new Error(`Sell ${order.qty} exceeds open quantity for ${account}:${symbol} at ${order.ts}`)
      }
    }
  }

  return openLots.filter(lot => lot.remainingQty > 0)
}

function weightedFirstBuyPrice(lots) {
  const totalQty = lots.reduce((sum, lot) => sum + lot.remainingQty, 0)
  if (totalQty === 0) return 0
  const totalValue = lots.reduce((sum, lot) => sum + lot.remainingQty * lot.entryPrice, 0)
  return Number((totalValue / totalQty).toFixed(2))
}

function isoMax(a, b) {
  if (!a) return b
  if (!b) return a
  return a < b ? b : a
}

function repairPosition(symbol) {
  const positions = JSON.parse(fs.readFileSync(POS_FILE, 'utf8'))
  const key = Object.keys(positions).find(k => k.toUpperCase().endsWith(`:${symbol.toUpperCase()}`))
  if (!key) {
    throw new Error(`Position for ${symbol} not found in ${POS_FILE}`)
  }

  const records = readJournal()
  const [account] = key.split(':')
  const openLots = reconstructOpenLots(records, account, symbol)
  if (openLots.length === 0) {
    throw new Error(`No open lots found for ${account}:${symbol} in journal`) }

  const normalizedLots = openLots.map(lot => ({ ...lot, entryPrice: Number(lot.entryPrice), originalQty: Number(lot.originalQty), remainingQty: Number(lot.remainingQty) }))
  const remainingQty = normalizedLots.reduce((sum, lot) => sum + lot.remainingQty, 0)
  const totalQty = normalizedLots.reduce((sum, lot) => sum + lot.originalQty, 0)
  const firstBuyAt = normalizedLots.reduce((earliest, lot) => !earliest || lot.boughtAt < earliest ? lot.boughtAt : earliest, normalizedLots[0].boughtAt)
  const firstBuyPrice = weightedFirstBuyPrice(normalizedLots)
  const strategyId = normalizedLots.length === 1 ? normalizedLots[0].strategyId || positions[key].strategyId : positions[key].strategyId

  const repaired = {
    ...positions[key],
    strategyId,
    totalQty,
    remainingQty,
    firstBuyPrice,
    firstBuyAt,
    lots: normalizedLots,
  }

  positions[key] = repaired
  const backup = `${POS_FILE}.bak.${Date.now()}`
  fs.copyFileSync(POS_FILE, backup)
  fs.writeFileSync(POS_FILE, JSON.stringify(positions, null, 2) + '\n', 'utf8')
  console.log(`Repaired ${key}. Backup written to ${backup}`)
  console.log('Repaired position:', {
    key,
    strategyId: repaired.strategyId,
    totalQty: repaired.totalQty,
    remainingQty: repaired.remainingQty,
    firstBuyPrice: repaired.firstBuyPrice,
    firstBuyAt: repaired.firstBuyAt,
    lots: repaired.lots.length,
  })
}

const symbol = process.argv[2]
if (!symbol) {
  console.error('Usage: node scripts/repair-position-by-journal.js SYMBOL')
  process.exit(1)
}

try {
  repairPosition(symbol.toUpperCase())
} catch (err) {
  console.error('ERROR:', err.message)
  process.exit(1)
}
