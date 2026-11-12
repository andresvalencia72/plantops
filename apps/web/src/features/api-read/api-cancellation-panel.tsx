import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiCancellationEvent, ApiReadClient, ApiWorkOrderDetail } from './api-client'
import { cancellationFingerprint, clearCancellationRetry,
  readCancellationRetry, saveCancellationRetry } from './cancellation-retry-journal'
import type { PendingCancellation } from './cancellation-retry-journal'

type History = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; value: ApiCancellationEvent | null }
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'La cancelación no se pudo confirmar.'
}

export function ApiCancellationPanel({ client, organizationId, incidentId,
  order, userId, canCancel, onUpdated }: {
  client: ApiReadClient; organizationId: string; incidentId: string
  order: ApiWorkOrderDetail; userId?: string; canCancel: boolean
  onUpdated: () => void
}) {
  const scope = [userId ?? '', organizationId, incidentId, order.id] as const
  const [history, setHistory] = useState<History>(order.status === 'CANCELLED'
    ? { status: 'loading' } : { status: 'ready', value: null })
  const [historyRevision, setHistoryRevision] = useState(0)
  const [pending, setPending] = useState<PendingCancellation | null>(() => {
    if (!userId) return null
    try { return readCancellationRetry(...scope) } catch { return null }
  })
  const [blocked, setBlocked] = useState(() => {
    if (!userId) return false
    try { readCancellationRetry(...scope); return false } catch { return true }
  })
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const [attempt, setAttempt] = useState<string | null>(null)
  const allowed = canCancel && Boolean(userId) &&
    (order.status === 'PENDING' || order.status === 'ASSIGNED' ||
      order.status === 'IN_PROGRESS' || pending || blocked)

  useEffect(() => {
    if (order.status !== 'CANCELLED') return
    const controller = new AbortController()
    void client.cancellation(organizationId, incidentId, order.id,
      controller.signal).then((value) => {
      if (!controller.signal.aborted) setHistory({ status: 'ready', value })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setHistory({ status: 'error', message: message(cause) })
    })
    return () => controller.abort()
  }, [client, organizationId, incidentId, order.id, order.status, historyRevision])

  function review() {
    if (saving || blocked) return
    if (reason.trim().length < 10 || reason.trim().length > 1000) {
      setError('El motivo de cancelación debe contener entre 10 y 1000 caracteres.')
      return
    }
    setError('')
    setConfirming(true)
  }

  async function confirm() {
    if (!userId || !allowed || saving || blocked) return
    setSaving(true)
    setError('')
    try {
      const normalized = attempt ?? reason.trim()
      const fingerprint = await cancellationFingerprint(incidentId, order.id, normalized)
      const previous = readCancellationRetry(...scope)
      if (previous && previous.fingerprint !== fingerprint) {
        throw new Error('El motivo no coincide con el intento anterior. Reintroduce el motivo exacto o descarta el intento después de comprobar la orden.')
      }
      const pointer = previous ?? { key: crypto.randomUUID(), fingerprint }
      saveCancellationRetry(...scope, pointer)
      setPending(pointer)
      setAttempt(normalized)
      await client.cancelWorkOrder(organizationId, incidentId, order.id,
        normalized, pointer.key)
      try { clearCancellationRetry(...scope) } catch { /* confirmed HTTP wins */ }
      setPending(null); setAttempt(null); setReason('')
      setConfirming(false); setOpen(false)
      onUpdated()
    } catch (cause) { setError(message(cause)) }
    finally { setSaving(false) }
  }

  function discard() {
    if (!userId || saving) return
    try {
      clearCancellationRetry(...scope)
      setPending(null); setBlocked(false); setAttempt(null)
      setConfirming(false); setDiscarding(false); setReason(''); setError('')
      onUpdated() // always refresh server; uncertain POST may have committed
    } catch { setError('No se pudo descartar; evita una segunda cancelación.') }
  }

  return <section className="mt-4 space-y-3 border-t border-border pt-4"
    aria-label="Cancelación de orden">
    {order.status === 'CANCELLED' && <div className="space-y-2 text-xs">
      <h4 className="font-semibold">Cancelación auditada</h4>
      {history.status === 'loading' && <p role="status">Consultando motivo…</p>}
      {history.status === 'ready' && history.value && <>
        <p className="whitespace-pre-wrap">{history.value.reason}</p>
        <p className="text-muted-foreground">
          {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
            .format(new Date(history.value.occurredAt))}
        </p>
      </>}
      {history.status === 'error' && <div>
        <p role="alert" className="text-destructive">{history.message}</p>
        <Button size="sm" variant="outline" onClick={() => {
          setHistory({ status: 'loading' }); setHistoryRevision((n) => n + 1)
        }}>Reintentar motivo</Button>
      </div>}
    </div>}
    {allowed && !open && <Button size="sm" variant="outline"
      onClick={() => setOpen(true)}>
      {pending ? 'Recuperar cancelación sin confirmar' : 'Cancelar orden'}
    </Button>}
    {allowed && open && <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Solo el supervisor puede cancelar una orden no terminal.
        La razón quedará registrada de forma inmutable.
      </p>
      {pending && <p role="status" className="text-xs text-muted-foreground">
        Existe un envío anterior sin confirmar. Introduce exactamente el mismo motivo
        para repetirlo con la misma clave. Comprueba el historial antes de descartarlo.
      </p>}
      {blocked && <p role="alert" className="text-xs text-destructive">
        Los datos del intento anterior son inválidos. Revisa el historial.
      </p>}
      <div className="space-y-1">
        <Label htmlFor="api-cancellation-reason">Motivo obligatorio</Label>
        <Textarea id="api-cancellation-reason" value={reason} maxLength={1000}
          disabled={saving || Boolean(attempt) || confirming} className="min-h-28"
          onChange={(event) => setReason(event.target.value)} />
      </div>
      {confirming && <div className="space-y-1 border-l-2 border-destructive pl-3 text-xs">
        <p className="font-semibold">Confirma la cancelación de esta orden</p>
        <p className="whitespace-pre-wrap">{reason.trim()}</p>
        <p>Se registrará como Cancelada y no se podrá reactivar.</p>
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {(pending || blocked) && !discarding && <Button size="sm" variant="outline"
        disabled={saving} onClick={() => setDiscarding(true)}>Descartar intento</Button>}
      {discarding && <div className="space-y-2 border-l-2 border-destructive pl-2">
        <p className="text-xs">La cancelación podría estar registrada.
          Revisa el historial antes de descartar y crear otro intento.</p>
        <Button size="sm" variant="destructive" disabled={saving}
          onClick={discard}>Confirmar descarte</Button>
        <Button size="sm" variant="outline" onClick={() => setDiscarding(false)}>
          Mantener intento</Button>
      </div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" disabled={saving}
          onClick={() => { setOpen(false); setError('') }}>Cerrar</Button>
        {confirming && !attempt && <Button size="sm" variant="outline"
          onClick={() => setConfirming(false)}>Editar</Button>}
        {!confirming ? <Button size="sm" disabled={saving || blocked}
          onClick={review}>Revisar cancelación</Button>
          : <Button size="sm" variant="destructive" disabled={saving || blocked}
            onClick={() => { void confirm() }}>
            {saving ? 'Cancelando…' : attempt ? 'Reintentar misma cancelación'
              : 'Confirmar cancelación'}
          </Button>}
      </div>
    </div>}
  </section>
}
