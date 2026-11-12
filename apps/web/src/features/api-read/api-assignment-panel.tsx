import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiRequestError } from './api-client'
import type { ApiAssignmentHistory, ApiAssignmentInput, ApiReadClient,
  ApiTechnician, ApiWorkOrderDetail } from './api-client'
import { clearPendingAssignment, fingerprintAssignment,
  readPendingAssignment, savePendingAssignment } from './assignment-retry-journal'
import type { PendingAssignment } from './assignment-retry-journal'

type State<T> = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; value: T }
type Attempt = Readonly<{ key: string; input: ApiAssignmentInput }>
function message(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo consultar la API.'
}

/** Version-gated assignment, read-only history and tab-local exact retry. */
export function ApiAssignmentPanel({ client, organizationId, incidentId,
  order, userId, canAssign, onUpdated }: {
  client: ApiReadClient; organizationId: string; incidentId: string
  order: ApiWorkOrderDetail; userId?: string; canAssign: boolean
  onUpdated: () => void
}) {
  const scope = [userId ?? '', organizationId, incidentId, order.id] as const
  const [history, setHistory] = useState<State<ApiAssignmentHistory[]>>(
    order.assignmentVersion === 0
      ? { status: 'ready', value: [] } : { status: 'loading' })
  const [historyRevision, setHistoryRevision] = useState(0)
  const [open, setOpen] = useState(false)
  const [technicians, setTechnicians] = useState<State<ApiTechnician[]>>(
    { status: 'loading' })
  const [technicianRevision, setTechnicianRevision] = useState(0)
  const [selected, setSelected] = useState('')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [pending, setPending] = useState<PendingAssignment | null>(() => {
    if (!userId) return null
    try { return readPendingAssignment(...scope) } catch { return null }
  })
  const [blocked, setBlocked] = useState(() => {
    if (!userId) return false
    try { readPendingAssignment(...scope); return false } catch { return true }
  })

  useEffect(() => {
    if (order.assignmentVersion === 0) return
    const controller = new AbortController()
    void client.assignmentHistory(organizationId, incidentId, order.id,
      controller.signal).then((value) => {
      if (!controller.signal.aborted) setHistory({ status: 'ready', value })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setHistory({ status: 'error', message: message(cause) })
    })
    return () => controller.abort()
  }, [client, organizationId, incidentId, order.id, order.assignmentVersion, historyRevision])

  useEffect(() => {
    if (!open || !canAssign) return
    const controller = new AbortController()
    void client.technicians(organizationId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setTechnicians({ status: 'ready', value })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setTechnicians({ status: 'error', message: message(cause) })
    })
    return () => controller.abort()
  }, [client, organizationId, open, canAssign, technicianRevision])

  const canChange = canAssign && userId &&
    (order.status === 'PENDING' || order.status === 'ASSIGNED')
  const version = pending?.expectedVersion ?? order.assignmentVersion
  const currentName = history.status === 'ready'
    ? history.value[history.value.length - 1]?.toName : undefined

  function prepare() {
    if (saving || blocked) return
    if (technicians.status !== 'ready' ||
      !technicians.value.some((item) => item.membershipId === selected)) {
      setError('Selecciona un técnico habilitado de la organización.')
      return
    }
    const normalizedReason = reason.trim()
    if (normalizedReason && (normalizedReason.length < 3 || normalizedReason.length > 500)) {
      setError('El motivo debe tener entre 3 y 500 caracteres.')
      return
    }
    setError('')
    setConfirming(true)
  }

  async function confirm() {
    if (saving || blocked || !userId) return
    setSaving(true)
    setError('')
    try {
      const input: ApiAssignmentInput = attempt?.input ?? {
        technicianMembershipId: selected, expectedVersion: version,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }
      let current = attempt
      if (!current) {
        const fingerprint = await fingerprintAssignment(incidentId, order.id, input)
        const stored = readPendingAssignment(...scope)
        if (stored && stored.fingerprint !== fingerprint) {
          setPending(stored)
          throw new Error('Los datos no coinciden con el intento pendiente. Reintroduce los datos originales o descarta tras revisar el historial.')
        }
        const pointer = stored ?? {
          key: crypto.randomUUID(), fingerprint, expectedVersion: input.expectedVersion,
        }
        savePendingAssignment(...scope, pointer)
        setPending(pointer)
        current = { key: pointer.key, input }
      }
      setAttempt(current)
      await client.assignTechnician(organizationId, incidentId, order.id,
        current.input, current.key)
      try { clearPendingAssignment(...scope) } catch { /* confirmed response wins */ }
      setPending(null)
      setAttempt(null)
      setOpen(false)
      setConfirming(false)
      setSelected('')
      setReason('')
      onUpdated()
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : message(cause))
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    if (saving || !userId) return
    try {
      clearPendingAssignment(...scope)
      setPending(null); setBlocked(false); setAttempt(null)
      setDiscarding(false); setConfirming(false)
      setSelected(''); setReason(''); setError('')
      onUpdated() // fetch current state, never assume an uncertain POST was rejected
    } catch { setError('No se pudo descartar. No envíes otro cambio todavía.') }
  }

  return <section className="mt-4 space-y-3 border-t border-border pt-4"
    aria-label="Asignación del técnico responsable">
    <div className="space-y-1">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider">Responsable técnico</h4>
      <p className="text-xs text-muted-foreground">
        {order.responsibleMembershipId
          ? currentName ?? 'Responsable asignado' : 'Sin técnico asignado'}
        {' · '}Versión {order.assignmentVersion}
      </p>
    </div>
    {history.status === 'loading' && <p role="status" className="text-xs">Consultando historial…</p>}
    {history.status === 'error' && <div className="space-y-1">
      <p role="alert" className="text-xs text-destructive">{history.message}</p>
      <Button variant="outline" size="sm" onClick={() => {
        setHistory({ status: 'loading' }); setHistoryRevision((n) => n + 1)
      }}>Reintentar historial</Button>
    </div>}
    {history.status === 'ready' && history.value.length > 0 && <ol
      className="space-y-2 border-l border-border pl-3 text-xs">
      {history.value.map((item) => <li key={item.id} className="space-y-1">
        <p className="font-medium">#{item.version} · {item.fromName ?? 'Sin asignar'} → {item.toName}</p>
        <p className="text-muted-foreground">Por {item.actorName} · {
          new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
            .format(new Date(item.occurredAt))}</p>
        {item.reason && <p className="text-muted-foreground">Motivo: {item.reason}</p>}
      </li>)}
    </ol>}
    {canChange && !open && <Button size="sm" variant="outline"
      onClick={() => setOpen(true)}>
      {order.assignmentVersion === 0 ? 'Asignar técnico' : 'Reasignar técnico'}
    </Button>}
    {canChange && open && <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">La asignación quedará auditada.
        No se permite cambiar al responsable después de iniciar el trabajo.</p>
      {pending && <p role="status" className="text-xs text-muted-foreground">
        Existe un envío anterior sin confirmar. Vuelve a seleccionar el mismo técnico
        y motivo para reintentar con la misma clave y versión.
      </p>}
      {blocked && <p role="alert" className="text-xs text-destructive">
        No se pudo verificar el intento guardado; revisa el historial antes de descartarlo.
      </p>}
      {technicians.status === 'loading' && <p role="status" className="text-xs">Cargando técnicos…</p>}
      {technicians.status === 'error' && <div className="space-y-1">
        <p role="alert" className="text-xs text-destructive">{technicians.message}</p>
        <Button size="sm" variant="outline" onClick={() => setTechnicianRevision((n) => n + 1)}>
          Reintentar técnicos
        </Button>
      </div>}
      {technicians.status === 'ready' && <div className="space-y-1">
        <Label htmlFor="api-assignment-technician">Técnico responsable</Label>
        <select id="api-assignment-technician" value={selected}
          disabled={Boolean(attempt) || confirming || saving}
          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
          onChange={(event) => setSelected(event.target.value)}>
          <option value="">Selecciona un técnico…</option>
          {technicians.value.filter((item) =>
            item.membershipId !== order.responsibleMembershipId || pending)
            .map((item) => <option key={item.membershipId} value={item.membershipId}>
              {item.displayName}
            </option>)}
        </select>
      </div>}
      <div className="space-y-1">
        <Label htmlFor="api-assignment-reason">Motivo del cambio (opcional)</Label>
        <Textarea id="api-assignment-reason" value={reason} maxLength={500}
          disabled={Boolean(attempt) || confirming || saving}
          className="min-h-20" onChange={(event) => setReason(event.target.value)} />
      </div>
      {confirming && <p className="border-l-2 border-primary pl-2 text-xs">
        Confirma la asignación del técnico seleccionado, versión esperada {version}.
      </p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {(pending || blocked) && !discarding && <Button size="sm" variant="outline"
        disabled={saving} onClick={() => setDiscarding(true)}>Descartar intento</Button>}
      {discarding && <div className="space-y-2 border-l-2 border-destructive pl-2">
        <p className="text-xs">El cambio anterior podría haberse confirmado.
          Comprueba el historial antes de descartar.</p>
        <Button size="sm" variant="destructive" disabled={saving}
          onClick={discard}>Confirmar descarte</Button>
        <Button size="sm" variant="outline" disabled={saving}
          onClick={() => setDiscarding(false)}>Mantener intento</Button>
      </div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" disabled={saving}
          onClick={() => setOpen(false)}>Cerrar</Button>
        {confirming && !attempt && <Button size="sm" variant="outline" disabled={saving}
          onClick={() => setConfirming(false)}>Editar</Button>}
        {!confirming ? <Button size="sm" disabled={saving || blocked ||
          technicians.status !== 'ready'} onClick={prepare}>Revisar asignación</Button>
          : <Button size="sm" disabled={saving || blocked}
            onClick={() => { void confirm() }}>
            {saving ? 'Confirmando…' : attempt ? 'Reintentar mismo cambio' : 'Confirmar asignación'}
          </Button>}
      </div>
    </div>}
  </section>
}
