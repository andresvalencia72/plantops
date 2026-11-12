import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ApiReadClient } from './api-client'
import type { ApiIncidentPage } from './api-client'
import type { OrganizationOrdersPage } from './organization-orders-api'

type Kind = 'incidents' | 'orders'
const statusLabels: Record<string, string> = {
  REPORTED: 'Reportada', UNDER_REVIEW: 'En revisión',
  IN_PROGRESS: 'En curso', CLOSED: 'Cerrada',
  PENDING: 'Pendiente', ASSIGNED: 'Asignada',
  COMPLETED: 'Completada', CANCELLED: 'Cancelada',
}

type State = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; page: ApiIncidentPage | OrganizationOrdersPage }

/** Query the server for this exact asset; never filter a global page in browser. */
export function ApiAssetRelated({ client, organizationId, assetId, kind,
  onOpenIncident, onOpenOrder }: {
  client: ApiReadClient; organizationId: string; assetId: string; kind: Kind
  onOpenIncident: (id: string) => void
  onOpenOrder: (order: { id: string; incidentId: string }) => void
}) {
  const [cursor, setCursor] = useState<string | undefined>()
  const [previous, setPrevious] = useState<(string | undefined)[]>([])
  const [state, setState] = useState<State>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const request = kind === 'incidents'
      ? client.assetIncidentHistory(organizationId, assetId, cursor, controller.signal)
      : client.organizationWorkOrders(organizationId, { assetId }, cursor, controller.signal)
    void request.then((page) => {
      if (!controller.signal.aborted) setState({ status: 'ready', page })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: 'error', message:
        error instanceof Error ? error.message : 'No se pudo consultar el historial.' })
    })
    return () => controller.abort()
  }, [client, organizationId, assetId, kind, cursor, revision])
  const page = state.status === 'ready' ? state.page : null
  function move(next: string | undefined, back: boolean) {
    setState({ status: 'loading' })
    setPrevious((list) => back ? list.slice(0, -1) : [...list, cursor])
    setCursor(next)
  }
  return <section className="space-y-3 border-t border-border pt-5"
    aria-label={kind === 'incidents' ? 'Incidencias del activo' : 'Órdenes del activo'}>
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[13px] font-semibold">
        {kind === 'incidents' ? 'Incidencias relacionadas' : 'Órdenes relacionadas'}
      </h3>
      <Button size="sm" variant="ghost" onClick={() => {
        setState({ status: 'loading' }); setRevision((n) => n + 1)
      }}>Actualizar</Button>
    </div>
    {state.status === 'loading' && <p role="status" className="text-xs text-muted-foreground">
      Consultando historial del activo…</p>}
    {state.status === 'error' && <div className="space-y-2">
      <p role="alert" className="text-xs text-destructive">{state.message}</p>
      <Button size="sm" variant="outline" onClick={() => {
        setState({ status: 'loading' }); setRevision((n) => n + 1)
      }}>Reintentar historial</Button>
    </div>}
    {page && page.items.length === 0 && <p className="text-xs text-muted-foreground">
      {kind === 'incidents' ? 'Este activo no tiene incidencias en esta página.'
        : 'Este activo no tiene órdenes correctivas en esta página.'}
    </p>}
    {page && page.items.length > 0 && <ul className="divide-y divide-border border-y border-border">
      {page.items.map((entry) => <li key={entry.id}>
        <button type="button" className="flex w-full items-center justify-between gap-2 py-3 text-left hover:text-primary"
          onClick={() => {
            if (kind === 'incidents') onOpenIncident(entry.id)
            else if ('incidentId' in entry) onOpenOrder({ id: entry.id, incidentId: entry.incidentId })
          }}>
          <span className="min-w-0 space-y-1">
            <span className="block truncate text-xs font-medium">{entry.title}</span>
            <span className="block text-[11px] text-muted-foreground">
              {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(
                new Date(kind === 'incidents' && 'reportedAt' in entry
                  ? entry.reportedAt : 'createdAt' in entry ? entry.createdAt : ''))}
            </span>
          </span>
          <Badge variant="outline" className="shrink-0 text-[10px]">{statusLabels[entry.status] ?? entry.status}</Badge>
        </button>
      </li>)}
    </ul>}
    {page && (previous.length > 0 || page.nextCursor) && <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] text-muted-foreground">Página {previous.length + 1}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!previous.length}
          onClick={() => move(previous[previous.length - 1], true)}>
          <ChevronLeft size={14} aria-hidden="true"/> Anterior</Button>
        <Button size="sm" variant="outline" disabled={!page.nextCursor}
          onClick={() => move(page.nextCursor ?? undefined, false)}>
          Siguiente <ChevronRight size={14} aria-hidden="true"/></Button>
      </div>
    </div>}
  </section>
}
