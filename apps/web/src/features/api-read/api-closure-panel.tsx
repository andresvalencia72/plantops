import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiCloseInput, ApiClosureSnapshot, ApiReadClient } from './api-client'
import { clearClosureRetry, closureFingerprint,
  readClosureRetry, saveClosureRetry } from './closure-retry-journal'
import type { PendingClosure } from './closure-retry-journal'

type State = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; value: ApiClosureSnapshot }
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'No se pudo confirmar el cierre.'
}

/** Preview is advisory; backend locks incident and recounts before closing. */
export function ApiClosurePanel({ client, organizationId, incidentId,
  userId, canClose, onClosed }: {
  client: ApiReadClient; organizationId: string; incidentId: string;
  userId?: string; canClose: boolean; onClosed: () => void
}) {
  const scope = [userId ?? '', organizationId, incidentId] as const
  const [state, setState] = useState<State>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState<PendingClosure | null>(() => {
    if (!userId) return null
    try { return readClosureRetry(...scope) } catch { return null }
  })
  const [blocked, setBlocked] = useState(() => {
    if (!userId) return false
    try { readClosureRetry(...scope); return false } catch { return true }
  })
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const [attempt, setAttempt] = useState<ApiCloseInput | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void client.closure(organizationId, incidentId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) {
        setState({ status: 'ready', value })
      } }).catch((cause: unknown) => { if (!controller.signal.aborted) {
        setState({ status: 'error', message: message(cause) })
      } })
    return () => controller.abort()
  }, [client, organizationId, incidentId, revision])

  const snapshot = state.status === 'ready' ? state.value : null
  const needsConclusion = (snapshot?.orders.total ?? 0) > 0
  const eligible = snapshot && (snapshot.orders.total === 0
    ? snapshot.status === 'UNDER_REVIEW'
    : snapshot.status === 'IN_PROGRESS' && snapshot.orders.open === 0)
  const allowed = canClose && Boolean(userId) && Boolean(eligible || pending || blocked)

  function review() {
    if (saving || blocked) return
    if (reason.trim().length < 10 || reason.trim().length > 1000) {
      setError('Explica el motivo de cierre con entre 10 y 1000 caracteres.')
      return
    }
    if (needsConclusion && (conclusion.trim().length < 20 ||
      conclusion.trim().length > 4000)) {
      setError('La conclusión técnica debe contener entre 20 y 4000 caracteres.')
      return
    }
    setError(''); setConfirming(true)
  }

  async function confirm() {
    if (!allowed || !userId || saving || blocked) return
    setSaving(true); setError('')
    try {
      const input: ApiCloseInput = attempt ?? {
        reason: reason.trim(),
        ...(needsConclusion ? { conclusion: conclusion.trim() } : {}),
      }
      if (input.reason.length < 10 || input.reason.length > 1000 ||
        (input.conclusion !== undefined && (input.conclusion.length < 20 ||
          input.conclusion.length > 4000))) throw new Error('Datos de cierre inválidos')
      const fingerprint = await closureFingerprint(incidentId,
        input.reason, input.conclusion)
      const stored = readClosureRetry(...scope)
      if (stored && stored.fingerprint !== fingerprint) {
        throw new Error('Los datos no coinciden con el intento anterior. Reintroduce el motivo y conclusión originales o consulta el historial antes de descartar.')
      }
      const pointer = stored ?? { key: crypto.randomUUID(), fingerprint }
      saveClosureRetry(...scope, pointer)
      setPending(pointer); setAttempt(input)
      await client.closeIncident(organizationId, incidentId, input, pointer.key)
      try { clearClosureRetry(...scope) } catch { /* server confirmation wins */ }
      setPending(null); setAttempt(null); setOpen(false)
      setConfirming(false); setReason(''); setConclusion('')
      onClosed()
    } catch (cause) { setError(message(cause)) }
    finally { setSaving(false) }
  }

  function discard() {
    if (!userId || saving) return
    try {
      clearClosureRetry(...scope)
      setPending(null); setBlocked(false); setAttempt(null)
      setDiscarding(false); setConfirming(false); setOpen(false)
      setReason(''); setConclusion(''); setError('')
      onClosed() // server remains authoritative after uncertain response
    } catch { setError('No se pudo descartar. No envíes un segundo cierre.') }
  }

  return <section aria-label="Cierre de incidencia" className="space-y-3 border-t border-border pt-5">
    <h3 className="text-[11px] font-semibold uppercase tracking-wider">Cierre de incidencia</h3>
    {state.status === 'loading' && <p role="status" className="text-xs">Comprobando órdenes…</p>}
    {state.status === 'error' && <div className="space-y-2">
      <p role="alert" className="text-xs text-destructive">{state.message}</p>
      <Button variant="outline" size="sm" onClick={() => {
        setState({ status: 'loading' }); setRevision((n) => n + 1)
      }}>Reintentar comprobación</Button>
    </div>}
    {snapshot && <div className="space-y-1 text-xs text-muted-foreground">
      <p>{snapshot.orders.total} órdenes · {snapshot.orders.completed} completadas · {
        snapshot.orders.cancelled} canceladas · {snapshot.orders.open} abiertas</p>
      {snapshot.orders.open > 0 && <p role="status">
        No se puede cerrar mientras existan órdenes sin finalizar.
      </p>}
      {snapshot.status === 'REPORTED' && <p>Debe iniciarse la revisión antes de cerrar.</p>}
      {snapshot.status === 'CLOSED' && snapshot.closure && <div className="space-y-2">
        <p className="font-semibold text-foreground">Incidencia cerrada</p>
        <p className="whitespace-pre-wrap">Motivo: {snapshot.closure.reason}</p>
        {snapshot.closure.conclusion && <p className="whitespace-pre-wrap">
          Conclusión: {snapshot.closure.conclusion}</p>}
        <p>{new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
          .format(new Date(snapshot.closure.closedAt))}</p>
      </div>}
    </div>}
    {allowed && !open && <Button size="sm" variant="outline"
      onClick={() => setOpen(true)}>
      {pending ? 'Recuperar cierre sin confirmar' : 'Cerrar incidencia'}
    </Button>}
    {allowed && open && <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        El supervisor debe confirmar el motivo. La API volverá a comprobar
        todas las órdenes en una transacción antes del cierre.
      </p>
      {pending && <p role="status" className="text-xs text-muted-foreground">
        Hay un intento anterior sin confirmar. Reintroduce exactamente los datos
        originales para reutilizar la misma clave, incluso si ya está cerrada.
      </p>}
      {blocked && <p role="alert" className="text-xs text-destructive">
        El intento guardado no se puede verificar. Comprueba el historial.
      </p>}
      <div className="space-y-1">
        <Label htmlFor="api-closure-reason">Motivo de cierre</Label>
        <Textarea id="api-closure-reason" value={reason} maxLength={1000}
          disabled={saving || confirming || Boolean(attempt)} className="min-h-24"
          onChange={(event) => setReason(event.target.value)} />
      </div>
      {needsConclusion && <div className="space-y-1">
        <Label htmlFor="api-closure-conclusion">Conclusión del trabajo</Label>
        <Textarea id="api-closure-conclusion" value={conclusion} maxLength={4000}
          disabled={saving || confirming || Boolean(attempt)} className="min-h-28"
          onChange={(event) => setConclusion(event.target.value)} />
      </div>}
      {confirming && <div className="space-y-1 border-l-2 border-destructive pl-3 text-xs">
        <p className="font-semibold">Confirma el cierre definitivo</p>
        <p className="whitespace-pre-wrap">{reason.trim()}</p>
        {needsConclusion && <p className="whitespace-pre-wrap">{conclusion.trim()}</p>}
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {(pending || blocked) && !discarding && <Button size="sm" variant="outline"
        disabled={saving} onClick={() => setDiscarding(true)}>Descartar intento</Button>}
      {discarding && <div className="space-y-2 border-l-2 border-destructive pl-2 text-xs">
        <p>El cierre anterior podría haberse confirmado. Comprueba el estado antes de descartarlo.</p>
        <Button size="sm" variant="destructive" disabled={saving}
          onClick={discard}>Confirmar descarte</Button>
        <Button size="sm" variant="outline" onClick={() => setDiscarding(false)}>
          Mantener intento</Button>
      </div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => {
          setOpen(false); setConfirming(false); setError('')
        }}>Cerrar formulario</Button>
        {confirming && !attempt && <Button size="sm" variant="outline"
          onClick={() => setConfirming(false)}>Editar</Button>}
        {!confirming ? <Button size="sm" disabled={saving || blocked}
          onClick={review}>Revisar cierre</Button> :
          <Button size="sm" variant="destructive" disabled={saving || blocked}
            onClick={() => { void confirm() }}>
            {saving ? 'Cerrando…' : attempt ? 'Reintentar mismo cierre'
              : 'Confirmar cierre'}
          </Button>}
      </div>
    </div>}
  </section>
}
