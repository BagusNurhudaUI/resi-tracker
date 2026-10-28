import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { clearScans, deleteScan, listScans, type Scan } from './db'
import { Icon, type IconName } from './icons'
import { duplicateIds, exportCsv } from './lib'
import { queueOcr, scanPhoto, warmUpOcr } from './scan'
import { DataView } from './views/DataView'
import { Detail } from './views/Detail'
import { Home } from './views/Home'
import { SettingsView } from './views/SettingsView'
import { StatsView } from './views/StatsView'

// Routes live in the hash (#/data/<id>) so the phone's back button closes sheets and switches tabs.
function readRoute() {
  const [page = 'home', id] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  return { page, id }
}

const go = (path: string) => {
  location.hash = path
}

const NAV: { page: string; icon: IconName; label: string }[] = [
  { page: 'home', icon: 'home', label: 'Home' },
  { page: 'data', icon: 'table', label: 'Data' },
  { page: 'stats', icon: 'chart', label: 'Stats' },
  { page: 'settings', icon: 'settings', label: 'Settings' },
]

export default function App() {
  const [scans, setScans] = useState<Scan[]>([])
  const [route, setRoute] = useState(readRoute)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; warn?: boolean }>()
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)

  const refresh = () => listScans().then(setScans)

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    addEventListener('hashchange', onHash)
    warmUpOcr()
    void listScans().then((all) => {
      setScans(all)
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
  const page = route.page === 'search' || route.page === 'dupes' ? 'data' : route.page
  const detail = route.id ? scans.find((s) => s.id === route.id) : undefined

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
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
      go(`/${page}/${scan.id}`)
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : String(err), warn: true })
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this scan?')) return
    await deleteScan(id)
    await refresh()
    history.back()
  }

  async function onClearAll() {
    if (!confirm(`Delete all ${scans.length} scans? This can't be undone.`)) return
    await clearScans()
    await refresh()
  }

  const openCamera = () => cameraInput.current?.click()
  const openGallery = () => galleryInput.current?.click()
  const openScan = (id: string) => go(`/${route.page}/${id}`)

  return (
    <div className="app">
      <main>
        {page === 'home' && (
          <Home scans={scans} dupes={dupes} go={go} onCamera={openCamera} onGallery={openGallery} onExport={() => exportCsv(scans)} />
        )}
        {page === 'data' && (
          <DataView
            key={route.page}
            scans={scans}
            dupes={dupes}
            initialFilter={route.page === 'dupes' ? 'dupes' : 'all'}
            autoFocus={route.page === 'search'}
            onOpen={openScan}
            onExport={exportCsv}
          />
        )}
        {page === 'stats' && <StatsView scans={scans} dupes={dupes} />}
        {page === 'settings' && <SettingsView scans={scans} onExport={() => exportCsv(scans)} onClearAll={() => void onClearAll()} />}
      </main>

      {detail && (
        <Detail scan={detail} duplicate={dupes.has(detail.id)} onClose={() => history.back()} onDelete={() => void onDelete(detail.id)} />
      )}

      {toast && <div className={`toast${toast.warn ? ' warn' : ''}`} role="status">{toast.text}</div>}

      <nav className="tabbar">
        {NAV.slice(0, 2).map((n) => (
          <button key={n.page} className={page === n.page ? 'on' : undefined} onClick={() => go(`/${n.page}`)}>
            <Icon name={n.icon} size={22} />{n.label}
          </button>
        ))}
        <button className="fab-slot" onClick={openCamera} disabled={busy}>
          <span className={`fab${busy ? ' busy' : ''}`}>{busy ? <span className="spinner" /> : <Icon name="scan" size={26} />}</span>
          {busy ? 'Reading…' : 'Scan'}
        </button>
        {NAV.slice(2).map((n) => (
          <button key={n.page} className={page === n.page ? 'on' : undefined} onClick={() => go(`/${n.page}`)}>
            <Icon name={n.icon} size={22} />{n.label}
          </button>
        ))}
      </nav>

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={onPhoto} hidden />
      <input ref={galleryInput} type="file" accept="image/*" onChange={onPhoto} hidden />
    </div>
  )
}
