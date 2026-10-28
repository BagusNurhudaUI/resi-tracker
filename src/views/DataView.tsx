import { useState } from 'react'
import type { Fields, Scan } from '../db'
import { Icon } from '../icons'
import { fmtTime, isToday, matchesQuery } from '../lib'

export type DataFilter = 'all' | 'today' | 'dupes' | 'reading'

const FILTERS: [DataFilter, string][] = [
  ['all', 'All'],
  ['today', 'Today'],
  ['dupes', 'Duplicates'],
  ['reading', 'Reading text'],
]

type SortKey = 'createdAt' | keyof Fields

const COLUMNS: [SortKey, string][] = [
  ['createdAt', 'Time'],
  ['product', 'Product'],
  ['color', 'Color'],
  ['capacity', 'Cap.'],
  ['serial', 'Serial'],
  ['imei1', 'IMEI 1'],
  ['imei2', 'IMEI 2'],
  ['eid', 'EID'],
  ['upc', 'UPC'],
  ['partNo', 'Part no.'],
]

interface Props {
  scans: Scan[]
  dupes: Set<string>
  initialFilter: DataFilter
  autoFocus: boolean
  onOpen: (id: string) => void
  onExport: (rows: Scan[]) => void
}

export function DataView({ scans, dupes, initialFilter, autoFocus, onOpen, onExport }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DataFilter>(initialFilter)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'createdAt', dir: -1 })

  const q = query.trim().toLowerCase()
  const rows = scans
    .filter((s) =>
      filter === 'today' ? isToday(s.createdAt)
      : filter === 'dupes' ? dupes.has(s.id)
      : filter === 'reading' ? s.ocrStatus === 'pending'
      : true)
    .filter((s) => matchesQuery(s, q))
    .sort((a, b) => {
      const av = sort.key === 'createdAt' ? a.createdAt : a.fields[sort.key] ?? ''
      const bv = sort.key === 'createdAt' ? b.createdAt : b.fields[sort.key] ?? ''
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir
    })

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'createdAt' ? -1 : 1 }))

  return (
    <div className="page page-top">
      <div className="page-head">
        <h1>Data</h1>
        <button className="chip-btn" disabled={!rows.length} onClick={() => onExport(rows)}>
          <Icon name="download" size={16} /> Export {rows.length}
        </button>
      </div>

      <label className="searchbar">
        <Icon name="search" size={18} />
        <input
          type="search"
          placeholder="Serial, IMEI, product, any text…"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && <button aria-label="Clear" onClick={() => setQuery('')}><Icon name="x" size={16} /></button>}
      </label>

      <div className="chips">
        {FILTERS.map(([key, label]) => (
          <button key={key} className={`chip${filter === key ? ' on' : ''}`} onClick={() => setFilter(key)}>{label}</button>
        ))}
        <span className="muted small chips-count">{rows.length} of {scans.length}</span>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map(([key, label]) => (
                <th key={key} onClick={() => toggleSort(key)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  {label}{sort.key === key && (sort.dir === 1 ? ' ↑' : ' ↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} onClick={() => onOpen(s.id)} className={dupes.has(s.id) ? 'dup' : undefined}>
                <td>{fmtTime(s.createdAt)}{s.ocrStatus === 'pending' && <span className="dot" title="Reading text" />}</td>
                {COLUMNS.slice(1).map(([key]) => (
                  <td key={key} className={['product', 'color', 'capacity'].includes(key) ? undefined : 'mono'}>
                    {s.fields[key as keyof Fields] ?? <span className="muted">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">{scans.length ? 'No scans match.' : 'No scans yet.'}</p>}
      </div>
    </div>
  )
}
