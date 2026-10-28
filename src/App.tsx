import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  clearOrders, clearScans, deleteOrder, deleteScan, listOrders, listScans, patchScan, type Order, type Scan,
} from './db'
import { Icon, type IconName } from './icons'
import { duplicateIds, exportCsv, exportOrdersCsv } from './lib'
import { invoiceNameCheck, readInvoiceForOrder } from './invoice'
import { linkOrders } from './orders'
import { normalizeCapacity } from './parse'
import { queueOcr, rereadScan, scanPhoto, warmUpOcr } from './scan'
import { DataView } from './views/DataView'
import { Detail } from './views/Detail'
import { Home } from './views/Home'
import { ImportOrders } from './views/ImportOrders'
import { OrderDetail } from './views/OrderDetail'
import { OrdersView, orderIssues } from './views/OrdersView'
import { Pickup } from './views/Pickup'
import { SettingsView } from './views/SettingsView'
import { StatsView } from './views/StatsView'

// Routes live in the hash so the phone's back button closes sheets and switches tabs:
// #/<page>, #/<page>/scan/<id>, #/<page>/order/<invoice>, #/<page>/pickup[/<invoice>], #/<page>/import
function readRoute() {
  const [page = 'home', overlay, id] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  return { page, overlay, id }
}

const notify = () => dispatchEvent(new HashChangeEvent('hashchange'))

// Entries pushed by the app are marked, so closing a sheet only goes "back" when that stays inside the app.
const go = (path: string) => {
  history.pushState({ app: true }, '', '#' + path)
  notify()
}

const closeTo = (path: string) => {
  if (history.state?.app) history.back()
  else {
    history.replaceState(null, '', '#' + path)
    notify()
  }
}

// Several pages share one view with a different starting filter.
const PAGE_VIEW: Record<string, string> = { outside: 'orders', check: 'orders', search: 'data', dupes: 'data' }

const NAV: { page: string; icon: IconName; label: string }[] = [
  { page: 'home', icon: 'home', label: 'Home' },
  { page: 'orders', icon: 'clipboard', label: 'Orders' },
  { page: 'data', icon: 'table', label: 'Scans' },
  { page: 'stats', icon: 'chart', label: 'Stats' },
]

