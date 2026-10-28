import { useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { PSM } from 'tesseract.js'
import { patchScan, type MatchedBy, type Order, type Scan } from '../db'
import { Icon } from '../icons'
import { fmtTime, scanTitle, useObjectUrl } from '../lib'
import {
  detectInvoiceNumber, findOrderByNumber, labelParts, nameCheck, productCheck, suggestByName,
} from '../orders'
import { ocr, queueOcr, readInvoice, scanPhoto } from '../scan'
import { CheckRow, Progress, Sheet } from '../ui'
import { OrderPicker } from './OrderPicker'

type Phase = 'invoice' | 'reading' | 'unmatched' | 'box' | 'saving' | 'done'

interface Invoice {
  photo?: Blob
  /** The enlarged strip under the barcode that the recipient and sender are read from. */
  strip?: Blob
  barcodes: string[]
  /** Undefined until the label text has been read. */
  text?: string
  number?: string
  recipient?: string
  sender?: string
  marketplace?: string
  order?: Order
  matchedBy: MatchedBy
  exact?: boolean
}

interface Props {
  orders: Order[]
  picked: Map<string, Scan>
  scans: Scan[]
  dupes: Set<string>
  preselect?: Order
  onSaved: () => void
  onClose: () => void
  onOpenScan: (id: string) => void
}

const MATCH_TEXT: Record<MatchedBy, string> = {
  invoice: 'Invoice number found on the label',
  name: 'Matched by recipient name',
  manual: 'Chosen from the list',
  none: 'Outside your orders',
}

function StripPreview({ blob }: { blob?: Blob }) {
  const url = useObjectUrl(blob)
  return url ? <img className="strip" src={url} alt="Part of the invoice that was read" /> : null
}

function PhotoButton({ label, input, gallery, busy }: {
  label: string
  input: RefObject<HTMLInputElement | null>
  gallery: RefObject<HTMLInputElement | null>
  busy?: string
}) {
  return (
    <div className="photo-actions">
      <button className="btn primary big" onClick={() => input.current?.click()} disabled={!!busy}>
        {busy ? <><span className="spinner" /> {busy}</> : <><Icon name="camera" size={22} /> {label}</>}
      </button>
      <button className="link small" onClick={() => gallery.current?.click()} disabled={!!busy}>or choose from gallery</button>
    </div>
  )
}

export function Pickup({ orders, picked, scans, dupes, preselect, onSaved, onClose, onOpenScan }: Props) {
  const [phase, setPhase] = useState<Phase>(preselect ? 'box' : 'invoice')
  const [inv, setInv] = useState<Invoice>(preselect ? { barcodes: [], order: preselect, matchedBy: 'manual' } : { barcodes: [], matchedBy: 'none' })
  const [savedId, setSavedId] = useState<string>()
  const [error, setError] = useState<string>()
  const [picking, setPicking] = useState(false)
  const textJob = useRef<Promise<string> | null>(null)
  const invoiceCam = useRef<HTMLInputElement>(null)
  const invoiceGallery = useRef<HTMLInputElement>(null)
  const boxCam = useRef<HTMLInputElement>(null)
  const boxGallery = useRef<HTMLInputElement>(null)

  const openOrders = orders.filter((o) => !picked.has(o.invoice))
  const saved = savedId ? scans.find((s) => s.id === savedId) : undefined
  const alreadyPicked = inv.order && phase !== 'done' ? picked.get(inv.order.invoice) : undefined

  async function onInvoicePhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(undefined)
    setPhase('reading')
    try {
      const { photo, ocrImage, fromStrip, barcodes } = await readInvoice(file)
      const textP = ocr(ocrImage, 1, PSM.SPARSE_TEXT)
      textJob.current = textP
      const hit = findOrderByNumber(orders, barcodes)
      const base: Invoice = {
        photo, barcodes, strip: fromStrip ? ocrImage : undefined, order: hit?.order, exact: hit?.exact,
        matchedBy: hit ? 'invoice' : 'none',
        number: hit?.order.invoice ?? detectInvoiceNumber(barcodes),
      }
      setInv(base)

      if (hit) {
        // Barcode was enough; let the name check fill in when the text arrives.
        setPhase('box')
        textP
          .then((text) => textJob.current === textP && setInv((i) => ({ ...i, ...labelParts(text) })))
          .catch(() => {})
        return
      }

      const text = await textP.catch(() => '')
      const hit2 = findOrderByNumber(orders, [...barcodes, text])
      setInv({
        ...base, ...labelParts(text), order: hit2?.order, exact: hit2?.exact,
        matchedBy: hit2 ? 'invoice' : 'none',
        number: hit2?.order.invoice ?? detectInvoiceNumber(barcodes, text),
      })
      setPhase(hit2 ? 'box' : 'unmatched')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('invoice')
    }
  }

  function chooseOrder(order: Order | undefined, how: MatchedBy) {
    setInv((i) => ({ ...i, order, matchedBy: how }))
    setPicking(false)
    setPhase('box')
  }

  async function onBoxPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(undefined)
    setPhase('saving')
    try {
      const i = inv
      const scan = await scanPhoto(file, {
        orderId: i.order?.invoice,
        invoice: {
          number: i.number, recipient: i.recipient, sender: i.sender, marketplace: i.marketplace,
          text: i.text, photo: i.photo, matchedBy: i.matchedBy,
        },
      })
      // Picking an order again replaces its box; the old one moves to "outside orders".
      const previous = i.order && picked.get(i.order.invoice)
      if (previous) await patchScan(previous.id, (s) => ({ ...s, orderId: undefined }))
      if (i.text === undefined && textJob.current) {
        textJob.current
          .then((text) => patchScan(scan.id, (s) => ({ ...s, invoice: { ...s.invoice!, ...labelParts(text) } })))
          .then(onSaved)
          .catch(() => {})
      }
      queueOcr([scan.id], onSaved)
      setSavedId(scan.id)
      setPhase('done')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('box')
    }
  }

  function nextOrder() {
    textJob.current = null
    setInv({ barcodes: [], matchedBy: 'none' })
    setSavedId(undefined)
    setPhase('invoice')
    invoiceCam.current?.click()
  }

  const name = inv.order && nameCheck(inv.order.name, inv.text, inv.recipient)
  const step = phase === 'invoice' || phase === 'reading' || phase === 'unmatched' ? 1 : phase === 'done' ? 3 : 2

  const orderCard = (order: Order | undefined) =>
    order ? (
      <div className="card order-card">
        <span className="muted small">Order</span>
        <b className="order-name">{order.name}</b>
        <span>{order.product}</span>
        <span className="mono muted small">{order.invoice}</span>
        {(inv.sender || inv.marketplace) && <span className="muted small">From {[inv.sender, inv.marketplace].filter(Boolean).join(' · ')}</span>}
      </div>
    ) : (
      <div className="card order-card outside">
        <span className="muted small">Not in your orders</span>
        <b className="order-name">{inv.recipient ?? 'Unknown recipient'}</b>
        <span className="mono muted small">{inv.number ?? 'No invoice number read'}</span>
        {(inv.sender || inv.marketplace) && <span className="muted small">From {[inv.sender, inv.marketplace].filter(Boolean).join(' · ')}</span>}
      </div>
    )

  const checks = inv.order && (
    <div className="card checks">
      <StripPreview blob={inv.strip} />
      <CheckRow status={inv.exact === false ? 'partial' : 'ok'} label={MATCH_TEXT[inv.matchedBy]}
        detail={inv.exact === false ? 'One or two digits read differently. Compare with the label.' : undefined} />
      {inv.matchedBy !== 'manual' || inv.text !== undefined ? (
        <CheckRow
          status={name!.status}
          label={name!.status === 'pending' ? 'Checking recipient name…' : name!.status === 'ok' ? 'Recipient name matches' : name!.status === 'partial' ? 'Recipient name partly matches' : 'Recipient name does not match'}
          detail={inv.text !== undefined && `Label: ${inv.recipient ?? 'name not found'} · Order: ${inv.order.name}`}
        />
      ) : null}
    </div>
  )

  return (
    <Sheet
      title="Pickup"
      subtitle={`${picked.size} of ${orders.length} orders picked`}
      onClose={onClose}
    >
      <Progress value={picked.size} max={orders.length} />
      <ol className="steps">
        <li className={step === 1 ? 'on' : 'done'}><span>1</span>Invoice</li>
        <li className={step === 2 ? 'on' : step > 2 ? 'done' : ''}><span>2</span>Box label</li>
        <li className={step === 3 ? 'on' : ''}><span>3</span>Saved</li>
      </ol>
      {error && <div className="banner warn"><span className="banner-icon"><Icon name="alert" /></span><span><b>Something went wrong</b><small>{error}</small></span></div>}

      {picking ? (
        <OrderPicker orders={orders} picked={picked} onPick={(o) => chooseOrder(o, 'manual')} onCancel={() => setPicking(false)} />
      ) : (
        <>
          {(phase === 'invoice' || phase === 'reading') && (
            <>
              <div className="card pad hint">
                <b>Take a photo of the invoice</b>
                <p className="muted small">The invoice number and recipient name are read and matched to your orders.</p>
              </div>
              <PhotoButton label="Photo invoice" input={invoiceCam} gallery={invoiceGallery} busy={phase === 'reading' ? 'Reading invoice…' : undefined} />
              <div className="row-links">
                <button className="link small" onClick={() => setPicking(true)} disabled={phase === 'reading'}>Pick order from list</button>
                <button className="link small" onClick={() => chooseOrder(undefined, 'none')} disabled={phase === 'reading'}>Box only, no invoice</button>
              </div>
            </>
          )}

          {phase === 'unmatched' && (
            <>
              <StripPreview blob={inv.strip} />
              <div className="banner warn">
                <span className="banner-icon"><Icon name="alert" /></span>
                <span><b>Invoice not in your order list</b><small>{inv.number ? `Read ${inv.number}` : 'No invoice number could be read.'}{inv.recipient && ` · ${inv.recipient}`}</small></span>
              </div>
              {suggestByName(openOrders, inv.text ?? '', inv.recipient).map(({ order, score }) => (
                <button key={order.invoice} className="card row suggest" onClick={() => chooseOrder(order, 'name')}>
                  <span className="row-main">
                    <span className="muted small">Name matches {Math.round(score * 100)}%. Use this order?</span>
                    <span className="row-title">{order.name}</span>
                    <span className="row-sub">{order.product} · <span className="mono">{order.invoice}</span></span>
                  </span>
                  <Icon name="chevronRight" />
                </button>
              ))}
              <div className="btn-row">
                <button className="btn" onClick={() => setPicking(true)}>Pick from list</button>
                <button className="btn" onClick={() => chooseOrder(undefined, 'none')}>Save as outside</button>
              </div>
              <button className="link small center" onClick={() => invoiceCam.current?.click()}>Retake invoice photo</button>
            </>
          )}

          {(phase === 'box' || phase === 'saving') && (
            <>
              {orderCard(inv.order)}
              {checks}
              {alreadyPicked && (
                <div className="banner warn">
                  <span className="banner-icon"><Icon name="alert" /></span>
                  <span><b>Already picked at {fmtTime(alreadyPicked.createdAt)}</b><small>Scanning again replaces that box (IMEI {alreadyPicked.fields.imei1 ?? 'unknown'}).</small></span>
                </div>
              )}
              <PhotoButton label="Photo box label" input={boxCam} gallery={boxGallery} busy={phase === 'saving' ? 'Reading barcodes…' : undefined} />
              <div className="row-links">
                <button className="link small" onClick={() => setPicking(true)} disabled={phase === 'saving'}>Change order</button>
                <button className="link small" onClick={() => { setPhase('invoice'); invoiceCam.current?.click() }} disabled={phase === 'saving'}>Retake invoice</button>
              </div>
            </>
          )}

          {phase === 'done' && saved && (
            <>
              {orderCard(inv.order)}
              <div className="card checks">
                {inv.order && <CheckRow status={inv.exact === false ? 'partial' : 'ok'} label={MATCH_TEXT[inv.matchedBy]} />}
                {inv.order && name && (inv.matchedBy !== 'manual' || inv.text !== undefined) && (
                  <CheckRow status={name.status} label={name.status === 'pending' ? 'Checking recipient name…' : name.status === 'ok' ? 'Recipient name matches' : 'Check recipient name'}
                    detail={inv.text !== undefined && `Label: ${inv.recipient ?? 'name not found'}`} />
                )}
                {inv.order && (() => {
                  const p = productCheck(inv.order.product, saved.fields)
                  return <CheckRow status={p.status}
                    label={p.status === 'pending' ? 'Reading box product…' : p.status === 'ok' ? 'Product matches' : 'Product differs from order'}
                    detail={p.status === 'fail' ? `Box: ${scanTitle(saved)} ${saved.fields.color ?? ''} · differs on: ${p.missing.join(', ')}` : undefined} />
                })()}
                <CheckRow
                  status={saved.fields.imei1 ? 'ok' : saved.ocrStatus === 'pending' ? 'pending' : 'fail'}
                  label={saved.fields.imei1 ? `IMEI 1 ${saved.fields.imei1}` : saved.ocrStatus === 'pending' ? 'Looking for IMEI 1…' : 'IMEI 1 not found. Retake the box photo.'}
                />
                {dupes.has(saved.id) && <CheckRow status="fail" label="This box was scanned before" detail="Same serial or IMEI as another scan." />}
              </div>
              <button className="btn primary big" onClick={nextOrder}><Icon name="camera" size={22} /> Next order</button>
              <div className="row-links">
                <button className="link small" onClick={() => onOpenScan(saved.id)}>Open box scan</button>
                <button className="link small" onClick={onClose}>Finish</button>
              </div>
            </>
          )}
        </>
      )}

      <input ref={invoiceCam} type="file" accept="image/*" capture="environment" onChange={onInvoicePhoto} hidden />
      <input ref={invoiceGallery} type="file" accept="image/*" onChange={onInvoicePhoto} hidden />
      <input ref={boxCam} type="file" accept="image/*" capture="environment" onChange={onBoxPhoto} hidden />
      <input ref={boxGallery} type="file" accept="image/*" onChange={onBoxPhoto} hidden />
    </Sheet>
  )
}
