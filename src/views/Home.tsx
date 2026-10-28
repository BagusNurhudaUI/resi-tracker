import type { Scan } from '../db'
import { Icon, type IconName } from '../icons'
import { fmtTime, isToday, scanTitle, useObjectUrl } from '../lib'

export function Thumb({ scan, size = 40 }: { scan: Scan; size?: number }) {
  const url = useObjectUrl(scan.thumb)
  return <img className="thumb" src={url} alt="" width={size} height={size} />
}

export function ScanRow({ scan, duplicate, onOpen }: { scan: Scan; duplicate: boolean; onOpen: () => void }) {
  const f = scan.fields
  return (
    <button className="row" onClick={onOpen}>
      <Thumb scan={scan} />
      <span className="row-main">
        <span className="row-title">{scanTitle(scan)}</span>
        <span className="row-sub mono">{f.serial ?? f.imei1 ?? `${scan.barcodes.length} barcodes`}</span>
      </span>
      <span className="row-end">
        <span className="row-time">{fmtTime(scan.createdAt)}</span>
        {scan.ocrStatus === 'pending' && <span className="pill">reading</span>}
        {scan.ocrStatus === 'error' && <span className="pill warn">no text</span>}
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
  dupes: Set<string>
  go: (path: string) => void
  onCamera: () => void
  onGallery: () => void
  onExport: () => void
}

export function Home({ scans, dupes, go, onCamera, onGallery, onExport }: Props) {
  const today = scans.filter((s) => isToday(s.createdAt)).length
  const pending = scans.filter((s) => s.ocrStatus === 'pending').length
  const last = scans[0]

  const services: { icon: IconName; label: string; onClick: () => void; badge?: number }[] = [
    { icon: 'camera', label: 'Scan label', onClick: onCamera },
    { icon: 'image', label: 'From gallery', onClick: onGallery },
    { icon: 'table', label: 'Data table', onClick: () => go('/data') },
    { icon: 'search', label: 'Search', onClick: () => go('/search') },
    { icon: 'chart', label: 'Statistics', onClick: () => go('/stats') },
    { icon: 'layers', label: 'Duplicates', onClick: () => go('/dupes'), badge: dupes.size },
    { icon: 'download', label: 'Export CSV', onClick: onExport },
    { icon: 'settings', label: 'Settings', onClick: () => go('/settings') },
  ]

  return (
    <>
      <div className="hero-bg">
        <div className="topbar">
          <span className="brand"><span className="brand-mark"><Icon name="scan" size={18} /></span>Resi <b>Tracker</b></span>
          <span className="topbar-actions">
            <button className="icon-btn" aria-label="Search" onClick={() => go('/search')}><Icon name="search" /></button>
            <button className="icon-btn" aria-label="Settings" onClick={() => go('/settings')}><Icon name="settings" /></button>
          </span>
        </div>
        <h1 className="greet">{greeting()}!</h1>
        <div className="kpis">
          <div><span>Scans today</span><b><Icon name="scan" size={18} />{today}</b></div>
          <div><span>Total items</span><b><Icon name="box" size={18} />{scans.length}</b></div>
          <div><span>Reading text</span><b><Icon name="clock" size={18} />{pending}</b></div>
        </div>
      </div>

      <div className="page">
        {pending > 0 && (
          <div className="banner">
            <span className="banner-icon"><Icon name="text" /></span>
            <span><b>{pending} scan{pending > 1 ? 's' : ''} still reading text</b><small>Keep the app open. Fields fill in automatically.</small></span>
          </div>
        )}
        {dupes.size > 0 && (
          <button className="banner warn" onClick={() => go('/dupes')}>
            <span className="banner-icon"><Icon name="alert" /></span>
            <span><b>{dupes.size} scans share a serial or IMEI</b><small>Check them before sending.</small></span>
            <Icon name="chevronRight" />
          </button>
        )}

        <section className="card hero">
          {last ? (
            <>
              <span className="muted small">Last scan · {fmtTime(last.createdAt)}</span>
              <h2>{scanTitle(last)}</h2>
              <p className="muted small mono">{last.fields.serial ? `SN ${last.fields.serial}` : `${last.barcodes.length} barcodes`}{last.fields.imei1 && ` · IMEI ${last.fields.imei1}`}</p>
              <button className="link" onClick={onCamera}>Scan next box <Icon name="chevronRight" size={16} /></button>
              <button className="corner-btn" aria-label="Open last scan" onClick={() => go(`/home/${last.id}`)}><Icon name="arrowUpRight" /></button>
            </>
          ) : (
            <>
              <span className="muted small">Today</span>
              <h2>No scans yet</h2>
              <p className="muted small">Take a photo of the label on the box to start.</p>
              <button className="link" onClick={onCamera}>Scan now <Icon name="chevronRight" size={16} /></button>
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
          <h3 className="section-title">Recent scans</h3>
          {scans.length > 0 && <button className="link small" onClick={() => go('/data')}>See all</button>}
        </div>
        <div className="card list">
          {scans.slice(0, 5).map((s) => (
            <ScanRow key={s.id} scan={s} duplicate={dupes.has(s.id)} onOpen={() => go(`/home/${s.id}`)} />
          ))}
          {!scans.length && <p className="empty">Scanned boxes show up here.</p>}
        </div>
      </div>
    </>
  )
}
