import { decrypt } from '@/lib/encryption'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getBroker, type IBroker } from './index'
import { getAccountSecrets, isAccountConfigured } from '@/lib/accounts'
import { getState } from '@/lib/state'

export interface CustomerBroker {
  brokerName: string
  broker: IBroker
  accessToken: string
  apiKey: string
}

export async function loadCustomerBroker(customerId: string): Promise<CustomerBroker | null> {
  if (isAccountConfigured(customerId)) {
    const secrets = getAccountSecrets(customerId)
    if (!secrets) return null
    const state = await getState()
    const accessToken = state.kiteTokens[customerId]
    if (!accessToken) return null
    return {
      brokerName: 'zerodha',
      broker: getBroker({ brokerName: 'zerodha', brokerCredentials: { ...secrets, accessToken } }),
      accessToken,
      apiKey: secrets.apiKey,
    }
  }

  const admin = getSupabaseAdmin()
  const { data: rows, error } = await admin
    .from('broker_accounts')
    .select('broker_name, api_key_enc, api_secret_enc, access_token_enc')
    .eq('customer_id', customerId)
    .eq('active', true)

  if (error) throw new Error(`[broker] failed to load customer broker: ${error.message}`)
  if (!rows?.length) return null
  if (rows.length !== 1) {
    throw new Error(`[broker] customer ${customerId} has ${rows.length} active broker accounts; exactly one must be selected`)
  }

  const row = rows[0]
  if (!row.api_key_enc || !row.access_token_enc) return null
  const apiKey = decrypt(row.api_key_enc)
  const apiSecret = row.api_secret_enc ? decrypt(row.api_secret_enc) : undefined
  const accessToken = decrypt(row.access_token_enc)
  const brokerName = String(row.broker_name)

  return {
    brokerName,
    broker: getBroker({ brokerName, brokerCredentials: { apiKey, accessToken, apiSecret } }),
    accessToken,
    apiKey,
  }
}

export async function loadMarketDataBroker(customerId: string): Promise<CustomerBroker | null> {
  const configuredCustomers = (process.env.CUSTOMER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
  const sourceCustomerId = configuredCustomers.length > 1 ? configuredCustomers[0] : customerId
  return loadCustomerBroker(sourceCustomerId)
}

export async function placeBrokerOrder(
  broker: IBroker,
  input: Parameters<IBroker['placeOrder']>[0],
): Promise<{ ok: boolean; status: number; data: { data?: { order_id?: string }; message?: string; error_type?: string } }> {
  try {
    const result = await broker.placeOrder(input)
    return { ok: true, status: 200, data: { data: { order_id: result.orderId } } }
  } catch (err) {
    return { ok: false, status: 502, data: { message: String(err) } }
  }
}