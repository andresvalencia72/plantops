import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiAsset, ApiReadClient, ApiReportInput } from './api-client'
import {
  clearPendingReport, fingerprintReport, readPendingReport, savePendingReport,
} from './report-retry-journal'
import type { PendingReport } from './report-retry-journal'

type Attempt = Readonly<{ key: string; input: ApiReportInput }>
type Fields = 'assetId' | 'title' | 'description'
type Errors = Partial<Record<Fields, string>>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
  organizationId: string
  userId: string
  assets: ApiAsset[]
  client: ApiReadClient
}

function validate(input: ApiReportInput, assets: ApiAsset[]): Errors {
  const errors: Errors = {}
  if (!assets.some((asset) => asset.id === input.assetId && asset.active)) {
    errors.assetId = 'Selecciona un activo habilitado de esta organización.'
  }
  if (input.title.length < 3 || input.title.length > 160) {
    errors.title = 'El título debe tener entre 3 y 160 caracteres.'
  }
  if (input.description.length < 10 || input.description.length > 4000) {
    errors.description = 'La descripción debe tener entre 10 y 4000 caracteres.'
  }
  return errors
}

export function ApiReportDialog({
  open, onOpenChange, onCreated, organizationId, userId, assets, client,
}: Props) {
  const [assetId, setAssetId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState(() => {
    try {
      readPendingReport(userId, organizationId)
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Error al recuperar el intento.'
    }
  })
  const [pending, setPending] = useState<Attempt | null>(null)
  const [saving, setSaving] = useState(false)
  const [recovery, setRecovery] = useState<PendingReport | null>(() => {
    try {
      return readPendingReport(userId, organizationId)
    } catch {
      return null
    }
  })

  function close(next: boolean) {
    if (!saving) onOpenChange(next)
    // A failed or uncertain request remains available for an identical retry.
  }

  function resetAttempt() {
    try {
      clearPendingReport(userId, organizationId)
      setPending(null)
      setRecovery(null)
      setError('')
      setErrors({})
    } catch {
      setError('No se pudo descartar la clave anterior. No envíes otro aviso todavía.')
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const input = pending?.input ?? {
      assetId, title: title.trim(), description: description.trim(),
    }
    if (!pending) {
      const nextErrors = validate(input, assets)
      setErrors(nextErrors)
      if (Object.keys(nextErrors).length) return
    }
    setError('')
    setSaving(true)
    try {
      let attempt = pending
      if (!attempt) {
        const fingerprint = await fingerprintReport(input)
        const stored = readPendingReport(userId, organizationId)
        if (stored && stored.fingerprint !== fingerprint) {
          setRecovery(stored)
          throw new Error('Existe otro aviso sin confirmar. Reintroduce exactamente los datos anteriores o descarta ese intento.')
        }
        const pointer = stored ?? { key: crypto.randomUUID(), fingerprint }
        savePendingReport(userId, organizationId, pointer)
        setRecovery(pointer)
        attempt = { key: pointer.key, input }
      }
      setPending(attempt)
      const result = await client.reportIncident(organizationId, attempt.input, attempt.key)
      try {
        clearPendingReport(userId, organizationId)
      } catch {
        // A confirmed 201 remains success even when browser storage is blocked.
      }
      setPending(null)
      setRecovery(null)
      setAssetId('')
      setTitle('')
      setDescription('')
      onCreated(result.id)
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message : 'No se pudo confirmar la operación. Reintenta la misma solicitud.')
      // No new key is allowed while a previously sent operation is uncertain.
    } finally {
      setSaving(false)
    }
  }

  const locked = pending !== null

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Reportar incidencia</DialogTitle>
          <DialogDescription>
            En el entorno aislado, el servidor comprobará tu sesión, organización y activo.
            No se utilizarán registros de demostración.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4 pt-3" noValidate aria-label="Reporte de incidencia API"
          onSubmit={(event) => { void submit(event) }}>
          <div className="space-y-2">
            <Label htmlFor="api-report-asset">Activo afectado</Label>
            <select id="api-report-asset" value={assetId}
              disabled={locked} aria-invalid={Boolean(errors.assetId)}
              aria-describedby={errors.assetId ? 'api-report-asset-error' : undefined}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              onChange={(event) => setAssetId(event.target.value)}>
              <option value="">Selecciona un activo…</option>
              {assets.filter((asset) => asset.active).map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>
              ))}
            </select>
            {errors.assetId && <p id="api-report-asset-error" className="text-xs text-destructive">{errors.assetId}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-report-title">Título</Label>
            <Input id="api-report-title" value={title} maxLength={160}
              disabled={locked} aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'api-report-title-error' : undefined}
              onChange={(event) => setTitle(event.target.value)} />
            {errors.title && <p id="api-report-title-error" className="text-xs text-destructive">{errors.title}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-report-description">Descripción</Label>
            <Textarea id="api-report-description" value={description}
              maxLength={4000} disabled={locked} className="min-h-28"
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'api-report-description-error' : undefined}
              onChange={(event) => setDescription(event.target.value)} />
            {errors.description && <p id="api-report-description-error" className="text-xs text-destructive">{errors.description}</p>}
          </div>
          {recovery && !locked && (
            <p role="status" className="text-xs text-muted-foreground">
              Hay un envío anterior sin confirmar. Vuelve a introducir exactamente
              sus datos para reintentar con la misma clave. Consulta también el listado
              antes de descartarlo: otro intento podría duplicar el aviso.
            </p>
          )}
          {locked && (
            <p role="status" className="text-xs text-muted-foreground">
              Se conserva la clave y el contenido de esta operación para evitar duplicados.
              Si la respuesta se perdió, reintenta antes de iniciar otra incidencia.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {(locked || recovery || error.startsWith('No se pudo verificar')) && error && (
            <Button type="button" size="sm" variant="outline"
              onClick={resetAttempt} disabled={saving}
              aria-label="Descartar intento anterior y editar datos">
              Descartar intento y editar
            </Button>
          )}
          {locked && error && (
            <p className="text-xs text-muted-foreground">
              Antes de cambiar el contenido, comprueba que no existe ya la incidencia:
              descartar una solicitud incierta podría producir otro registro.
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" disabled={saving}
              onClick={() => close(false)}>Cerrar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Enviando…' : pending ? 'Reintentar misma solicitud' : 'Registrar incidencia'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
