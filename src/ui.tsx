import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import type { CheckStatus } from './orders'

export function Sheet({ title, subtitle, onClose, action, children }: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <button className="icon-btn" aria-label="Back" onClick={onClose}><Icon name="chevronLeft" /></button>
          <div className="sheet-title">
            <b>{title}</b>
            {subtitle && <span className="muted small">{subtitle}</span>}
          </div>
          {action}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

const CHECK_ICON: Record<CheckStatus, IconName> = { ok: 'check', partial: 'alert', fail: 'x', pending: 'clock' }

export function CheckRow({ status, label, detail }: { status: CheckStatus; label: string; detail?: ReactNode }) {
  return (
    <div className={`check ${status}`}>
      <span className="check-icon"><Icon name={CHECK_ICON[status]} size={14} /></span>
      <span className="check-text"><b>{label}</b>{detail && <span>{detail}</span>}</span>
    </div>
  )
}

export function Progress({ value, max }: { value: number; max: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <span style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  )
}
