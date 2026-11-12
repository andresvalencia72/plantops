import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiRequestError } from './api-client'
import type { ApiCreateOrderInput, ApiReadClient } from './api-client'
import {
  clearPendingOrder, fingerprintOrder, readPendingOrder, savePendingOrder,
} from './order-retry-journal'
import type { PendingOrder } from './order-retry-journal'

type Attempt = Readonly<{ input: ApiCreateOrderInput; key: string }>
type Errors = Partial<Record<'title' | 'description', string>>

function validate(input: ApiCreateOrderInput): Errors {
  const errors: Errors = {}
  if (input.title.length < 3 || input.title.length > 160) {
    errors.title = 'El título debe tener entre 3 y 160 caracteres.'
  }
  if (input.description.length < 10 || input.description.length > 4000) {
    errors.description = 'La descripción debe tener entre 10 y 4000 caracteres.'
  }
  return errors
}

/** The parent gates this to an isolated ACTIVE supervisor, backend remains authoritative. */
export function ApiCreateCorrectiveOrder({ client, organizationId, incidentId, userId,
  onCreated }: {
  client: ApiReadClient; organizationId: string; incidentId: string
  userId: string; onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'editing' | 'confirming'>('editing')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [saving, setSaving] = useState(false)
  const [discardRequested, setDiscardRequested] = useState(false)
  const [recovery, setRecovery] = useState<PendingOrder | null>(() => {
    try { return readPendingOrder(userId, organizationId, incidentId) }
    catch { return null }
  })
  const [recoveryBlocked, setRecoveryBlocked] = useState(() => {
    try { readPendingOrder(userId, organizationId, incidentId); return false }
    catch { return true }
  })

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || recoveryBlocked) return
    const input = { title: title.trim(), description: description.trim() }
    const next = validate(input)
    setErrors(next)
    if (Object.keys(next).length) return
    setError('')
    setPhase('confirming')
  }

  async function confirm() {
    if (saving || recoveryBlocked) return
    setSaving(true)
    setError('')
    try {
      const input: ApiCreateOrderInput = attempt?.input ?? {
        title: title.trim(), description: description.trim(),
      }
      const nextErrors = validate(input)
      if (Object.keys(nextErrors).length) {
        setErrors(nextErrors)
        setPhase('editing')
        return
      }
      let current = attempt
      if (!current) {
        const fingerprint = await fingerprintOrder(incidentId, input)
        const stored = readPendingOrder(userId, organizationId, incidentId)
        if (stored && stored.fingerprint !== fingerprint) {
          setRecovery(stored)
          throw new Error('Hay otra orden sin confirmar. Reintroduce exactamente los mismos datos o revisa y descarta el intento.')
        }
        const pointer = stored ?? { key: crypto.randomUUID(), fingerprint }
        savePendingOrder(userId, organizationId, incidentId, pointer)
        setRecovery(pointer)
        current = { key: pointer.key, input }
      }
      setAttempt(current)
      await client.createCorrectiveOrder(organizationId, incidentId,
        current.input, current.key)
      try { clearPendingOrder(userId, organizationId, incidentId) } catch {
        // Confirmed server response remains authoritative if browser storage fails.
      }
      setAttempt(null)
      setRecovery(null)
      setTitle('')
      setDescription('')
      setOpen(false)
      setPhase('editing')
      onCreated()
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message
        : cause instanceof Error ? cause.message
          : 'No se pudo confirmar la orden. Reintenta la misma solicitud.')
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    if (saving) return
    try {
      clearPendingOrder(userId, organizationId, incidentId)
      setAttempt(null)
      setRecovery(null)
      setRecoveryBlocked(false)
      setDiscardRequested(false)
      setPhase('editing')
      setTitle('')
      setDescription('')
      setErrors({})
      setError('')
    } catch {
      setError('No se pudo descartar el intento. No envíes una segunda orden.')
    }
  }

  return (
    <div className="space-y-3">
      {!open && <Button size="sm" onClick={() => setOpen(true)}>Crear orden correctiva</Button>}
      {open && <div className="space-y-4 rounded-md border border-border bg-muted/20 p-4">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Nueva orden correctiva</h4>
          <p className="text-xs leading-5 text-muted-foreground">
            El activo se vincula automáticamente a esta incidencia. La nueva orden
            quedará pendiente y su creación será auditada.
          </p>
        </div>
        {recovery && <p role="status" className="text-xs leading-5 text-muted-foreground">
          Hay un envío anterior sin confirmar. Reintroduce exactamente el título
          y la descripción para reutilizar su clave; comprueba el listado antes
          de descartarlo, porque la orden podría haberse registrado.
        </p>}
        {recoveryBlocked && <p role="alert" className="text-xs text-destructive">
          El intento guardado no se pudo validar. Revisa las órdenes antes de continuar.
        </p>}
        <form aria-label="Creación de orden correctiva" className="space-y-4" noValidate
          onSubmit={prepare}>
          <div className="space-y-1.5">
            <Label htmlFor="api-corrective-title">Título de la orden</Label>
            <Input id="api-corrective-title" value={title} maxLength={160}
              disabled={Boolean(attempt) || saving || phase === 'confirming'}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'corrective-title-error' : undefined}
              onChange={(event) => setTitle(event.target.value)} />
            {errors.title && <p id="corrective-title-error" className="text-xs text-destructive">{errors.title}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="api-corrective-description">Descripción de la orden</Label>
            <Textarea id="api-corrective-description" value={description}
              maxLength={4000} className="min-h-28"
              disabled={Boolean(attempt) || saving || phase === 'confirming'}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'corrective-description-error' : undefined}
              onChange={(event) => setDescription(event.target.value)} />
            {errors.description && <p id="corrective-description-error" className="text-xs text-destructive">{errors.description}</p>}
          </div>
          {phase === 'confirming' && <div className="space-y-2 border-l-2 border-primary pl-3">
            <p className="text-xs font-semibold">Comprueba la orden antes de enviarla</p>
            <p className="text-xs">{title.trim()}</p>
            <p className="text-xs text-muted-foreground">{description.trim()}</p>
            <p className="text-xs text-muted-foreground">Se creará en estado Pendiente.</p>
          </div>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {(recovery || recoveryBlocked) && !discardRequested && <Button type="button"
            size="sm" variant="outline" disabled={saving}
            onClick={() => setDiscardRequested(true)}>Descartar intento anterior</Button>}
          {discardRequested && <div className="space-y-2 border-l-2 border-destructive pl-3">
            <p className="text-xs text-destructive">Podría existir una orden creada. Confirma el descarte solo tras comprobar el listado.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="destructive" onClick={discard}>
                Confirmar descarte
              </Button>
              <Button type="button" size="sm" variant="outline"
                onClick={() => setDiscardRequested(false)}>Mantener intento</Button>
            </div>
          </div>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            <Button type="button" size="sm" variant="outline" disabled={saving}
              onClick={() => { setOpen(false); setError(''); setDiscardRequested(false) }}>
              Cerrar
            </Button>
            {phase === 'confirming' && !attempt && <Button type="button" size="sm"
              variant="outline" disabled={saving}
              onClick={() => setPhase('editing')}>Editar</Button>}
            {phase === 'editing'
              ? <Button type="submit" size="sm" disabled={saving || recoveryBlocked}>
                Revisar orden
              </Button>
              : <Button type="button" size="sm" disabled={saving || recoveryBlocked}
                  onClick={() => { void confirm() }}>
                  {saving ? 'Creando…' : attempt ? 'Reintentar misma orden' : 'Confirmar creación'}
                </Button>}
          </div>
        </form>
      </div>}
    </div>
  )
}
