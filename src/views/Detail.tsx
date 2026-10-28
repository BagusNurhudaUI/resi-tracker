import { useRef, useState, type ChangeEvent } from 'react'
import type { Order, Scan } from '../db'
import { Icon } from '../icons'
import { FIELD_LABELS, fmtDateTime, scanTitle, useObjectUrl } from '../lib'
import { Sheet } from '../ui'
import { OrderPicker } from './OrderPicker'

export function CopyValue({ value }: { value: string }) {
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
  order?: Order
  orders: Order[]
  picked: Map<string, Scan>
  duplicate: boolean
  onClose: () => void
  onDelete: () => void
  onOpenOrder: (invoice: string) => void
  onAssign: (invoice: string | undefined) => void
  onScanInvoice: (photo: Blob) => void
  readingInvoice: boolean
  onReread: () => void
}

export function Detail({
  scan, order, orders, picked, duplicate, onClose, onDelete, onOpenOrder, onAssign, onScanInvoice, readingInvoice, onReread,
}: Props) {
  const invoiceCam = useRef<HTMLInputElement>(null)
  const invoiceGallery = useRef<HTMLInputElement>(null)
  const onInvoicePhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onScanInvoice(file)
  }
  const photo = useObjectUrl(scan.photo)
  const invoicePhoto = useObjectUrl(scan.invoice?.photo)
  const [assigning, setAssigning] = useState(false)
  const f = scan.fields

  return (
    <Sheet
      title={scanTitle(scan)}
      subtitle={fmtDateTime(scan.createdAt)}
      onClose={onClose}
      action={<button className="icon-btn danger" aria-label="Delete" onClick={onDelete}><Icon name="trash" /></button>}
    >
      {assigning ? (
        <OrderPicker orders={orders} picked={picked} onPick={(o) => { onAssign(o.invoice); setAssigning(false) }} onCancel={() => setAssigning(false)} />
      ) : (
        <>
          <a href={photo} target="_blank" rel="noreferrer"><img className="photo" src={photo} alt="Label photo" /></a>

          {order ? (
            <button className="card row" onClick={() => onOpenOrder(order.invoice)}>
              <span className="row-icon"><Icon name="check" /></span>
              <span className="row-main">
                <span className="row-title">{order.name}</span>
                <span className="row-sub">{order.product} · <span className="mono">{order.invoice}</span></span>
              </span>
              <Icon name="chevronRight" size={18} />
            </button>
          ) : (
            <div className="card pad outside-box">
              <div className="banner warn">
                <span className="banner-icon"><Icon name="alert" /></span>
                <span>
                  <b>Outside your orders</b>
                  <small>{scan.invoice?.number ? `Invoice read: ${scan.invoice.number}` : 'No invoice linked'}{scan.invoice?.recipient && ` · ${scan.invoice.recipient}`}{scan.invoice?.sender && ` · from ${scan.invoice.sender}`}</small>
                </span>
              </div>
              <div className="btn-row">
                <button className="btn primary" onClick={() => invoiceCam.current?.click()} disabled={readingInvoice}>
                  {readingInvoice ? <><span className="spinner" /> Reading…</> : <><Icon name="camera" size={18} /> Scan invoice</>}
                </button>
                <button className="btn" onClick={() => setAssigning(true)} disabled={!orders.length || readingInvoice}>Pick order</button>
              </div>
              <button className="link small center" onClick={() => invoiceGallery.current?.click()} disabled={readingInvoice}>or choose invoice from gallery</button>
              <input ref={invoiceCam} type="file" accept="image/*" capture="environment" onChange={onInvoicePhoto} hidden />
              <input ref={invoiceGallery} type="file" accept="image/*" onChange={onInvoicePhoto} hidden />
            </div>
          )}

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
            {scan.ocrStatus !== 'pending' && (
              <button className="link small reread" onClick={onReread}>
                <Icon name="text" size={14} /> Read label again
              </button>
            )}
          </div>

          {scan.invoice?.photo && (
            <details className="card">
              <summary>Invoice photo</summary>
              <a href={invoicePhoto} target="_blank" rel="noreferrer"><img className="photo" src={invoicePhoto} alt="Invoice photo" /></a>
              {scan.invoice.text && <pre>{scan.invoice.text}</pre>}
            </details>
          )}

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

          {order && <button className="link small center danger-text" onClick={() => onAssign(undefined)}>Unlink from order</button>}
        </>
      )}
    </Sheet>
  )
}
