'use client'
import { useState } from 'react'
import AuthShowcasePanel from '@/components/marketing/AuthShowcasePanel'

const FONT_SORA = "'Sora', sans-serif"
const FONT_INTER = "'Inter', sans-serif"

const DISCLAIMER =
  'DAlgo is a software platform that enables automated trading. We are not a ' +
  'SEBI-registered investment advisor and do not provide investment advice. ' +
  'All trading strategies, parameters, and decisions are yours. By registering, ' +
  'you confirm you have read and understood our Terms of Service, Privacy Policy, ' +
  'and Risk Disclosure.'

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]

type Mode = 'customer' | 'broking_company'
type UploadStatus = 'idle' | 'uploading' | 'uploaded' | 'error'

interface UploadState {
  status: UploadStatus
  path: string
  fileName: string
  error?: string
}

const EMPTY_UPLOAD: UploadState = { status: 'idle', path: '', fileName: '' }

interface FormState {
  fullName: string; email: string; password: string; mobile: string; dob: string
  address: string; city: string; state: string; pincode: string; aadharNumber: string
  companyName: string; gstNumber: string; companyRegistrationNumber: string
  companyAddress: string; companyCity: string; companyState: string; companyPincode: string
  companyEmail: string; companyMobile: string
}

const EMPTY_FORM: FormState = {
  fullName: '', email: '', password: '', mobile: '', dob: '', address: '', city: '', state: '', pincode: '', aadharNumber: '',
  companyName: '', gstNumber: '', companyRegistrationNumber: '', companyAddress: '', companyCity: '', companyState: '', companyPincode: '', companyEmail: '', companyMobile: '',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontFamily: FONT_INTER, fontSize: 13, fontWeight: 500, color: '#1E3A8A', marginBottom: 6,
}

function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '10px 14px',
    border: `1px solid ${hasError ? '#EF4444' : '#BFDBFE'}`,
    borderRadius: 8, fontFamily: FONT_INTER, fontSize: 14, color: '#0F172A',
    outline: 'none', background: '#fff', boxSizing: 'border-box',
  }
}

function maskAadhar(digits: string): string {
  const clean = digits.replace(/\D/g, '').slice(0, 12)
  return [clean.slice(0, 4), clean.slice(4, 8), clean.slice(8, 12)].filter(Boolean).join(' ')
}

function aadharDisplayValue(digits: string, focused: boolean): string {
  if (focused || digits.length < 12) return maskAadhar(digits)
  return `XXXX XXXX ${digits.slice(8)}`
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#F8FAFF' }}>
      <AuthShowcasePanel />

      <div className="flex-1 flex flex-col items-center justify-center" style={{ padding: '32px 16px', fontFamily: FONT_INTER }}>
        <div
          style={{
            width: '100%', maxWidth: 560, background: '#FFFFFF', border: '1px solid #BFDBFE',
            borderRadius: 16, padding: 40, boxShadow: '0 4px 24px rgba(30,58,138,0.06)',
          }}
        >
          <a href="/" aria-label="Go to DAlgo landing page" className="md:hidden" style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 26, marginBottom: 24, textAlign: 'center', textDecoration: 'none', display: 'block' }}>
            <span style={{ color: '#1E3A8A' }}>D</span>
            <span style={{ color: '#F59E0B' }}>A</span>
            <span style={{ color: '#1E3A8A' }}>lgo</span>
          </a>
          {children}
        </div>
      </div>
    </div>
  )
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {children}
      {error && <p style={{ fontFamily: FONT_INTER, color: '#EF4444', fontSize: 12, marginTop: 4, marginBottom: 0 }}>{error}</p>}
    </div>
  )
}

