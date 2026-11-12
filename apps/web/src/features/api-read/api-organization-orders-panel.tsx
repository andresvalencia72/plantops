import { useEffect, useState } from 'react'
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ApiAsset, ApiOrganization, ApiReadClient } from './api-client'
import type { OrganizationOrderFilters, OrganizationOrdersPage } from './organization-orders-api'
import { ApiOrganizationOrderDetail } from './api-organization-order-detail'

type State = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; page: OrganizationOrdersPage }
const labels: Record<string, string> = {
  PENDING: 'Pendiente', ASSIGNED: 'Asignada', IN_PROGRESS: 'En ejecución',
  COMPLETED: 'Completada', CANCELLED: 'Cancelada',
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudieron consultar las órdenes.'
}

/** Orders across all incidents in the active membership's organization. */
export function ApiOrganizationOrdersPanel({ client, organization, userId,
  allowWrites = false, onOpenIncident }: {
  client: ApiReadClient; organization: ApiOrganization; userId: string
  allowWrites?: boolean; onOpenIncident?: (incidentId: string) => void
}) {
  const [assets, setAssets] = useState<ApiAsset[]>([])
  const [assetsError, setAssetsError] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const [filters, setFilters] = useState<OrganizationOrderFilters>({})
  const [cursor, setCursor] = useState<string | undefined>()
  const [previous, setPrevious] = useState<(string | undefined)[]>([])
  const [state, setState] = useState<State>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<{
    id: string; incidentId: string
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void client.assets(organization.id, controller.signal).then((items) => {
      if (!controller.signal.aborted) { setAssets(items); setAssetsError('') }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setAssetsError(errorMessage(error))
    })
    return () => controller.abort()
  }, [client, organization.id])

  useEffect(() => {
    const controller = new AbortController()
    void client.organizationWorkOrders(organization.id, filters, cursor,
      controller.signal).then((page) => {
      if (!controller.signal.aborted) setState({ status: 'ready', page })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: 'error', message: errorMessage(error) })
    })
    return () => controller.abort()
  }, [client, organization.id, filters, cursor, revision])

  const page = state.status === 'ready' ? state.page : null
  function apply(next: OrganizationOrderFilters) {
    setFilters(next)
    setSelected(null)
    setCursor(undefined)
    setPrevious([])
    setState({ status: 'loading' })
  }
  function pageTo(next: string | undefined, back = false) {
    setSelected(null)
    setState({ status: 'loading' })
    setPrevious((items) => back ? items.slice(0, -1) : [...items, cursor])
    setCursor(next)
  }
  function refresh() {
    setState({ status: 'loading' })
    setRevision((count) => count + 1)
  }

  return <div className="space-y-5">
    <section aria-labelledby="organization-orders-title" className="border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5">
        <div className="space-y-1">
          <h2 id="organization-orders-title" className="text-[14px] font-semibold">Órdenes de trabajo</h2>
          <p className="text-xs text-muted-foreground">
            {allowWrites ? 'Vista por organización · Operaciones en laboratorio aislado'
              : 'Vista por organización · Consulta sin modificaciones'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw size={14} aria-hidden="true"/> Actualizar
        </Button>
      </header>
      <div className="grid gap-3 border-b border-border p-5 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Estado</span>
          <select aria-label="Filtrar por estado" value={filters.status ?? 'ALL'}
            onChange={(event) => apply({ ...filters, status: event.target.value })}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-foreground">
            <option value="ALL">Todos los estados</option>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Activo</span>
          <select aria-label="Filtrar por activo" value={filters.assetId ?? ''}
            onChange={(event) => apply({ ...filters, assetId: event.target.value })}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-foreground">
            <option value="">Todos los activos</option>
            {assets.map((asset) => <option key={asset.id} value={asset.id}>
              {asset.code} · {asset.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Responsable</span>
          <select aria-label="Filtrar por responsable" value={filters.assignment ?? 'ALL'}
            onChange={(event) => apply({ ...filters, assignment: event.target.value })}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-foreground">
            <option value="ALL">Todos</option>
            <option value="MINE">Asignadas a mí</option>
            <option value="UNASSIGNED">Sin asignar</option>
          </select>
        </label>
        <form className="space-y-1" onSubmit={(event) => {
          event.preventDefault()
          const query = draftQuery.trim()
          if (query.length === 1) return
          apply({ ...filters, query })
        }}>
          <label htmlFor="order-global-search" className="block text-xs text-muted-foreground">
            Buscar órdenes
          </label>
          <div className="flex gap-1">
            <Input id="order-global-search" type="search" value={draftQuery} maxLength={100}
              placeholder="Título, activo o incidencia" onChange={(event) => setDraftQuery(event.target.value)} />
            <Button type="submit" size="sm" variant="outline">Buscar</Button>
          </div>
          {draftQuery.trim().length === 1 &&
            <p role="status" className="text-[11px] text-muted-foreground">Introduce al menos 2 caracteres</p>}
        </form>
      </div>
      {assetsError && <p role="alert" className="px-5 pt-4 text-xs text-destructive">
        No se pudo cargar el filtro de activos: {assetsError}</p>}
      {state.status === 'loading' && <p role="status" className="p-10 text-center text-sm text-muted-foreground">
        Consultando órdenes autorizadas…</p>}
      {state.status === 'error' && <div className="space-y-3 p-8 text-center">
        <p role="alert" className="text-sm text-destructive">{state.message}</p>
        <Button size="sm" variant="outline" onClick={refresh}>Reintentar consulta</Button>
      </div>}
      {page?.items.length === 0 && <div className="space-y-2 px-6 py-12 text-center">
        <Wrench className="mx-auto text-muted-foreground" aria-hidden="true" size={24}/>
        <p className="text-sm font-medium">No hay órdenes que coincidan con los filtros</p>
        <p className="text-xs text-muted-foreground">No se muestran órdenes ficticias ni de otras empresas.</p>
      </div>}
      {page && page.items.length > 0 && <div className="divide-y divide-border">
        {page.items.map((item) => <button key={item.id} type="button"
          onClick={() => setSelected({ id: item.id, incidentId: item.incidentId })}
          className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-[13px] font-semibold">{item.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {item.assetCode} · {item.assetName} · {item.incidentTitle}</p>
            <p className="text-[11px] text-muted-foreground">
              Responsable: {item.responsibleName ?? 'Sin asignar'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge variant="outline">{labels[item.status]}</Badge>
            <ArrowUpRight size={15} className="text-muted-foreground" aria-hidden="true"/>
          </div>
        </button>)}
      </div>}
      {page && <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p className="text-[11px] text-muted-foreground">Página {previous.length + 1} · {page.items.length} órdenes</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={previous.length === 0}
            onClick={() => pageTo(previous[previous.length - 1], true)}>
            <ChevronLeft size={14} aria-hidden="true"/> Anterior</Button>
          <Button size="sm" variant="outline" disabled={!page.nextCursor}
            onClick={() => pageTo(page.nextCursor ?? undefined)}>
            Siguiente <ChevronRight size={14} aria-hidden="true"/></Button>
        </div>
      </footer>}
    </section>
    {selected && <ApiOrganizationOrderDetail key={selected.id} client={client}
      organization={organization} userId={userId} selected={selected}
      allowWrites={allowWrites} onClose={() => setSelected(null)}
      onUpdated={() => { setSelected(null); refresh() }}
      onOpenIncident={() => onOpenIncident?.(selected.incidentId)} />}
  </div>
}
