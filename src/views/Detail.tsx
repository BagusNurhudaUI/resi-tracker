import { useState } from 'react'
import type { Scan } from '../db'
import { Icon } from '../icons'
import { FIELD_LABELS, fmtDateTime, scanTitle, useObjectUrl } from '../lib'

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="value mono"
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1000)
      }}
    >
      <span>{value}</span>
      <span className="copy">{copied ? <Icon name="check" size={16} /> : <Icon name="copy" size={16} />}</span>
    </button>
  )
}

interface Props {
  scan: Scan
  duplicate: boolean
  onClose: () => void
  onDelete: () => void
}

export function Detail({ scan, duplicate, onClose, onDelete }: Props) {
  const photo = useObjectUrl(scan.photo)
  const f = scan.fields

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={scanTitle(scan)} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <button className="icon-btn" aria-label="Back" onClick={onClose}><Icon name="chevronLeft" /></button>
          <div className="sheet-title">
            <b>{scanTitle(scan)}</b>
            <span className="muted small">{fmtDateTime(scan.createdAt)}</span>
          </div>
          <button className="icon-btn danger" aria-label="Delete" onClick={onDelete}><Icon name="trash" /></button>
        </div>

        <div className="sheet-body">
          <a href={photo} target="_blank" rel="noreferrer"><img className="photo" src={photo} alt="Label photo" /></a>

          {duplicate && <div className="banner warn"><span className="banner-icon"><Icon name="alert" /></span><span><b>Possible duplicate</b><small>Another scan has the same serial or IMEI.</small></span></div>}
          {scan.ocrStatus === 'pending' && <div className="banner"><span className="banner-icon"><Icon name="text" /></span><span><b>Reading text…</b><small>More fields will appear in a moment.</small></span></div>}

          <div className="card fields">
            {FIELD_LABELS.filter(([k]) => f[k]).map(([k, label]) => (
              <div key={k} className="field">
                <span className="muted small">{label}</span>
                <CopyValue value={f[k]!} />
              </div>
            ))}
            {!FIELD_LABELS.some(([k]) => f[k]) && <p className="empty">No fields recognised yet.</p>}
          </div>

          <details className="card">
            <summary>Raw barcodes ({scan.barcodes.length})</summary>
            <ul className="raw">
              {scan.barcodes.map((b, i) => <li key={i}><span className="pill">{b.format}</span> <span className="mono">{b.text}</span></li>)}
              {!scan.barcodes.length && <li className="muted">None found in this photo.</li>}
            </ul>
          </details>

          <details className="card" open={scan.ocrStatus === 'done' && !scan.barcodes.length}>
            <summary>All text on label</summary>
            <pre>{scan.ocrText ?? (scan.ocrStatus === 'pending' ? 'Reading…' : 'No text could be read.')}</pre>
          </details>
        </div>
      </div>
    </div>
  )
}
