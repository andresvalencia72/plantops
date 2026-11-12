import { useEffect, useState } from 'react'
import { CalendarDays, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatusBadge } from '@/features/incidents/incident-badges'
import { ApiRequestError } from './api-client'
import type { ApiIncidentDetail, ApiReadClient, ApiAsset } from './api-client'
import { clearReviewRetryKey, reviewRetryKey } from './review-retry-journal'
import { ApiWorkOrdersSection } from './api-work-orders-section'

interface Props {
  client: ApiReadClient
  organizationId: string
  incidentId: string | null
  assets: ApiAsset[]
  onClose: () => void
  userId?: string
  canReview?: boolean
  onReviewed?: () => void
}

type State = { status: 'loading' } | { status: 'loaded'; value: ApiIncidentDetail } |
  { status: 'error'; message: string }

export function ApiIncidentDetailSheet({
  client, organizationId, incidentId, assets, onClose,
  userId, canReview = false, onReviewed,
}: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState('')

  useEffect(() => {
    if (!incidentId) return
    const controller = new AbortController()
    void client.incident(organizationId, incidentId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        if (value.status !== 'REPORTED' && userId) {
          // A lost POST response may have committed. The server state wins.
          try { clearReviewRetryKey(userId, organizationId, incidentId) } catch {
            // Storage is optional; never hide the authoritative server state.
          }
        }
        setState({ status: 'loaded', value })
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
  }, [client, organizationId, incidentId, revision, userId])

  async function startReview() {
    if (reviewing || !canReview || !userId || !incidentId ||
      state.status !== 'loaded' || state.value.status !== 'REPORTED') return
    setReviewError('')
    setReviewing(true)
    try {
      const key = reviewRetryKey(userId, organizationId, incidentId)
      const result = await client.reviewIncident(organizationId, incidentId, key)
      try { clearReviewRetryKey(userId, organizationId, incidentId) } catch {
        // Confirmed review remains successful if tab storage cannot be cleared.
      }
      setState({ status: 'loaded', value: result })
      setConfirming(false)
      onReviewed?.()
    } catch (error) {
      setReviewError(error instanceof ApiRequestError ? error.message
        : error instanceof Error && error.message.includes('clave')
          ? error.message
          : 'No se pudo confirmar la revisión. Comprueba la conexión y reintenta con la misma clave.')
      // On uncertain failure the same key is reused after a reload.
    } finally {
      setReviewing(false)
    }
  }

  function refreshDetail() {
    if (reviewing) return
    setReviewError('')
    setConfirming(false)
    setState({ status: 'loading' })
    setRevision((value) => value + 1)
  }

  const detail = state.status === 'loaded' ? state.value : null
  const asset = assets.find((item) => item.id === detail?.assetId)
  return (
    <Sheet open={incidentId !== null} onOpenChange={(open) => { if (!open && !reviewing) onClose() }}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
        <SheetHeader className="border-b border-border px-6 py-8 pr-12">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            {canReview ? 'Registro de API · Laboratorio aislado' : 'Registro de la API · Solo lectura'}
          </p>
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
              {canReview && userId && detail.status === 'REPORTED' && (
                <section className="space-y-3 border-b border-border pb-6">
                  {!confirming ? (
                    <Button size="sm" onClick={() => setConfirming(true)}>
                      Iniciar revisión
                    </Button>
                  ) : (
                    <>
                      <p className="text-sm">
                        ¿Iniciar la revisión de esta incidencia? La acción quedará auditada.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={reviewing}
                          onClick={() => { void startReview() }}>
                          {reviewing ? 'Confirmando…' : 'Confirmar inicio de revisión'}
                        </Button>
                        <Button size="sm" variant="outline" disabled={reviewing}
                          onClick={() => { setConfirming(false); setReviewError('') }}>
                          Cancelar
                        </Button>
                      </div>
                    </>
                  )}
                  {reviewError && (
                    <p role="alert" className="text-sm text-destructive">{reviewError}</p>
                  )}
                  {reviewError && (
                    <Button variant="outline" size="sm" disabled={reviewing}
                      onClick={refreshDetail}>Actualizar detalle</Button>
                  )}
                </section>
              )}
              <section className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Descripción
                </h3>
                <p className="text-[13px] leading-6">{detail.description}</p>
              </section>
              <section className="space-y-3 border-t border-border pt-6">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Activo</h3>
                <p className="flex items-center gap-2 text-sm">
                  <Wrench size={17} className="text-primary" aria-hidden="true"/>
                  {asset ? `${asset.code} · ${asset.name}` : 'Activo no disponible'}
                </p>
              </section>
              {incidentId && <ApiWorkOrdersSection key={organizationId + ':' + incidentId}
                client={client} organizationId={organizationId} incidentId={incidentId}
                userId={userId} canCreate={Boolean(canReview && userId && asset?.active &&
                  (detail.status === 'UNDER_REVIEW' || detail.status === 'IN_PROGRESS'))}
                onCreated={() => { refreshDetail(); onReviewed?.() }} />}
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
