import { ArrowUpRight } from 'lucide-react'
import { PriorityBadge, StatusBadge } from './incident-badges'
import { priorityMarker } from './priority-marker'
import type { IncidentView } from './types'

interface IncidentTableProps {
  incidents: IncidentView[]
  onSelect: (incident: IncidentView) => void
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date))
}

export function IncidentTable({ incidents, onSelect }: IncidentTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="border-b border-border bg-secondary/40 text-xs font-medium text-muted-foreground">
            <tr>
              <th className="w-[12%] px-5 py-3.5">Identificador</th>
              <th className="w-[33%] px-3 py-3.5">Descripción</th>
              <th className="w-[21%] px-3 py-3.5">Activo</th>
              <th className="w-[11%] px-3 py-3.5">Prioridad</th>
              <th className="w-[13%] px-3 py-3.5">Estado</th>
              <th className="w-[10%] px-3 py-3.5">Fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {incidents.map((incident) => (
              <tr key={incident.id} className="transition-colors hover:bg-secondary/45">
                <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" className={['h-7 w-0.5 rounded-full', priorityMarker[incident.priority]].join(' ')} />
                    {incident.id}
                  </span>
                </td>
                <td className="px-3 py-4">
                  <button onClick={() => onSelect(incident)} className="text-left font-medium leading-5 text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                    {incident.title}
                  </button>
                </td>
                <td className="px-3 py-4">
                  <span className="block truncate font-medium">{incident.asset.name}</span>
                  <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{incident.asset.code}</span>
                </td>
                <td className="px-3 py-4"><PriorityBadge value={incident.priority} /></td>
                <td className="px-3 py-4"><StatusBadge value={incident.status} /></td>
                <td className="px-3 py-4 text-xs text-muted-foreground">{formatDate(incident.reportedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-border md:hidden">
        {incidents.map((incident) => (
          <button
            key={incident.id}
            onClick={() => onSelect(incident)}
            className="relative flex w-full flex-col gap-3 px-4 py-4 text-left hover:bg-secondary/45 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span aria-hidden="true" className={['absolute inset-y-4 left-0 w-1 rounded-full', priorityMarker[incident.priority]].join(' ')} />
            <span className="flex w-full items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground">{incident.id}</span>
              <ArrowUpRight size={15} className="text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="text-sm font-medium leading-5">{incident.title}</span>
            <span className="text-xs text-muted-foreground">{incident.asset.name} · {incident.asset.code}</span>
            <span className="flex items-center gap-2">
              <PriorityBadge value={incident.priority} />
              <StatusBadge value={incident.status} />
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
