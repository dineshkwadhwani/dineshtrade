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

// Read the ordered list of account names from env: ZERODHA_ACCOUNT1, ZERODHA_ACCOUNT2, ...
// Stops at the first gap. Server-only (reads process.env).
export function getAccountList(): AccountDisplay[] {
  const accounts: AccountDisplay[] = []
  for (let i = 1; ; i++) {
    const name = process.env[`ZERODHA_ACCOUNT${i}`]
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

// Server-only. Returns null if either secret env var is missing for this account.
export function getAccountSecrets(name: string): AccountSecrets | null {
  const apiKey = process.env[`ZERODHA_API_KEY_${name}`]
  const apiSecret = process.env[`ZERODHA_API_SECRET_${name}`]
  if (!apiKey || !apiSecret) return null
  return { apiKey, apiSecret }
}

export function isAccountConfigured(name: string): boolean {
  return getAccountSecrets(name) !== null
}
