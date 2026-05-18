import accountsConfig from '@/config/accounts.json'

export interface AccountDisplay {
  name: string         // env-key, uppercase (e.g. "DINESH") — matches ZERODHA_ACCOUNTn value
  displayName: string  // human-readable (e.g. "Dinesh Wadhwani")
  initials: string     // avatar initials (e.g. "DW")
  color: string        // hex color for UI accents
  note: string         // short description
}

export interface AccountSecrets {
  apiKey: string
  apiSecret: string
}

const displayByName = new Map<string, AccountDisplay>(
  (accountsConfig as AccountDisplay[]).map(a => [a.name, a])
)

// Returns the active env prefix (e.g. "TEST", "PROD") or null when ZERODHA_ENVIRONMENT
// is missing/empty. Prefix-based scheme — env vars look like
// {PREFIX}_ZERODHA_ACCOUNT1, {PREFIX}_ZERODHA_API_KEY_DINESH, etc.
export function getEnvironment(): string | null {
  const raw = (process.env.ZERODHA_ENVIRONMENT || '').trim().toUpperCase()
  return raw || null
}

// Read the ordered list of account names from env: {PREFIX}_ZERODHA_ACCOUNT1, ...
// Stops at the first gap. Server-only (reads process.env).
export function getAccountList(): AccountDisplay[] {
  const prefix = getEnvironment()
  if (!prefix) return []
  const accounts: AccountDisplay[] = []
  for (let i = 1; ; i++) {
    const name = process.env[`${prefix}_ZERODHA_ACCOUNT${i}`]
    if (!name) break
    const display = displayByName.get(name)
    accounts.push(display ?? {
      name,
      displayName: name,
      initials: name.slice(0, 2).toUpperCase(),
      color: '#c9a84c',
      note: '',
    })
  }
  return accounts
}

// Server-only. Returns null if either secret env var is missing for this account
// in the current environment.
export function getAccountSecrets(name: string): AccountSecrets | null {
  const prefix = getEnvironment()
  if (!prefix) return null
  const apiKey = process.env[`${prefix}_ZERODHA_API_KEY_${name}`]
  const apiSecret = process.env[`${prefix}_ZERODHA_API_SECRET_${name}`]
  if (!apiKey || !apiSecret) return null
  return { apiKey, apiSecret }
}

export function isAccountConfigured(name: string): boolean {
  return getAccountSecrets(name) !== null
}
