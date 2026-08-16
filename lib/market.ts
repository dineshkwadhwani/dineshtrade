import { getSupabaseAdmin } from './supabase'

const HOLIDAY_CACHE_TTL_MS = 5 * 60 * 1000
let holidayCache: string[] = []
let holidayCacheAt = 0

export async function getNseHolidays(forceRefresh = false): Promise<string[]> {
  const now = Date.now()
  if (!forceRefresh && holidayCacheAt > 0 && now - holidayCacheAt < HOLIDAY_CACHE_TTL_MS) {
    return holidayCache
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('platform_holidays')
    .select('holiday_date')
    .eq('market', 'NSE')
    .eq('active', true)
    .order('holiday_date', { ascending: true })

  if (error) {
    throw new Error(`[market] failed to load platform holidays: ${error.message}`)
  }

  holidayCache = Array.from(new Set((data || []).map(row => String(row.holiday_date))))
  holidayCacheAt = now
  return holidayCache
}

export async function isMarketOpen(): Promise<{ open: boolean; status: string; nextOpen?: string }> {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = ist.getDay() // 0=Sun, 6=Sat
  const dateStr = ist.toISOString().slice(0,10)
  const hours = ist.getHours()
  const minutes = ist.getMinutes()
  const timeInMins = hours * 60 + minutes

  if (day === 0 || day === 6) return { open: false, status: 'Closed — Weekend' }
  const holidays = await getNseHolidays()
  if (holidays.includes(dateStr)) return { open: false, status: 'Closed — Market Holiday' }

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
