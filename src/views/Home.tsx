import type { Order, Scan } from '../db'
import { Icon, type IconName } from '../icons'
import { fmtTime, scanTitle, useObjectUrl } from '../lib'
import { Progress } from '../ui'

export function Thumb({ scan, size = 40 }: { scan: Scan; size?: number }) {
  const url = useObjectUrl(scan.thumb)
  return <img className="thumb" src={url} alt="" width={size} height={size} />
}

export function ScanRow({ scan, order, duplicate, onOpen }: { scan: Scan; order?: Order; duplicate: boolean; onOpen: () => void }) {
  const f = scan.fields
  return (
    <button className="row" onClick={onOpen}>
      <Thumb scan={scan} />
      <span className="row-main">
        <span className="row-title">{order?.name ?? scanTitle(scan)}</span>
        <span className="row-sub">
          {order ? scanTitle(scan) : 'Outside orders'} · <span className="mono">{f.imei1 ?? f.serial ?? `${scan.barcodes.length} barcodes`}</span>
        </span>
      </span>
      <span className="row-end">
        <span className="row-time">{fmtTime(scan.createdAt)}</span>
        {scan.ocrStatus === 'pending' && <span className="pill">reading</span>}
        {scan.ocrStatus === 'error' && <span className="pill warn">no text</span>}
        {!order && <span className="pill warn">outside</span>}
        {duplicate && <span className="pill warn">dup</span>}
      </span>
    </button>
  )
}

function greeting() {
  const h = new Date().getHours()
  return h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good night'
}

interface Props {
  scans: Scan[]
  orders: Order[]
  picked: Map<string, Scan>
  outside: Scan[]
  needsCheck: number
  dupes: Set<string>
  go: (path: string) => void
  onPickup: () => void
  onBoxOnly: () => void
}

export function Home({ scans, orders, picked, outside, needsCheck, dupes, go, onPickup, onBoxOnly }: Props) {
  const pending = scans.filter((s) => s.ocrStatus === 'pending').length
  const left = orders.length - picked.size
  const orderOf = new Map(orders.map((o) => [o.invoice, o]))

  const services: { icon: IconName; label: string; onClick: () => void; badge?: number }[] = [
    { icon: 'camera', label: 'Pickup scan', onClick: onPickup },
    { icon: 'plus', label: 'Import orders', onClick: () => go('/home/import') },
    { icon: 'clipboard', label: 'Orders', onClick: () => go('/orders') },
    { icon: 'inbox', label: 'Outside orders', onClick: () => go('/outside'), badge: outside.length },
    { icon: 'scan', label: 'Box only', onClick: onBoxOnly },
    { icon: 'table', label: 'All scans', onClick: () => go('/data') },
    { icon: 'chart', label: 'Statistics', onClick: () => go('/stats') },
    { icon: 'settings', label: 'Settings', onClick: () => go('/settings') },
  ]

  return (
    <>
      <div className="hero-bg">
        <div className="topbar">
          <span className="brand"><span className="brand-mark"><Icon name="scan" size={18} /></span><span>Resi <b>Tracker</b></span></span>
          <span className="topbar-actions">
            <button className="icon-btn" aria-label="Search" onClick={() => go('/search')}><Icon name="search" /></button>
            <button className="icon-btn" aria-label="Settings" onClick={() => go('/settings')}><Icon name="settings" /></button>
          </span>
        </div>
        <h1 className="greet">{greeting()}!</h1>
        <div className="kpis">
          <div><span>Picked</span><b><Icon name="check" size={18} />{picked.size}<small>/{orders.length}</small></b></div>
          <div><span>Not picked</span><b><Icon name="clipboard" size={18} />{left}</b></div>
          <div><span>Outside orders</span><b><Icon name="inbox" size={18} />{outside.length}</b></div>
        </div>
      </div>

      <div className="page">
        {pending > 0 && (
          <div className="banner">
            <span className="banner-icon"><Icon name="text" /></span>
            <span><b>{pending} box{pending > 1 ? 'es' : ''} still reading text</b><small>Keep the app open. Fields fill in automatically.</small></span>
          </div>
        )}
        {needsCheck > 0 && (
          <button className="banner warn" onClick={() => go('/check')}>
            <span className="banner-icon"><Icon name="alert" /></span>
            <span><b>{needsCheck} picked order{needsCheck > 1 ? 's need' : ' needs'} a check</b><small>Name, product or IMEI doesn't line up.</small></span>
            <Icon name="chevronRight" />
          </button>
        )}

        <section className="card hero">
          {orders.length ? (
            <>
              <span className="muted small">Pickup progress</span>
              <h2>{picked.size} <span className="muted">/ {orders.length}</span> orders</h2>
              <Progress value={picked.size} max={orders.length} />
              <p className="muted small">{left ? `${left} still to pick up` : 'All orders picked up'}{outside.length > 0 && ` · ${outside.length} outside orders`}</p>
              <button className="link" onClick={onPickup}>Start pickup <Icon name="chevronRight" size={16} /></button>
              <button className="corner-btn" aria-label="Open orders" onClick={() => go('/orders')}><Icon name="arrowUpRight" /></button>
            </>
          ) : (
            <>
              <span className="muted small">Today</span>
              <h2>No orders yet</h2>
              <p className="muted small">Paste your order list (invoice | name | product), then scan each invoice and box.</p>
              <button className="link" onClick={() => go('/home/import')}>Import orders <Icon name="chevronRight" size={16} /></button>
            </>
          )}
        </section>

        <h3 className="section-title">Services</h3>
        <div className="services">
          {services.map((s) => (
            <button key={s.label} className="service" onClick={s.onClick}>
              <span className="service-icon">
                <Icon name={s.icon} size={22} />
                {!!s.badge && <span className="badge">{s.badge}</span>}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        <div className="section-head">
          <h3 className="section-title">Recent pickups</h3>
          {scans.length > 0 && <button className="link small" onClick={() => go('/data')}>See all</button>}
        </div>
        <div className="card list">
          {scans.slice(0, 5).map((s) => (
            <ScanRow key={s.id} scan={s} order={s.orderId ? orderOf.get(s.orderId) : undefined} duplicate={dupes.has(s.id)} onOpen={() => go(`/home/scan/${s.id}`)} />
          ))}
          {!scans.length && <p className="empty">Scanned boxes show up here.</p>}
        </div>
      </div>
    </>
  )
}
