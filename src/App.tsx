import { useEffect, useState, type ChangeEvent } from 'react'
import { deleteScan, listScans, type Fields, type Scan } from './db'
import { queueOcr, scanPhoto, warmUpOcr } from './scan'

const FIELD_LABELS: [keyof Fields, string][] = [
  ['product', 'Product'],
  ['color', 'Color'],
  ['capacity', 'Capacity'],
  ['partNo', 'Part no.'],
  ['model', 'Model'],
  ['serial', 'Serial'],
  ['imei1', 'IMEI 1'],
  ['imei2', 'IMEI 2'],
  ['eid', 'EID'],
  ['upc', 'UPC'],
]

function useObjectUrl(blob: Blob) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

function findDuplicate(scan: Scan, all: Scan[]) {
  const keys = [scan.fields.serial, scan.fields.imei1].filter(Boolean)
  return all.find((s) => s.id !== scan.id && keys.some((k) => k === s.fields.serial || k === s.fields.imei1))
}

function exportCsv(scans: Scan[]) {
  // ="…" keeps long numbers like IMEI/EID from turning into 3.56E+14 in Excel and Sheets.
  const cell = (v = '') => (/^\d{10,}$/.test(v) ? `"=""${v}"""` : `"${v.replace(/"/g, '""')}"`)
  const header = ['Scanned at', ...FIELD_LABELS.map(([, l]) => l), 'Barcodes', 'OCR text']
  const rows = scans.map((s) => [
    cell(new Date(s.createdAt).toLocaleString()),
    ...FIELD_LABELS.map(([k]) => cell(s.fields[k])),
    cell(s.barcodes.map((b) => `${b.format}:${b.text}`).join(' | ')),
    cell(s.ocrText ?? ''),
  ])
  const csv = [header.map((h) => cell(h)), ...rows].map((r) => r.join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `resi-scans-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="value"
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1000)
      }}
    >
      {value}
      <span className="copy">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

function ScanCard({ scan, open, onToggle, onDelete, duplicate }: {
  scan: Scan
  open: boolean
  onToggle: () => void
  onDelete: () => void
  duplicate: boolean
}) {
  const thumb = useObjectUrl(open ? scan.photo : scan.thumb)
  const f = scan.fields
  const title = [f.product, f.color, f.capacity].filter(Boolean).join(' · ') || f.serial || 'Unknown item'

  return (
    <li className={`card${open ? ' open' : ''}`}>
      <button className="summary" onClick={onToggle}>
        <img src={thumb} alt="" />
        <div>
          <strong>{title}</strong>
          <span className="sub">{f.serial ? `SN ${f.serial}` : `${scan.barcodes.length} barcodes`}</span>
          <span className="sub">
            {new Date(scan.createdAt).toLocaleString()}
            {scan.ocrStatus === 'pending' && <em className="tag">reading text…</em>}
            {scan.ocrStatus === 'error' && <em className="tag warn">text failed</em>}
            {duplicate && <em className="tag warn">duplicate</em>}
          </span>
        </div>
      </button>

      {open && (
        <div className="details">
          <dl>
            {FIELD_LABELS.filter(([k]) => f[k]).map(([k, label]) => (
              <div key={k}>
                <dt>{label}</dt>
                <dd><CopyValue value={f[k]!} /></dd>
              </div>
            ))}
          </dl>
          {scan.barcodes.length > 0 && (
            <details>
              <summary>Raw barcodes ({scan.barcodes.length})</summary>
              <ul className="raw">
                {scan.barcodes.map((b, i) => <li key={i}><code>{b.format}</code> {b.text}</li>)}
              </ul>
            </details>
          )}
          <details>
            <summary>All text</summary>
            <pre>{scan.ocrText ?? (scan.ocrStatus === 'pending' ? 'Reading…' : 'No text')}</pre>
          </details>
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      )}
    </li>
  )
}

export default function App() {
  const [scans, setScans] = useState<Scan[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [openId, setOpenId] = useState<string>()
  const [query, setQuery] = useState('')

  const refresh = () => listScans().then(setScans)

  useEffect(() => {
    warmUpOcr()
    void listScans().then((all) => {
      setScans(all)
      // Resume OCR for anything left unfinished when the app was closed.
      const pending = all.filter((s) => s.ocrStatus === 'pending').map((s) => s.id)
      if (pending.length) queueOcr(pending, refresh)
    })
  }, [])

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(undefined)
    try {
      const scan = await scanPhoto(file)
      setOpenId(scan.id)
      await refresh()
      if (!scan.barcodes.length) setError('No barcodes found — the text is still being read. Try a closer, glare-free photo.')
      queueOcr([scan.id], refresh)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this scan?')) return
    await deleteScan(id)
    await refresh()
  }

  const q = query.trim().toLowerCase()
  const shown = q
    ? scans.filter((s) =>
        [...Object.values(s.fields), ...s.barcodes.map((b) => b.text), s.ocrText ?? '']
          .some((v) => v?.toLowerCase().includes(q)))
    : scans

  return (
    <main>
      <header>
        <h1>Resi Tracker</h1>
        <button className="ghost" disabled={!scans.length} onClick={() => exportCsv(scans)}>
          Export CSV
        </button>
      </header>

      <div className="actions">
        <label className={`primary${busy ? ' disabled' : ''}`}>
          {busy ? 'Reading barcodes…' : 'Scan box'}
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} disabled={busy} hidden />
        </label>
        <label className={`secondary${busy ? ' disabled' : ''}`}>
          From gallery
          <input type="file" accept="image/*" onChange={onPhoto} disabled={busy} hidden />
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      <input
        className="search"
        type="search"
        placeholder={`Search ${scans.length} scans (serial, IMEI, text…)`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="list">
        {shown.map((s) => (
          <ScanCard
            key={s.id}
            scan={s}
            open={openId === s.id}
            onToggle={() => setOpenId(openId === s.id ? undefined : s.id)}
            onDelete={() => void onDelete(s.id)}
            duplicate={!!findDuplicate(s, scans)}
          />
        ))}
      </ul>
      {!scans.length && <p className="empty">Take a photo of the label on the box. Barcodes are saved instantly; the rest of the text is read in the background.</p>}
    </main>
  )
}
