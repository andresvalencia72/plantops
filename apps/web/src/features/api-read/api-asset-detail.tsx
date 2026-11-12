import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader,
  SheetTitle } from '@/components/ui/sheet'
import type { ApiAsset, ApiReadClient } from './api-client'
import { ApiAssetRelated } from './api-asset-related'

type State = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; asset: ApiAsset }

export function ApiAssetDetail({ client, organizationId, assetId, onClose,
  onOpenIncident, onOpenOrder }: {
  client: ApiReadClient; organizationId: string; assetId: string
  onClose: () => void; onOpenIncident: (id: string) => void
  onOpenOrder: (order: { id: string; incidentId: string }) => void
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void client.assetDetail(organizationId, assetId, controller.signal)
      .then((asset) => {
        if (!controller.signal.aborted) setState({ status: 'ready', asset })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message:
          error instanceof Error ? error.message : 'No se pudo consultar el activo.' })
      })
    return () => controller.abort()
  }, [client, organizationId, assetId, revision])
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
    <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
      <SheetHeader className="border-b border-border px-6 py-6">
        <SheetTitle>Ficha del activo</SheetTitle>
        <SheetDescription>Equipo registrado en la organización actual</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-6 py-5">
        {state.status === 'loading' && <p role="status" className="text-xs">
          Cargando ficha del activo…</p>}
        {state.status === 'error' && <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive">{state.message}</p>
          <Button size="sm" variant="outline" onClick={() => {
            setState({ status: 'loading' }); setRevision((n) => n + 1)
          }}>Reintentar ficha</Button>
        </div>}
        {state.status === 'ready' && <>
          <div className="space-y-3">
            <h3 className="text-[20px] font-semibold tracking-tight">{state.asset.name}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{state.asset.code}</Badge>
              <Badge variant="outline">{state.asset.active ? 'Habilitado' : 'Inactivo'}</Badge>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {state.asset.active ? 'Activo disponible para registrar incidencias.'
                : 'Activo desactivado. Conservamos su historial de mantenimiento.'}
            </p>
          </div>
          <ApiAssetRelated key={assetId + ':incidents'} kind="incidents" client={client}
            organizationId={organizationId} assetId={assetId}
            onOpenIncident={onOpenIncident} onOpenOrder={onOpenOrder}/>
          <ApiAssetRelated key={assetId + ':orders'} kind="orders" client={client}
            organizationId={organizationId} assetId={assetId}
            onOpenIncident={onOpenIncident} onOpenOrder={onOpenOrder}/>
        </>}
      </div>
    </SheetContent>
  </Sheet>
}
