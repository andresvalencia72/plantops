import { useEffect, useState } from 'react'
import { CalendarDays, Wrench } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatusBadge } from '@/features/incidents/incident-badges'
import { ApiRequestError } from './api-client'
import type { ApiIncidentDetail, ApiReadClient, ApiAsset } from './api-client'

interface Props {
  client: ApiReadClient
  organizationId: string
  incidentId: string | null
  assets: ApiAsset[]
  onClose: () => void
}

type State = { status: 'loading' } | { status: 'loaded'; value: ApiIncidentDetail } |
  { status: 'error'; message: string }

export function ApiIncidentDetailSheet({
  client, organizationId, incidentId, assets, onClose,
}: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    if (!incidentId) return
    const controller = new AbortController()
    void client.incident(organizationId, incidentId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setState({ status: 'loaded', value })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof ApiRequestError ? error.message
            : 'No fue posible cargar el detalle. Vuelve a intentarlo.',
        })
      })
    return () => controller.abort()
  }, [client, organizationId, incidentId])

  const detail = state.status === 'loaded' ? state.value : null
  const asset = assets.find((item) => item.id === detail?.assetId)
  return (
    <Sheet open={incidentId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
        <SheetHeader className="border-b border-border px-6 py-8 pr-12">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Registro de la API · Solo lectura</p>
          <SheetTitle className="mt-2 text-xl font-semibold tracking-tight">
            {detail?.title ?? 'Detalle de incidencia'}
          </SheetTitle>
          <SheetDescription className="mt-2 font-mono text-xs">
            {incidentId}
          </SheetDescription>
          {detail && <div className="mt-3"><StatusBadge value={detail.status} /></div>}
        </SheetHeader>
        <div className="space-y-6 px-6 py-8">
          {state.status === 'loading' && (
            <p role="status" className="text-sm text-muted-foreground">Consultando detalle autorizado…</p>
          )}
          {state.status === 'error' && (
            <p role="alert" className="text-sm text-destructive">{state.message}</p>
          )}
          {detail && (
            <>
              <section className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Descripción</h3>
                <p className="text-[13px] leading-6">{detail.description}</p>
              </section>
              <section className="space-y-3 border-t border-border pt-6">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Activo</h3>
                <p className="flex items-center gap-2 text-sm">
                  <Wrench size={17} className="text-primary" aria-hidden="true"/>
                  {asset ? `${asset.code} · ${asset.name}` : 'Activo no disponible'}
                </p>
              </section>
              <section className="space-y-3 border-t border-border pt-6">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fecha de reporte</h3>
                <p className="flex items-center gap-2 text-xs">
                  <CalendarDays size={17} className="text-primary" aria-hidden="true" />
                  {new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' })
                    .format(new Date(detail.reportedAt))}
                </p>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
