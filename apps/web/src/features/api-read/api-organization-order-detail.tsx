import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ApiOrganization, ApiReadClient, ApiWorkOrderDetail } from './api-client'
import { ApiAssignmentPanel } from './api-assignment-panel'
import { ApiExecutionPanel } from './api-execution-panel'
import { ApiCancellationPanel } from './api-cancellation-panel'

type Detail = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; value: ApiWorkOrderDetail }

export function ApiOrganizationOrderDetail({ client, organization, userId,
  selected, allowWrites, onClose, onUpdated, onOpenIncident }: {
  client: ApiReadClient; organization: ApiOrganization; userId: string
  selected: { id: string; incidentId: string }; allowWrites: boolean
  onClose: () => void; onUpdated: () => void; onOpenIncident: () => void
}) {
  const [detail, setDetail] = useState<Detail>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void client.workOrder(organization.id, selected.incidentId, selected.id,
      controller.signal).then((value) => {
      if (!controller.signal.aborted) setDetail({ status: 'ready', value })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDetail({ status: 'error', message:
        error instanceof Error ? error.message : 'No se pudo consultar el detalle.' })
    })
    return () => controller.abort()
  }, [client, organization.id, selected.incidentId, selected.id, revision])

  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
    <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
      <SheetHeader className="border-b border-border px-6 py-6">
        <SheetTitle>Detalle de orden de trabajo</SheetTitle>
        <SheetDescription>Consulta autorizada y evidencia de la intervención</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-6 py-5">
        {detail.status === 'loading' && <p role="status" className="text-xs">
          Cargando detalle de la orden…</p>}
        {detail.status === 'error' && <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive">{detail.message}</p>
          <Button size="sm" variant="outline" onClick={() => {
            setDetail({ status: 'loading' }); setRevision((n) => n + 1)
          }}>Reintentar detalle</Button>
        </div>}
        {detail.status === 'ready' && <>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">{detail.value.title}</h3>
            <p className="whitespace-pre-wrap text-sm leading-6">{detail.value.description}</p>
            <p className="text-xs text-muted-foreground">Creada el {
              new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
                .format(new Date(detail.value.createdAt))}</p>
            <Button size="sm" variant="outline" onClick={onOpenIncident}>
              Ver incidencia de origen
            </Button>
          </div>
          <ApiAssignmentPanel client={client} organizationId={organization.id}
            incidentId={detail.value.incidentId} order={detail.value}
            userId={userId} canAssign={allowWrites && organization.role === 'SUPERVISOR'}
            onUpdated={onUpdated}/>
          <ApiExecutionPanel client={client} organizationId={organization.id}
            incidentId={detail.value.incidentId} order={detail.value}
            userId={userId} membershipId={organization.membershipId}
            isolatedWrites={allowWrites && organization.role === 'TECHNICIAN'}
            onUpdated={onUpdated}/>
          <ApiCancellationPanel client={client} organizationId={organization.id}
            incidentId={detail.value.incidentId} order={detail.value}
            userId={userId} canCancel={allowWrites && organization.role === 'SUPERVISOR'}
            onUpdated={onUpdated}/>
        </>}
      </div>
    </SheetContent>
  </Sheet>
}