export default function App() {
  const [scans, setScans] = useState<Scan[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [route, setRoute] = useState(readRoute)
  const [busy, setBusy] = useState(false)
  const [readingInvoice, setReadingInvoice] = useState(false)
  const [toast, setToast] = useState<{ text: string; warn?: boolean }>()
  const boxInput = useRef<HTMLInputElement>(null)

  const refresh = () => Promise.all([listScans().then(setScans), listOrders().then(setOrders)])

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    addEventListener('hashchange', onHash)
    warmUpOcr()
    void refresh()
    void listScans().then(async (all) => {
      // Older scans may hold an OCR misread capacity such as "25668"; fix them once.
      const misread = all.filter((s) => s.fields.capacity && normalizeCapacity(s.fields.capacity) !== s.fields.capacity)
      for (const s of misread) await patchScan(s.id, (x) => ({ ...x, fields: { ...x.fields, capacity: normalizeCapacity(x.fields.capacity!) } }))
      if (misread.length) void refresh()
      // Resume OCR for anything left unfinished when the app was closed.
      const pending = all.filter((s) => s.ocrStatus === 'pending').map((s) => s.id)
      if (pending.length) queueOcr(pending, refresh)
    })
    return () => removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(undefined), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const dupes = duplicateIds(scans)
  const { picked, outside } = linkOrders(orders, scans)
  const needsCheck = orders.filter((o) => orderIssues(o, picked.get(o.invoice), dupes).length).length
  const orderBy = new Map(orders.map((o) => [o.invoice, o]))

  const page = PAGE_VIEW[route.page] ?? route.page
  const here = `/${route.page}`
  const scanDetail = route.overlay === 'scan' ? scans.find((s) => s.id === route.id) : undefined
  const orderDetail = route.overlay === 'order' && route.id ? orderBy.get(route.id) : undefined

  /** Scans a box without an invoice; it lands in "outside orders" until assigned. */
  async function onBoxOnly(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const scan = await scanPhoto(file)
      void navigator.storage?.persist?.()
      await refresh()
      setToast(
        scan.barcodes.length
          ? { text: `Saved · ${scan.barcodes.length} barcodes read` }
          : { text: 'No barcodes found. Reading text instead. Try a closer, glare-free photo.', warn: true },
      )
      queueOcr([scan.id], refresh)
      go(`${here}/scan/${scan.id}`)
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : String(err), warn: true })
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteScan(id: string) {
    if (!confirm('Delete this box scan?')) return
    await deleteScan(id)
    await refresh()
    closeTo(here)
  }

  async function onDeleteOrder(invoice: string) {
    if (!confirm('Delete this order? Its box scan is kept as an outside order.')) return
    await deleteOrder(invoice)
    await refresh()
    closeTo(here)
  }

  async function assign(scanId: string, invoice: string | undefined) {
    // An order holds one box; assigning a new one moves the old box to outside orders.
    const previous = invoice && picked.get(invoice)
    if (previous && previous.id !== scanId) await patchScan(previous.id, (s) => ({ ...s, orderId: undefined }))
    await patchScan(scanId, (s) => ({
      ...s,
      orderId: invoice,
      invoice: invoice ? { ...s.invoice, matchedBy: s.invoice?.matchedBy === 'invoice' && s.orderId === invoice ? 'invoice' : 'manual' } : s.invoice,
    }))
    await refresh()
    setToast({ text: invoice ? `Linked to ${orderBy.get(invoice)?.name}` : 'Moved to outside orders' })
  }

  /** Adds an invoice photo to a box that was scanned without one, and links it to its order. */
  async function scanInvoiceFor(scanId: string, photo: Blob) {
    setReadingInvoice(true)
    try {
      const { order, exact, invoice } = await readInvoiceForOrder(photo, orders)
      await patchScan(scanId, (s) => ({ ...s, invoice }))
      if (!order) {
        await refresh()
        setToast({ text: invoice.number ? `Invoice ${invoice.number} is not in your orders` : 'No invoice number could be read. Retake the photo.', warn: true })
        return
      }
      const previous = picked.get(order.invoice)
      if (previous && previous.id !== scanId) await patchScan(previous.id, (s) => ({ ...s, orderId: undefined }))
      await patchScan(scanId, (s) => ({ ...s, orderId: order.invoice }))
      await refresh()
      const name = invoiceNameCheck(order, invoice)
      setToast({
        text: `Linked to ${order.name}${exact === false ? ' (invoice number nearly matched)' : ''}${name === 'ok' ? ' · name matches' : name === 'fail' || name === 'partial' ? ' · check recipient name' : ''}`,
        warn: exact === false || name === 'fail' || name === 'partial',
      })
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : String(err), warn: true })
    } finally {
      setReadingInvoice(false)
    }
  }

  async function onClearAll() {
    if (!confirm(`Delete all ${scans.length} box scans? This can't be undone.`)) return
    await clearScans()
    await refresh()
  }

  async function onClearOrders() {
    if (!confirm(`Delete all ${orders.length} orders? Box scans are kept.`)) return
    await clearOrders()
    await refresh()
  }

  const startPickup = () => go(`${here}/pickup`)
  const exportOrders = () => exportOrdersCsv(orders, picked, outside)

  return (
    <div className="app">
      <main>
        {page === 'home' && (
          <Home
            scans={scans} orders={orders} picked={picked} outside={outside} needsCheck={needsCheck} dupes={dupes}
            go={go} onPickup={startPickup} onBoxOnly={() => boxInput.current?.click()}
          />
        )}
        {page === 'orders' && (
          <OrdersView
            key={route.page}
            orders={orders} picked={picked} outside={outside} dupes={dupes}
            initialFilter={route.page === 'outside' ? 'outside' : route.page === 'check' ? 'check' : 'all'}
            onOpenOrder={(inv) => go(`${here}/order/${encodeURIComponent(inv)}`)}
            onOpenScan={(id) => go(`${here}/scan/${id}`)}
            onImport={() => go(`${here}/import`)}
            onExport={exportOrders}
          />
        )}
        {page === 'data' && (
          <DataView
            key={route.page}
            scans={scans}
            dupes={dupes}
            initialFilter={route.page === 'dupes' ? 'dupes' : 'all'}
            autoFocus={route.page === 'search'}
            onOpen={(id) => go(`${here}/scan/${id}`)}
            onExport={exportCsv}
          />
        )}
        {page === 'stats' && (
          <StatsView scans={scans} dupes={dupes} orderCount={orders.length} pickedCount={picked.size} outsideCount={outside.length} needsCheck={needsCheck} />
        )}
        {page === 'settings' && (
          <SettingsView
            scans={scans} orderCount={orders.length}
            onExport={() => exportCsv(scans)} onExportOrders={exportOrders}
            onClearAll={() => void onClearAll()} onClearOrders={() => void onClearOrders()}
          />
        )}
      </main>

      {scanDetail && (
        <Detail
          scan={scanDetail}
          order={scanDetail.orderId ? orderBy.get(scanDetail.orderId) : undefined}
          orders={orders}
          picked={picked}
          duplicate={dupes.has(scanDetail.id)}
          onClose={() => closeTo(here)}
          onDelete={() => void onDeleteScan(scanDetail.id)}
          onOpenOrder={(inv) => go(`${here}/order/${encodeURIComponent(inv)}`)}
          onAssign={(inv) => void assign(scanDetail.id, inv)}
          onScanInvoice={(photo) => void scanInvoiceFor(scanDetail.id, photo)}
          onReread={() => void rereadScan(scanDetail.id, refresh).then(refresh)}
          readingInvoice={readingInvoice}
        />
      )}
      {orderDetail && (
        <OrderDetail
          order={orderDetail}
          scan={picked.get(orderDetail.invoice)}
          duplicate={!!picked.get(orderDetail.invoice) && dupes.has(picked.get(orderDetail.invoice)!.id)}
          onClose={() => closeTo(here)}
          onPickup={() => go(`${here}/pickup/${encodeURIComponent(orderDetail.invoice)}`)}
          onOpenScan={(id) => go(`${here}/scan/${id}`)}
          onUnlink={(id) => void assign(id, undefined)}
          onDelete={() => void onDeleteOrder(orderDetail.invoice)}
        />
      )}
      {route.overlay === 'pickup' && (
        <Pickup
          key={route.id ?? 'pickup'}
          orders={orders} picked={picked} scans={scans} dupes={dupes}
          preselect={route.id ? orderBy.get(route.id) : undefined}
          onSaved={() => void refresh()}
          onClose={() => closeTo(here)}
          onOpenScan={(id) => go(`${here}/scan/${id}`)}
        />
      )}
      {route.overlay === 'import' && (
        <ImportOrders
          orders={orders}
          onClose={() => closeTo(here)}
          onDone={(n) => {
            void refresh()
            setToast({ text: `${n} orders added` })
            closeTo(here)
          }}
        />
      )}

      {toast && <div className={`toast${toast.warn ? ' warn' : ''}`} role="status">{toast.text}</div>}

      <nav className="tabbar">
        {NAV.slice(0, 2).map((n) => (
          <button key={n.page} className={page === n.page ? 'on' : undefined} onClick={() => go(`/${n.page}`)}>
            <Icon name={n.icon} size={22} />{n.label}
          </button>
        ))}
        <button className="fab-slot" onClick={startPickup} disabled={busy}>
          <span className={`fab${busy ? ' busy' : ''}`}>{busy ? <span className="spinner" /> : <Icon name="scan" size={26} />}</span>
          {busy ? 'Reading…' : 'Pickup'}
        </button>
        {NAV.slice(2).map((n) => (
          <button key={n.page} className={page === n.page ? 'on' : undefined} onClick={() => go(`/${n.page}`)}>
            <Icon name={n.icon} size={22} />{n.label}
          </button>
        ))}
      </nav>

      <input ref={boxInput} type="file" accept="image/*" capture="environment" onChange={onBoxOnly} hidden />
    </div>
  )
}