function UploadBox({ id, label, upload, error, onFile }: {
  id: string; label: string; upload: UploadState; error?: string; onFile: (file: File) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const borderColor = error ? '#EF4444' : dragOver ? '#3B82F6' : '#BFDBFE'
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>{label}</label>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files?.[0]
          if (file) onFile(file)
        }}
        onClick={() => document.getElementById(id)?.click()}
        style={{
          border: `1.5px dashed ${borderColor}`, borderRadius: 8, padding: '20px 14px',
          textAlign: 'center', cursor: 'pointer', background: dragOver ? '#EFF6FF' : '#F8FAFF',
        }}
      >
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
        <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#475569', margin: 0 }}>
          {upload.status === 'idle' && 'Click or drag a file here (JPEG, PNG, or PDF, max 5MB)'}
          {upload.status === 'uploading' && `Uploading ${upload.fileName}…`}
          {upload.status === 'uploaded' && `✓ Uploaded — ${upload.fileName}`}
          {upload.status === 'error' && `✗ ${upload.error || 'Upload failed'} — click to retry`}
        </p>
      </div>
      {error && <p style={{ fontFamily: FONT_INTER, color: '#EF4444', fontSize: 12, marginTop: 4, marginBottom: 0 }}>{error}</p>}
    </div>
  )
}

