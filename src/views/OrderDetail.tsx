import type { Order, Scan } from '../db'
import { Icon } from '../icons'
import { FIELD_LABELS, fmtDateTime, useObjectUrl } from '../lib'
import { nameCheck, productCheck } from '../orders'
import { CheckRow, Sheet } from '../ui'
import { CopyValue } from './Detail'

function PhotoTile({ blob, label }: { blob?: Blob; label: string }) {
  const url = useObjectUrl(blob)
  if (!blob) return null
  return (
    <a className="photo-tile" href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={label} />
      <span>{label}</span>
    </a>
  )
}

interface Props {
  order: Order
  scan?: Scan
  duplicate: boolean
  onClose: () => void
  onPickup: () => void
  onOpenScan: (id: string) => void
  onUnlink: (scanId: string) => void
  onDelete: () => void
}

export function OrderDetail({ order, scan, duplicate, onClose, onPickup, onOpenScan, onUnlink, onDelete }: Props) {
  const name = scan?.invoice?.text != null ? nameCheck(order.name, scan.invoice.text, scan.invoice.recipient) : undefined
  const product = scan && productCheck(order.product, scan.fields)

  return (
    <Sheet
      title={order.name}
      subtitle={scan ? `Picked ${fmtDateTime(scan.createdAt)}` : 'Not picked yet'}
      onClose={onClose}
      action={<button className="icon-btn danger" aria-label="Delete order" onClick={onDelete}><Icon name="trash" /></button>}
    >
      <div className="card fields">
        <div className="field"><span className="muted small">Invoice</span><CopyValue value={order.invoice} /></div>
        <div className="field"><span className="muted small">Name</span><CopyValue value={order.name} /></div>
        <div className="field"><span className="muted small">Product</span><CopyValue value={order.product} /></div>
      </div>

      {scan ? (
        <>
          <div className="card checks">
            <CheckRow status="ok" label="Box picked" detail={scan.invoice?.matchedBy === 'manual' ? 'Order chosen from the list' : scan.invoice?.matchedBy === 'name' ? 'Matched by recipient name' : 'Matched by invoice number'} />
            {name && <CheckRow status={name.status} label={name.status === 'ok' ? 'Recipient name matches' : 'Check recipient name'} detail={`Penerima: ${scan.invoice?.recipient ?? 'not found'}${scan.invoice?.sender ? ` · Pengirim: ${scan.invoice.sender}` : ''}${scan.invoice?.marketplace ? ` · ${scan.invoice.marketplace}` : ''}`} />}
            {product && <CheckRow status={product.status} label={product.status === 'pending' ? 'Reading box product…' : product.status === 'ok' ? 'Product matches' : 'Product differs from order'} detail={product.status === 'fail' ? `Differs on: ${product.missing.join(', ')}` : undefined} />}
            {duplicate && <CheckRow status="fail" label="Box scanned more than once" detail="Same serial or IMEI as another scan." />}
          </div>

          <div className="card fields">
            {FIELD_LABELS.filter(([k]) => ['imei1', 'imei2', 'serial', 'product', 'color', 'capacity'].includes(k) && scan.fields[k]).map(([k, label]) => (
              <div key={k} className="field"><span className="muted small">{label}</span><CopyValue value={scan.fields[k]!} /></div>
            ))}
            {!scan.fields.imei1 && <p className="empty">{scan.ocrStatus === 'pending' ? 'Reading the box label…' : 'IMEI 1 was not found on the box photo.'}</p>}
          </div>

          <div className="photo-tiles">
            <PhotoTile blob={scan.invoice?.photo} label="Invoice" />
            <PhotoTile blob={scan.photo} label="Box label" />
          </div>

          <div className="btn-row">
            <button className="btn" onClick={() => onOpenScan(scan.id)}>Open box scan</button>
            <button className="btn" onClick={onPickup}>Scan again</button>
          </div>
          <button className="link small center danger-text" onClick={() => onUnlink(scan.id)}>Unlink box (moves it to outside orders)</button>
        </>
      ) : (
        <button className="btn primary big" onClick={onPickup}><Icon name="camera" size={22} /> Pick up this order</button>
      )}
    </Sheet>
  )
}
