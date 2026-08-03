const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'data', 'positions.json')
const symbol = process.argv[2] || 'JINDALSTEL'
const raw = fs.readFileSync(file, 'utf8')
const data = JSON.parse(raw)
const key = Object.keys(data).find(k => k.endsWith(':' + symbol) || k.endsWith(':' + symbol.toUpperCase()))
if (!key) {
  console.error('Symbol not found:', symbol)
  process.exit(2)
}
const pos = data[key]
const lots = Array.isArray(pos.lots) ? pos.lots : []
let totalOriginal = 0
let totalRemaining = 0
for (const lot of lots) {
  totalOriginal += Number(lot.originalQty || 0)
  totalRemaining += Number(lot.remainingQty || 0)
}
console.log('Key:', key)
console.log('firstBuyPrice:', pos.firstBuyPrice)
console.log('totalQty (meta):', pos.totalQty, 'remainingQty (meta):', pos.remainingQty)
console.log('lotsCount:', lots.length)
console.log('sum originalQty:', totalOriginal)
console.log('sum remainingQty:', totalRemaining)
console.log('sampleLots (first 10):', lots.slice(0, 10))