export default function RegisterClient() {
  const [mode, setMode] = useState<Mode>('customer')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [aadharFocused, setAadharFocused] = useState(false)
  const [aadharFront, setAadharFront] = useState<UploadState>(EMPTY_UPLOAD)
  const [aadharBack, setAadharBack] = useState<UploadState>(EMPTY_UPLOAD)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setFieldErrors(fe => {
      if (!fe[key]) return fe
      const next = { ...fe }
      delete next[key]
      return next
    })
  }

  async function handleUpload(file: File, which: 'aadharFront' | 'aadharBack') {
    const setUpload = which === 'aadharFront' ? setAadharFront : setAadharBack
    if (file.size > 5 * 1024 * 1024) {
      setUpload({ status: 'error', path: '', fileName: file.name, error: 'File exceeds 5MB' })
      return
    }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setUpload({ status: 'error', path: '', fileName: file.name, error: 'Must be JPEG, PNG, or PDF' })
      return
    }
    setUpload({ status: 'uploading', path: '', fileName: file.name })
    try {
      const res = await fetch('/api/dalgo/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to get upload URL')
      const putRes = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) throw new Error('Upload to storage failed')
      setUpload({ status: 'uploaded', path: data.path, fileName: file.name })
    } catch (err) {
      setUpload({ status: 'error', path: '', fileName: file.name, error: err instanceof Error ? err.message : 'Upload failed' })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (aadharFront.status !== 'uploaded' || aadharBack.status !== 'uploaded') {
      setError('Please upload both Aadhar front and back images before submitting.')
      return
    }

    setLoading(true)
    const payload: Record<string, unknown> = {
      type: mode,
      email: form.email,
      password: form.password,
      fullName: form.fullName,
      dob: form.dob,
      address: form.address,
      city: form.city,
      state: form.state,
      pincode: form.pincode,
      mobile: form.mobile,
      aadharNumber: form.aadharNumber,
      aadharFrontPath: aadharFront.path,
      aadharBackPath: aadharBack.path,
    }
    if (mode === 'broking_company') {
      Object.assign(payload, {
        companyName: form.companyName,
        gstNumber: form.gstNumber,
        companyRegistrationNumber: form.companyRegistrationNumber,
        companyAddress: form.companyAddress,
        companyCity: form.companyCity,
        companyState: form.companyState,
        companyPincode: form.companyPincode,
        companyEmail: form.companyEmail,
        companyMobile: form.companyMobile,
      })
    }

    try {
      const res = await fetch('/api/dalgo/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 400 && data.fields) {
          setFieldErrors(data.fields)
          setError('Please fix the highlighted fields.')
        } else {
          setError(data.error || 'Registration failed. Please try again.')
        }
        setLoading(false)
        return
      }
      window.location.href = '/pending'
    } catch {
      setError('Connection error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <CardShell>
      <h1 style={{ fontFamily: FONT_SORA, fontWeight: 700, fontSize: 22, color: '#1E3A8A', margin: 0 }}>
        Create your DAlgo account
      </h1>
      <p style={{ fontFamily: FONT_INTER, fontSize: 14, color: '#475569', marginTop: 6, marginBottom: 20 }}>
        Register as an individual, or on behalf of a broking company.
      </p>

      <div style={{ display: 'flex', gap: 20, marginBottom: 24 }}>
        {(['customer', 'broking_company'] as Mode[]).map(m => (
          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT_INTER, fontSize: 14, color: '#1E3A8A', cursor: 'pointer' }}>
            <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
            {m === 'customer' ? 'Individual (Customer)' : 'Broking Company'}
          </label>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* ---- Personal / KYC fields — always shown, exactly once ---- */}
        <Field id="reg-fullName" label="Full name (as in Aadhar card)" error={fieldErrors.fullName}>
          <input id="reg-fullName" required autoComplete="name" value={form.fullName}
            onChange={e => update('fullName', e.target.value)} style={inputStyle(!!fieldErrors.fullName)} />
        </Field>

        <Field id="reg-email" label="Email address" error={fieldErrors.email}>
          <input id="reg-email" type="email" required autoComplete="email" value={form.email}
            onChange={e => update('email', e.target.value)} style={inputStyle(!!fieldErrors.email)} />
        </Field>

        <Field id="reg-password" label="Password (min 8 characters)" error={fieldErrors.password}>
          <input id="reg-password" type="password" required minLength={8} autoComplete="new-password" value={form.password}
            onChange={e => update('password', e.target.value)} style={inputStyle(!!fieldErrors.password)} />
        </Field>

        <Field id="reg-mobile" label="Mobile number" error={fieldErrors.mobile}>
          <input id="reg-mobile" type="tel" required autoComplete="tel" value={form.mobile}
            onChange={e => update('mobile', e.target.value)} style={inputStyle(!!fieldErrors.mobile)} />
        </Field>

        <Field id="reg-dob" label="Date of birth" error={fieldErrors.dob}>
          <input id="reg-dob" type="date" required value={form.dob}
            onChange={e => update('dob', e.target.value)} style={inputStyle(!!fieldErrors.dob)} />
        </Field>

        <Field id="reg-address" label="Address" error={fieldErrors.address}>
          <input id="reg-address" required value={form.address}
            onChange={e => update('address', e.target.value)} style={inputStyle(!!fieldErrors.address)} />
        </Field>

        <Field id="reg-city" label="City" error={fieldErrors.city}>
          <input id="reg-city" required value={form.city}
            onChange={e => update('city', e.target.value)} style={inputStyle(!!fieldErrors.city)} />
        </Field>

        <Field id="reg-state" label="State" error={fieldErrors.state}>
          <select id="reg-state" required value={form.state}
            onChange={e => update('state', e.target.value)} style={inputStyle(!!fieldErrors.state)}>
            <option value="" disabled>Select a state</option>
            {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        <Field id="reg-pincode" label="Pincode" error={fieldErrors.pincode}>
          <input id="reg-pincode" required inputMode="numeric" maxLength={6} value={form.pincode}
            onChange={e => update('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} style={inputStyle(!!fieldErrors.pincode)} />
        </Field>

        <Field id="reg-aadhar" label="Aadhar card number" error={fieldErrors.aadharNumber}>
          <input
            id="reg-aadhar" required inputMode="numeric"
            value={aadharDisplayValue(form.aadharNumber, aadharFocused)}
            onFocus={() => setAadharFocused(true)}
            onBlur={() => setAadharFocused(false)}
            onChange={e => update('aadharNumber', e.target.value.replace(/\D/g, '').slice(0, 12))}
            style={inputStyle(!!fieldErrors.aadharNumber)}
          />
        </Field>

        <UploadBox id="reg-aadhar-front" label="Aadhar front image" upload={aadharFront}
          error={fieldErrors.aadharFrontPath} onFile={f => handleUpload(f, 'aadharFront')} />

        <UploadBox id="reg-aadhar-back" label="Aadhar back image" upload={aadharBack}
          error={fieldErrors.aadharBackPath} onFile={f => handleUpload(f, 'aadharBack')} />

        {/* ---- Company fields — only in Broking Company mode, exactly once ---- */}
        {mode === 'broking_company' && (
          <>
            <div style={{ borderTop: '1px solid #BFDBFE', margin: '20px 0 16px', paddingTop: 16 }}>
              <p style={{ fontFamily: FONT_SORA, fontWeight: 600, fontSize: 15, color: '#1E3A8A', margin: 0 }}>
                Company details
              </p>
            </div>

            <Field id="reg-companyName" label="Company name" error={fieldErrors.companyName}>
              <input id="reg-companyName" required value={form.companyName}
                onChange={e => update('companyName', e.target.value)} style={inputStyle(!!fieldErrors.companyName)} />
            </Field>

            <Field id="reg-gstNumber" label="GST number" error={fieldErrors.gstNumber}>
              <input id="reg-gstNumber" required value={form.gstNumber}
                onChange={e => update('gstNumber', e.target.value.toUpperCase())} style={inputStyle(!!fieldErrors.gstNumber)} />
            </Field>

            <Field id="reg-companyRegistrationNumber" label="Company registration number" error={fieldErrors.companyRegistrationNumber}>
              <input id="reg-companyRegistrationNumber" required value={form.companyRegistrationNumber}
                onChange={e => update('companyRegistrationNumber', e.target.value)} style={inputStyle(!!fieldErrors.companyRegistrationNumber)} />
            </Field>

            <Field id="reg-companyAddress" label="Company address" error={fieldErrors.companyAddress}>
              <input id="reg-companyAddress" required value={form.companyAddress}
                onChange={e => update('companyAddress', e.target.value)} style={inputStyle(!!fieldErrors.companyAddress)} />
            </Field>

            <Field id="reg-companyCity" label="Company city" error={fieldErrors.companyCity}>
              <input id="reg-companyCity" required value={form.companyCity}
                onChange={e => update('companyCity', e.target.value)} style={inputStyle(!!fieldErrors.companyCity)} />
            </Field>

            <Field id="reg-companyState" label="Company state" error={fieldErrors.companyState}>
              <select id="reg-companyState" required value={form.companyState}
                onChange={e => update('companyState', e.target.value)} style={inputStyle(!!fieldErrors.companyState)}>
                <option value="" disabled>Select a state</option>
                {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            <Field id="reg-companyPincode" label="Company pincode" error={fieldErrors.companyPincode}>
              <input id="reg-companyPincode" required inputMode="numeric" maxLength={6} value={form.companyPincode}
                onChange={e => update('companyPincode', e.target.value.replace(/\D/g, '').slice(0, 6))} style={inputStyle(!!fieldErrors.companyPincode)} />
            </Field>

            <Field id="reg-companyEmail" label="Company email" error={fieldErrors.companyEmail}>
              <input id="reg-companyEmail" type="email" required value={form.companyEmail}
                onChange={e => update('companyEmail', e.target.value)} style={inputStyle(!!fieldErrors.companyEmail)} />
            </Field>

            <Field id="reg-companyMobile" label="Company mobile" error={fieldErrors.companyMobile}>
              <input id="reg-companyMobile" type="tel" required value={form.companyMobile}
                onChange={e => update('companyMobile', e.target.value)} style={inputStyle(!!fieldErrors.companyMobile)} />
            </Field>
          </>
        )}

        {/* ---- Disclaimer, error, submit, login link — exactly once, after everything above ---- */}
        <p style={{ fontFamily: FONT_INTER, fontSize: 11, color: '#94A3B8', marginTop: 24, marginBottom: 16, lineHeight: 1.6 }}>
          {DISCLAIMER}
        </p>

        {error && (
          <p style={{ fontFamily: FONT_INTER, color: '#EF4444', fontSize: 13, marginTop: 0, marginBottom: 12 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '12px 0', background: '#3B82F6', color: '#FFFFFF',
            fontFamily: FONT_INTER, fontWeight: 600, fontSize: 14, border: 'none', borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Submitting…' : 'Submit application'}
        </button>

        <p style={{ fontFamily: FONT_INTER, fontSize: 13, color: '#475569', textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          Already have an account? <a href="/login" style={{ color: '#3B82F6' }}>Log in</a>
        </p>
      </form>
    </CardShell>
  )
}
