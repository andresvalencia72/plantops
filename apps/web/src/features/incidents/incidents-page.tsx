import { useMemo, useState } from 'react'
import { Plus, Search, SlidersHorizontal } from 'lucide-react'
import type { DemoOrganization } from '@/app/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { statusOptions, priorityOptions } from './incident-options'
import { IncidentInspector } from './incident-inspector'
import { IncidentTable } from './incident-table'
import { ReportIncidentDialog } from './report-incident-dialog'
import { filterIncidents, summarizeIncidents } from './selectors'
import { useIncidents } from './use-incidents'
import type { IncidentFilters, IncidentPriority, IncidentStatus } from './types'

const initialFilters: IncidentFilters = { query: '', status: 'ALL', priority: 'ALL' }

export function IncidentsPage({ organization }: { organization: DemoOrganization }) {
  const { records, loading, error, refresh } = useIncidents(organization)
  const [formOpen, setFormOpen] = useState(false)
  const [filters, setFilters] = useState<IncidentFilters>(initialFilters)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filtered = useMemo(() => filterIncidents(records, filters), [records, filters])
  const summary = summarizeIncidents(records)
  const selected = records.find((incident) => incident.id === selectedId) ?? null

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.16em] text-primary">Gestión de mantenimiento</p>
          <h1 className="text-[28px] font-semibold tracking-[-.045em] sm:text-[32px]">Incidencias</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Avisos sobre activos, prioridades y seguimiento del trabajo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-muted-foreground">Datos de demostración</span>
          <Button onClick={() => setFormOpen(true)}><Plus size={15} aria-hidden="true"/> Nueva incidencia</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-5 border-b border-border pb-5 text-[12px]">
        <p><span className="mr-2 text-muted-foreground">Incidencias</span><strong className="font-semibold">{loading ? '—' : summary.total}</strong></p>
        <p><span className="mr-2 text-muted-foreground">Abiertas</span><strong className="font-semibold">{loading ? '—' : summary.open}</strong></p>
        <p><span className="mr-2 text-muted-foreground">Críticas</span><strong className="font-semibold text-destructive">{loading ? '—' : summary.critical}</strong></p>
      </div>
      <section aria-label="Listado de incidencias" className="border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-4 sm:px-5">
          <div className="relative min-w-[190px] flex-1 sm:max-w-[350px]">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true"/>
            <Input
              aria-label="Buscar incidencias"
              className="h-9 pl-9 text-xs"
              placeholder="Buscar por activo, ID o descripción…"
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            />
          </div>
          <SlidersHorizontal size={15} className="hidden text-muted-foreground sm:block" aria-hidden="true"/>
          <label className="sr-only" htmlFor="incident-status-filter">Filtrar por estado</label>
          <select
            id="incident-status-filter"
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-xs sm:max-w-[165px]"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value as IncidentStatus | 'ALL' })}
          >
            <option value="ALL">Todos los estados</option>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label className="sr-only" htmlFor="incident-priority-filter">Filtrar por prioridad</label>
          <select
            id="incident-priority-filter"
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-xs sm:max-w-[155px]"
            value={filters.priority}
            onChange={(event) => setFilters({ ...filters, priority: event.target.value as IncidentPriority | 'ALL' })}
          >
            <option value="ALL">Todas las prioridades</option>
            {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        {loading ? (
          <div role="status" className="p-10 text-center text-sm text-muted-foreground">Cargando incidencias de demostración…</div>
        ) : error ? (
          <p role="alert" className="p-10 text-center text-sm text-destructive">{error}</p>
        ) : filtered.length ? (
          <IncidentTable incidents={filtered} onSelect={(incident) => setSelectedId(incident.id)} />
        ) : (
          <div className="space-y-3 p-10 text-center">
            <p className="text-sm font-medium">No hay incidencias para estos filtros</p>
            <p className="text-xs text-muted-foreground">Prueba con otra búsqueda o reinicia los filtros.</p>
            <Button variant="outline" onClick={() => setFilters(initialFilters)}>Limpiar filtros</Button>
          </div>
        )}
        <p className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
          {loading ? 'Consultando datos…' : `${filtered.length} de ${records.length} incidencias`} · Datos ficticios
        </p>
      </section>
      <IncidentInspector incident={selected} onClose={() => setSelectedId(null)} />
      <ReportIncidentDialog
        organization={organization}
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(id) => { setSelectedId(id); refresh() }}
      />
    </div>
  )
}
