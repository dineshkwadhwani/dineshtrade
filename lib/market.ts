// NSE holiday list 2026 - market closed on these dates
export const NSE_HOLIDAYS_2026 = [
  '2026-01-26','2026-02-19','2026-03-14','2026-03-25','2026-04-02',
  '2026-04-10','2026-04-14','2026-05-01','2026-08-15','2026-10-02',
  '2026-10-24','2026-11-05','2026-11-14','2026-12-25'
]

export function isMarketOpen(): { open: boolean; status: string; nextOpen?: string } {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = ist.getDay() // 0=Sun, 6=Sat
  const dateStr = ist.toISOString().slice(0,10)
  const hours = ist.getHours()
  const minutes = ist.getMinutes()
  const timeInMins = hours * 60 + minutes

  if (day === 0 || day === 6) return { open: false, status: 'Closed — Weekend' }
  if (NSE_HOLIDAYS_2026.includes(dateStr)) return { open: false, status: 'Closed — Market Holiday' }

  // Pre-market: 9:00–9:15, Market: 9:15–15:30, Post: 15:30–16:00
  if (timeInMins >= 9*60 && timeInMins < 9*60+15) return { open: false, status: 'Pre-Market (9:00–9:15)' }
  if (timeInMins >= 9*60+15 && timeInMins < 15*60+30) return { open: true, status: 'Market Open' }
  if (timeInMins >= 15*60+30 && timeInMins < 16*60) return { open: false, status: 'Post-Market (15:30–16:00)' }

  return { open: false, status: 'Market Closed' }
}

export function getISTDateTime(): { date: string; time: string; dayName: string } {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const hh = String(ist.getHours()).padStart(2,'0')
  const mm = String(ist.getMinutes()).padStart(2,'0')
  return {
    date: `${ist.getDate()} ${months[ist.getMonth()]} ${ist.getFullYear()}`,
    time: `${hh}:${mm} IST`,
    dayName: days[ist.getDay()]
  }
}
