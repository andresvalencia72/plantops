import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiExecutionEvent, ApiReadClient, ApiWorkOrderDetail } from './api-client'
import { clearExecutionRetry, fingerprintExecution,
  readExecutionRetry, saveExecutionRetry } from './execution-retry-journal'
import type { ExecutionAction, PendingExecution } from './execution-retry-journal'

type History = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; items: ApiExecutionEvent[] }
type Attempt = Readonly<{ action: ExecutionAction; key: string; result?: string }>
function description(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo confirmar la intervención.'
}

/** Current assignee only, server always re-authorizes on every POST. */
export function ApiExecutionPanel({ client, organizationId, incidentId,
  order, userId, membershipId, isolatedWrites, onUpdated }: {
  client: ApiReadClient; organizationId: string; incidentId: string
  order: ApiWorkOrderDetail; userId?: string; membershipId?: string
  isolatedWrites: boolean; onUpdated: () => void
}) {
  const scope = [userId ?? '', organizationId, incidentId, order.id] as const
  const stored = (action: ExecutionAction) => {
    if (!userId) return null
    try { return readExecutionRetry(...scope, action) } catch { return null }
  }
  const [startPointer, setStartPointer] = useState<PendingExecution | null>(() => stored('STARTED'))
  const [donePointer, setDonePointer] = useState<PendingExecution | null>(() => stored('COMPLETED'))
  const [blocked, setBlocked] = useState(() => {
    if (!userId) return false
    try { readExecutionRetry(...scope, 'STARTED');
      readExecutionRetry(...scope, 'COMPLETED'); return false
    } catch { return true }
  })
  const [history, setHistory] = useState<History>(
    order.status === 'PENDING' || order.status === 'ASSIGNED'
      ? { status: 'ready', items: [] } : { status: 'loading' })
  const [historyRevision, setHistoryRevision] = useState(0)
  const [result, setResult] = useState('')
  const [action, setAction] = useState<ExecutionAction | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [discarding, setDiscarding] = useState(false)

  useEffect(() => {
    if (order.status === 'PENDING' || order.status === 'ASSIGNED') return
    const controller = new AbortController()
    void client.executionHistory(organizationId, incidentId, order.id,
      controller.signal).then((items) => {
      if (!controller.signal.aborted) setHistory({ status: 'ready', items })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setHistory({ status: 'error',
        message: description(cause) })
    })
    return () => controller.abort()
  }, [client, organizationId, incidentId, order.id, order.status, historyRevision])

  const own = isolatedWrites && Boolean(userId && membershipId &&
    membershipId === order.responsibleMembershipId)
  const pendingAction: ExecutionAction | null = startPointer ? 'STARTED'
    : donePointer ? 'COMPLETED' : null
  const available: ExecutionAction | null = pendingAction ||
    (order.status === 'ASSIGNED' ? 'STARTED'
      : order.status === 'IN_PROGRESS' ? 'COMPLETED' : null)

  function prepare(next: ExecutionAction) {
    if (!own || saving || (pendingAction && pendingAction !== next) || blocked) return
    setAction(next)
    setError('')
    setConfirmed(false)
  }

  function review() {
    if (!action) return
    if (action === 'COMPLETED' &&
      (result.trim().length < 10 || result.trim().length > 4000)) {
      setError('Describe el resultado del trabajo con entre 10 y 4000 caracteres.')
      return
    }
    setError('')
    setConfirmed(true)
  }

  async function send() {
    if (!userId || !action || !own || saving || blocked) return
    setSaving(true)
    setError('')
    try {
      const submitted = attempt?.result ?? (action === 'COMPLETED' ? result.trim() : undefined)
      if (action === 'COMPLETED' && (!submitted || submitted.length < 10 ||
        submitted.length > 4000)) throw new Error('Resultado inválido')
      const fingerprint = await fingerprintExecution(incidentId, order.id, action, submitted)
      const previous = readExecutionRetry(...scope, action)
      if (previous && previous.fingerprint !== fingerprint) {
        throw new Error('El contenido no coincide con el intento anterior. Reintroduce exactamente el mismo resultado o revisa el historial antes de descartarlo.')
      }
      const pointer = previous ?? { key: crypto.randomUUID(), fingerprint }
      saveExecutionRetry(...scope, action, pointer)
      if (action === 'STARTED') setStartPointer(pointer)
      else setDonePointer(pointer)
      setAttempt({ key: pointer.key, action, ...(submitted ? { result: submitted } : {}) })
      await client.executeOrder(organizationId, incidentId, order.id,
        action, pointer.key, submitted)
      try { clearExecutionRetry(...scope, action) } catch { /* server success wins */ }
      if (action === 'STARTED') setStartPointer(null)
      else setDonePointer(null)
      setAction(null)
      setConfirmed(false)
      setAttempt(null)
      setResult('')
      onUpdated()
    } catch (cause) { setError(description(cause)) }
    finally { setSaving(false) }
  }

  function discard() {
    if (!userId || !pendingAction || saving) return
    try {
      clearExecutionRetry(...scope, pendingAction)
      if (pendingAction === 'STARTED') setStartPointer(null)
      else setDonePointer(null)
      setAttempt(null); setAction(null); setConfirmed(false)
      setDiscarding(false); setBlocked(false); setError(''); setResult('')
      onUpdated() // re-read server; never assume uncertainty equals failure
    } catch { setError('No se pudo descartar el intento. Evita una segunda escritura.') }
  }

  return <section aria-label="Ejecución de la orden" className="mt-4 space-y-3 border-t border-border pt-4">
    <h4 className="text-[11px] font-semibold uppercase tracking-wider">Intervención técnica</h4>
    {history.status === 'loading' && <p role="status" className="text-xs">Consultando ejecución…</p>}
    {history.status === 'error' && <div className="space-y-2">
      <p role="alert" className="text-xs text-destructive">{history.message}</p>
      <Button size="sm" variant="outline" onClick={() => {
        setHistory({ status: 'loading' }); setHistoryRevision((n) => n + 1)
      }}>Reintentar historial de ejecución</Button>
    </div>}
    {history.status === 'ready' && history.items.length === 0 &&
      <p className="text-xs text-muted-foreground">Todavía no se ha iniciado el trabajo.</p>}
    {history.status === 'ready' && history.items.length > 0 &&
      <ol className="space-y-2 border-l border-border pl-3 text-xs">
        {history.items.map((item) => <li key={item.id} className="space-y-1">
          <p className="font-medium">{item.action === 'STARTED' ? 'Trabajo iniciado'
            : 'Trabajo completado'} · {new Intl.DateTimeFormat('es-ES', {
            dateStyle: 'medium', timeStyle: 'short',
          }).format(new Date(item.occurredAt))}</p>
          {item.result && <p className="whitespace-pre-wrap text-muted-foreground">{item.result}</p>}
        </li>)}
      </ol>}
    {own && available && !action && <Button size="sm" variant="outline"
      onClick={() => prepare(available)}>
      {pendingAction ? 'Recuperar operación sin confirmar'
        : available === 'STARTED' ? 'Iniciar trabajo' : 'Completar trabajo'}
    </Button>}
    {own && (action || blocked) && <div className="space-y-3 rounded-md border border-border p-3">
      {pendingAction && <p role="status" className="text-xs text-muted-foreground">
        Hay un envío anterior sin confirmar. Reintroduce exactamente los mismos datos
        y reutilizaremos la clave original. No se puede deducir éxito por el estado.
      </p>}
      {blocked && <p role="alert" className="text-xs text-destructive">
        El intento guardado no se pudo validar. Comprueba el historial antes de descartarlo.
      </p>}
      {action === 'COMPLETED' && <div className="space-y-1">
        <Label htmlFor="api-execution-result">Trabajo realizado y resultado</Label>
        <Textarea id="api-execution-result" value={result} maxLength={4000}
          disabled={saving || Boolean(attempt) || confirmed}
          className="min-h-28" onChange={(event) => setResult(event.target.value)} />
      </div>}
      {confirmed && <div className="space-y-1 border-l-2 border-primary pl-3 text-xs">
        <p className="font-semibold">Confirma la transición de la orden</p>
        <p>{action === 'STARTED' ? 'Pasará a En ejecución.' : 'Pasará a Completada.'}</p>
        {action === 'COMPLETED' && <p className="whitespace-pre-wrap">{result.trim()}</p>}
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {(pendingAction || blocked) && !discarding && <Button size="sm" variant="outline"
        disabled={saving} onClick={() => setDiscarding(true)}>Descartar intento</Button>}
      {discarding && <div className="space-y-2 border-l-2 border-destructive pl-2 text-xs">
        <p>La operación anterior podría haberse confirmado. Revisa primero el historial.</p>
        <Button size="sm" variant="destructive" disabled={saving}
          onClick={discard}>Confirmar descarte</Button>
        <Button size="sm" variant="outline" onClick={() => setDiscarding(false)}>
          Mantener intento</Button>
      </div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" disabled={saving}
          onClick={() => { setAction(null); setConfirmed(false); setError('') }}>Cerrar</Button>
        {confirmed && !attempt && <Button size="sm" variant="outline"
          onClick={() => setConfirmed(false)}>Editar</Button>}
        {!confirmed ? <Button size="sm" disabled={saving || blocked}
          onClick={review}>Revisar operación</Button>
          : <Button size="sm" disabled={saving || blocked} onClick={() => { void send() }}>
            {saving ? 'Confirmando…' : attempt ? 'Reintentar operación'
              : action === 'STARTED' ? 'Confirmar inicio' : 'Confirmar finalización'}
          </Button>}
      </div>
    </div>}
  </section>
}
