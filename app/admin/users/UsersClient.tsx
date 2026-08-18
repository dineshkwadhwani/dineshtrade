'use client'

import { useState } from 'react'
import { SectionCard } from '@/components/dalgo/ui'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'
import BrokerCompanyTab from './BrokerCompanyTab'

type Tab = 'managers' | 'broker' | 'customers'

const TABS: { id: Tab; label: string }[] = [
  { id: 'managers', label: 'Account Managers' },
  { id: 'broker',   label: 'Broker Company' },
  { id: 'customers', label: 'Customers' },
]

interface Props {
  managersTab: React.ReactNode
  customersTab: React.ReactNode
}

export default function UsersClient({ managersTab, customersTab }: Props) {
  const [tab, setTab] = useState<Tab>('managers')

  return (
    <div>
      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        borderBottom: `1px solid ${COLORS.border}`, paddingBottom: 0,
      }}>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                fontFamily: FONT_INTER, fontSize: 13, fontWeight: active ? 600 : 400,
                padding: '8px 16px',
                border: 'none', borderBottom: active ? `2px solid ${COLORS.primary}` : '2px solid transparent',
                background: 'none', cursor: 'pointer',
                color: active ? COLORS.primary : COLORS.muted,
                marginBottom: -1,
                transition: 'color 0.15s',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <SectionCard>
        {tab === 'managers'  && managersTab}
        {tab === 'broker'    && <BrokerCompanyTab />}
        {tab === 'customers' && customersTab}
      </SectionCard>
    </div>
  )
}
