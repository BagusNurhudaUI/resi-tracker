import { useEffect, useState } from 'react'
import type { Scan } from '../db'
import { Icon } from '../icons'

const fmtBytes = (n: number) =>
  n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`

interface Props {
  scans: Scan[]
  onExport: () => void
  onClearAll: () => void
}

export function SettingsView({ scans, onExport, onClearAll }: Props) {
  const [usage, setUsage] = useState<{ used: number; quota: number }>()
  const [persisted, setPersisted] = useState<boolean>()

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }))
    void navigator.storage?.persisted?.().then(setPersisted)
  }, [scans.length])

  return (
    <div className="page page-top">
      <div className="page-head"><h1>Settings</h1></div>

      <div className="card list">
        <button className="row" onClick={onExport} disabled={!scans.length}>
          <span className="row-icon"><Icon name="download" /></span>
          <span className="row-main"><span className="row-title">Export all to CSV</span><span className="row-sub">{scans.length} scans, opens in Excel or Sheets</span></span>
          <Icon name="chevronRight" size={18} />
        </button>
        <div className="row">
          <span className="row-icon"><Icon name="database" /></span>
          <span className="row-main">
            <span className="row-title">Stored on this device</span>
            <span className="row-sub">{usage ? `${fmtBytes(usage.used)} used of ${fmtBytes(usage.quota)}` : 'Checking…'}</span>
          </span>
        </div>
        <div className="row">
          <span className="row-icon"><Icon name={persisted ? 'check' : 'alert'} /></span>
          <span className="row-main">
            <span className="row-title">Protected from auto-cleanup</span>
            <span className="row-sub">{persisted ? 'Yes, the browser will keep this data' : 'No, the browser may clear it when storage is low. Install the app to protect it.'}</span>
          </span>
        </div>
        <button className="row danger" onClick={onClearAll} disabled={!scans.length}>
          <span className="row-icon"><Icon name="trash" /></span>
          <span className="row-main"><span className="row-title">Delete all scans</span><span className="row-sub">Export first. This can't be undone.</span></span>
        </button>
      </div>

      <p className="muted small about">
        Resi Tracker reads the barcodes and text on box labels. Photos and data never leave this device.
      </p>
    </div>
  )
}
