import { NextRequest, NextResponse } from 'next/server'
import { requireRole, AuthError } from '@/lib/dalgoAuth'
import { getReportsRows } from '@/lib/dalgoAdmin'

// GET /api/dalgo/admin/reports/export — Task 6.14.
// SuperAdmin exports across all customers (optionally filtered); an Account
// Manager's export is always forced to their own assigned customers,
// regardless of an `am` query param someone might tack on by hand.
function csvEscape(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireRole(['superadmin', 'account_manager'])
    const { searchParams } = new URL(req.url)
    const today = new Date().toISOString().slice(0, 10)
    const from = searchParams.get('from') || today
    const to = searchParams.get('to') || today

    const rows = await getReportsRows({
      fromDate: from,
      toDate: to,
      customerId: searchParams.get('customer') || undefined,
      assignedTo: actor.role === 'account_manager' ? actor.id : searchParams.get('am') || undefined,
    })

    const header = ['Customer', 'Total Orders', 'Total Buys', 'Total Sells', 'Total Trades', 'Winning Trades', 'Win Rate %']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push(
        [r.customerName, r.totalOrders, r.totalBuys, r.totalSells, r.totalTrades, r.winningTrades, r.winRatePct]
          .map(csvEscape)
          .join(',')
      )
    }

    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dalgo-report-${from}-to-${to}.csv"`,
      },
    })
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.statusCode })
    console.error('[reports/export] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
