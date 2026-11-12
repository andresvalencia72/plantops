import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApiRequestError } from './api-client'
import { ApiCreateCorrectiveOrder } from './api-create-corrective-order'
import { ApiAssignmentPanel } from './api-assignment-panel'
import type { ApiReadClient, ApiWorkOrderDetail, ApiWorkOrderPage } from './api-client'

type PageState = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; page: ApiWorkOrderPage }
type DetailState = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; value: ApiWorkOrderDetail }

const names = {
  PENDING: 'Pendiente', ASSIGNED: 'Asignada', IN_PROGRESS: 'En ejecución',
  COMPLETED: 'Completada', CANCELLED: 'Cancelada',
} as const

function message(error: unknown) {
  return error instanceof ApiRequestError ? error.message
    : 'No se pudo consultar esta orden. Comprueba la conexión e inténtalo de nuevo.'
}

/** Mounted only after a successful, tenant-scoped incident detail request. */
export function ApiWorkOrdersSection({ client, organizationId, incidentId,
  canCreate = false, userId, onCreated }: {
  client: ApiReadClient; organizationId: string; incidentId: string
  canCreate?: boolean; userId?: string; onCreated?: () => void
}) {
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [cursor, setCursor] = useState<string | undefined>()
  const [previous, setPrevious] = useState<(string | undefined)[]>([])
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState>({ status: 'loading' })
  const [detailRevision, setDetailRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void client.workOrders(organizationId, incidentId, cursor, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setState({ status: 'ready', page })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: message(error) })
      })
    return () => controller.abort()
  }, [client, organizationId, incidentId, cursor, revision])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    void client.workOrder(organizationId, incidentId, selectedId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDetail({ status: 'ready', value })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setDetail({ status: 'error', message: message(error) })
      })
    return () => controller.abort()
  }, [client, organizationId, incidentId, selectedId, detailRevision])

  const page = state.status === 'ready' ? state.page : null
  function refresh() {
    setSelectedId(null)
    setState({ status: 'loading' })
    setRevision((n) => n + 1)
  }
  function move(nextCursor: string | undefined, back = false) {
    setSelectedId(null)
    setState({ status: 'loading' })
    setPrevious((list) => back ? list.slice(0, -1) : [...list, cursor])
    setCursor(nextCursor)
  }
  function toggle(id: string) {
    setDetail({ status: 'loading' })
    setSelectedId((selected) => selected === id ? null : id)
  }

  return (
    <section aria-labelledby="api-work-orders-heading" className="space-y-4 border-t border-border pt-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id="api-work-orders-heading" className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
            Órdenes correctivas
          </h3>
          <p className="text-xs text-muted-foreground">
            {canCreate ? 'Alta en laboratorio aislado · Consulta autorizada'
              : 'Consulta autorizada · Sin modificaciones'}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} aria-label="Actualizar órdenes">
          <RefreshCw size={14} aria-hidden="true" />
        </Button>
      </div>
      {canCreate && userId && <ApiCreateCorrectiveOrder client={client}
        organizationId={organizationId} incidentId={incidentId}
        userId={userId} onCreated={() => { refresh(); onCreated?.() }} />}
      {state.status === 'loading' && <p role="status" className="text-xs text-muted-foreground">
        Consultando órdenes relacionadas…
      </p>}
      {state.status === 'error' && <div className="space-y-2">
        <p role="alert" className="text-xs text-destructive">{state.message}</p>
        <Button size="sm" variant="outline" onClick={refresh}>Reintentar órdenes</Button>
      </div>}
      {page?.items.length === 0 && <p className="text-xs leading-5 text-muted-foreground">
        No hay órdenes correctivas asociadas a esta incidencia.
      </p>}
      {page && page.items.length > 0 && (
        <ul className="divide-y divide-border border-y border-border">
          {page.items.map((order) => (
            <li key={order.id} className="py-3">
              <button type="button" onClick={() => toggle(order.id)}
                aria-expanded={selectedId === order.id}
                className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-2 focus-visible:outline-ring">
                <span className="min-w-0 space-y-1">
                  <span className="block truncate text-[13px] font-medium">{order.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' })
                      .format(new Date(order.createdAt))}
                  </span>
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">{names[order.status]}</Badge>
              </button>
              {selectedId === order.id && <div className="mt-3 border-l-2 border-primary pl-3">
                {detail.status === 'loading' && <p role="status" className="text-xs text-muted-foreground">
                  Consultando detalle de la orden…
                </p>}
                {detail.status === 'error' && <div className="space-y-2">
                  <p role="alert" className="text-xs text-destructive">{detail.message}</p>
                  <Button size="sm" variant="outline" onClick={() => {
                    setDetail({ status: 'loading' }); setDetailRevision((n) => n + 1)
                  }}>Reintentar detalle</Button>
                </div>}
                {detail.status === 'ready' && <>
                  <p className="text-xs leading-5">{detail.value.description}</p>
                  <ApiAssignmentPanel key={detail.value.id} client={client}
                    organizationId={organizationId} incidentId={incidentId}
                    order={detail.value} userId={userId}
                    canAssign={Boolean(canCreate && userId)} onUpdated={refresh} />
                </>}
              </div>}
            </li>
          ))}
        </ul>
      )}
      {page && (previous.length > 0 || page.nextCursor) && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Página {previous.length + 1}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={previous.length === 0}
              onClick={() => move(previous[previous.length - 1], true)}>
              <ChevronLeft size={14} aria-hidden="true" /> Anterior
            </Button>
            <Button size="sm" variant="outline" disabled={!page.nextCursor}
              onClick={() => move(page.nextCursor ?? undefined)}>
              Siguiente <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
