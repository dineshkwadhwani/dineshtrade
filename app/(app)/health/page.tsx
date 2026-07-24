'use client'
import { useState } from 'react'

type LogLevel = 'info' | 'ok' | 'error' | 'warn'
interface LogLine { level: LogLevel; msg: string }
type TestStatus = 'idle' | 'running' | 'pass' | 'fail'

interface TestState {
  status: TestStatus
  logs: LogLine[]
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  info:  'text-gray-300',
  ok:    'text-emerald-400',
  error: 'text-red-400',
  warn:  'text-amber-400',
}

const LEVEL_PREFIX: Record<LogLevel, string> = {
  info:  '·',
  ok:    '✓',
  error: '✗',
  warn:  '⚠',
}

const STATUS_BADGE: Record<TestStatus, { label: string; cls: string }> = {
  idle:    { label: 'Not tested',  cls: 'bg-gray-800 text-gray-400' },
  running: { label: 'Testing…',   cls: 'bg-blue-900/60 text-blue-300 animate-pulse' },
  pass:    { label: 'OK',         cls: 'bg-emerald-900/60 text-emerald-300' },
  fail:    { label: 'Failed',     cls: 'bg-red-900/60 text-red-300' },
}

const TESTS: { key: string; label: string; icon: string; description: string }[] = [
  {
    key:         'zerodha',
    label:       'Zerodha',
    icon:        '⚡',
    description: 'Resolves account credentials and calls Kite /user/profile to verify the access token is valid.',
  },
  {
    key:         'ai',
    label:       'AI Provider',
    icon:        '◈',
    description: 'Sends a ping prompt to the configured AI provider (Gemini / Groq / Claude) and checks for a valid response.',
  },
  {
    key:         'email',
    label:       'Email (SMTP)',
    icon:        '✉',
    description: 'Connects to Gmail SMTP with the configured App Password and sends a test email to NOTIFY_TO.',
  },
]

export default function HealthPage() {
  const [states, setStates] = useState<Record<string, TestState>>(() =>
    Object.fromEntries(TESTS.map(t => [t.key, { status: 'idle', logs: [] }]))
  )

  async function runTest(key: string) {
    setStates(prev => ({ ...prev, [key]: { status: 'running', logs: [] } }))
    try {
      const res = await fetch(`/api/health?test=${key}`)
      const data = await res.json()
      setStates(prev => ({
        ...prev,
        [key]: {
          status: data.ok ? 'pass' : 'fail',
          logs: data.logs || [{ level: 'error', msg: data.error || 'Unknown error' }],
        },
      }))
    } catch (err) {
      setStates(prev => ({
        ...prev,
        [key]: {
          status: 'fail',
          logs: [{ level: 'error', msg: `Network error: ${String(err)}` }],
        },
      }))
    }
  }

  function runAll() {
    TESTS.forEach(t => runTest(t.key))
  }

  const allDone = TESTS.every(t => states[t.key].status !== 'idle' && states[t.key].status !== 'running')
  const anyRunning = TESTS.some(t => states[t.key].status === 'running')

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Integration Health</h1>
          <p className="text-sm text-gray-400 mt-0.5">Test connectivity to Zerodha, AI provider, and email.</p>
        </div>
        <button
          onClick={runAll}
          disabled={anyRunning}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          {anyRunning ? 'Testing…' : 'Test All'}
        </button>
      </div>

      {/* Test Cards */}
      {TESTS.map(test => {
        const state = states[test.key]
        const badge = STATUS_BADGE[state.status]
        return (
          <div
            key={test.key}
            className="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden"
          >
            {/* Card header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <span className="text-lg">{test.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-white">{test.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{test.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
                <button
                  onClick={() => runTest(test.key)}
                  disabled={state.status === 'running'}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 transition-colors"
                >
                  {state.status === 'running' ? 'Running…' : 'Test'}
                </button>
              </div>
            </div>

            {/* Log output */}
            {state.logs.length > 0 && (
              <div className="px-5 py-3 font-mono text-xs space-y-1 bg-gray-950/60">
                {state.logs.map((line, i) => (
                  <div key={i} className={`flex gap-2 ${LEVEL_STYLE[line.level]}`}>
                    <span className="flex-shrink-0 w-3">{LEVEL_PREFIX[line.level]}</span>
                    <span className="break-all">{line.msg}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Idle placeholder */}
            {state.status === 'idle' && (
              <div className="px-5 py-3 text-xs text-gray-600 font-mono">
                Press Test to run
              </div>
            )}

            {/* Running spinner */}
            {state.status === 'running' && state.logs.length === 0 && (
              <div className="px-5 py-3 text-xs text-blue-400 font-mono animate-pulse">
                Running test…
              </div>
            )}
          </div>
        )
      })}

      {/* Summary */}
      {allDone && (
        <div className={`rounded-lg px-5 py-3 text-sm font-medium ${
          TESTS.every(t => states[t.key].status === 'pass')
            ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-800'
            : 'bg-red-900/30 text-red-300 border border-red-800'
        }`}>
          {TESTS.every(t => states[t.key].status === 'pass')
            ? '✓ All integrations healthy'
            : `✗ ${TESTS.filter(t => states[t.key].status === 'fail').map(t => t.label).join(', ')} failed — check logs above`}
        </div>
      )}
    </div>
  )
}
