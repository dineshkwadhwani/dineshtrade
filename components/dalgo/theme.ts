// Shared DAlgo SuperAdmin / Account Manager design tokens.
// See docs/DALGO_REFACTOR_SPEC_v2.md Phase 6 task brief for the source of
// truth — these are plain inline-style constants (not Tailwind theme colors)
// to match the pattern already established by app/login/LoginClient.tsx and
// the Phase 1 /admin, /manager placeholder pages.

export const COLORS = {
  pageBg: '#F8FAFF',
  cardBg: '#FFFFFF',
  primary: '#3B82F6',
  primaryHover: '#1D4ED8',
  heading: '#1E3A8A',
  body: '#475569',
  muted: '#94A3B8',
  border: '#BFDBFE',

  statusGreenText: '#16A34A',
  statusGreenBg: '#DCFCE7',
  statusRedText: '#DC2626',
  statusRedBg: '#FEE2E2',
  statusAmberText: '#D97706',
  statusAmberBg: '#FEF3C7',
  statusGreyText: '#64748B',
  statusGreyBg: '#F1F5F9',

  tealText: '#0D5C6B',
  tealBg: '#E6FAFA',
  tealBorder: '#7DD8E0',

  logoD: '#1E3A8A',
  logoA: '#F59E0B',
} as const

export const FONT_SORA = "'Sora', sans-serif"
export const FONT_INTER = "'Inter', sans-serif"

export const FONT_LINK_HREF =
  'https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;500&display=swap'

export type StatusTone = 'green' | 'red' | 'amber' | 'grey' | 'teal'

export const TONE_STYLE: Record<StatusTone, { color: string; background: string; border?: string }> = {
  green: { color: COLORS.statusGreenText, background: COLORS.statusGreenBg },
  red: { color: COLORS.statusRedText, background: COLORS.statusRedBg },
  amber: { color: COLORS.statusAmberText, background: COLORS.statusAmberBg },
  grey: { color: COLORS.statusGreyText, background: COLORS.statusGreyBg },
  teal: { color: COLORS.tealText, background: COLORS.tealBg, border: COLORS.tealBorder },
}
