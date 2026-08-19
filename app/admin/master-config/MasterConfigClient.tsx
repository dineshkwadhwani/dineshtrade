'use client'

import { useState } from 'react'
import { COLORS, FONT_INTER } from '@/components/dalgo/theme'

type Tab = 'fixed-rules' | 'strategies' | 'capital'

const TABS: { id: Tab; label: string }[] = [
  { id: 'fixed-rules',  label: 'Fixed Rules' },
  { id: 'strategies',   label: 'Platform Strategies' },
  { id: 'capital',      label: 'Shared Capital' },
]

interface Props {
  fixedRulesTab: React.ReactNode
  strategiesTab: React.ReactNode
  sharedCapitalTab: React.ReactNode
}

export default function MasterConfigClient({ fixedRulesTab, strategiesTab, sharedCapitalTab }: Props) {
  const [tab, setTab] = useState<Tab>('fixed-rules')

  return (
    <div>
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                fontFamily: FONT_INTER, fontSize: 13, fontWeight: active ? 600 : 400,
                padding: '8px 18px',
                border: 'none', borderBottom: active ? `2px solid ${COLORS.primary}` : '2px solid transparent',
                background: 'none', cursor: 'pointer',
                color: active ? COLORS.primary : COLORS.muted,
                marginBottom: -1, transition: 'color 0.15s',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'fixed-rules'  && fixedRulesTab}
      {tab === 'strategies'   && strategiesTab}
      {tab === 'capital'      && sharedCapitalTab}
    </div>
  )
}
