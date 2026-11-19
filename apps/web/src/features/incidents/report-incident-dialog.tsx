import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { DemoOrganization } from '@/app/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { mockIncidentRepository } from './mock-repository'
import type { AssetSummary, ReportIncidentInput } from './types'

interface ReportIncidentDialogProps {
  organization: DemoOrganization
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}

type FormErrors = Partial<Record<keyof ReportIncidentInput | 'general', string>>

export function ReportIncidentDialog({
  organization, open, onOpenChange, onCreated,
}: ReportIncidentDialogProps) {
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [assetId, setAssetId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    void mockIncidentRepository.listAssets(organization).then((result) => {
      if (active) setAssets(result)
    }).catch(() => {
      if (active) setErrors({ general: 'No se pudieron cargar los activos.' })
    })
    return () => { active = false }
  }, [open, organization])

  function close(nextOpen: boolean) {
    if (!nextOpen && saving) return
    if (!nextOpen) {
      setAssetId('')
      setTitle('')
      setDescription('')
      setErrors({})
      setAssets([])
    }
    onOpenChange(nextOpen)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const validation: FormErrors = {}
    if (!assetId) validation.assetId = 'Selecciona un activo de esta organización.'
    if (title.trim().length < 3) validation.title = 'El título debe contener al menos 3 caracteres.'
    if (description.trim().length < 10) validation.description = 'Describe el problema en al menos 10 caracteres.'
    if (Object.keys(validation).length) {
      setErrors(validation)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const created = await mockIncidentRepository.report(organization, { assetId, title, description })
      onCreated(created.id)
      closeAfterSuccess()
    } catch (error) {
      setErrors({ general: error instanceof Error ? error.message : 'No se pudo crear la incidencia.' })
    } finally {
      setSaving(false)
    }
  }

  function closeAfterSuccess() {
    setAssetId('')
    setTitle('')
    setDescription('')
    setErrors({})
    setAssets([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-lg font-semibold">Registrar incidencia</DialogTitle>
          <DialogDescription>
            Vincula el aviso a un activo existente. Se guardará únicamente en este entorno de demostración.
          </DialogDescription>
        </DialogHeader>
        <form aria-label="Registrar nueva incidencia" className="space-y-5 pt-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="space-y-2">
            <Label htmlFor="report-asset">Activo afectado</Label>
            <select
              id="report-asset"
              aria-invalid={Boolean(errors.assetId)}
              aria-describedby={errors.assetId ? 'report-asset-error' : undefined}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-2 focus-visible:outline-ring"
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
            >
              <option value="">Selecciona un activo…</option>
              {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}
            </select>
            {errors.assetId && <p id="report-asset-error" className="text-xs text-destructive">{errors.assetId}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-title">Título del problema</Label>
            <Input
              id="report-title"
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'report-title-error' : undefined}
              maxLength={120}
              placeholder="Por ejemplo: presión irregular en compresor"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            {errors.title && <p id="report-title-error" className="text-xs text-destructive">{errors.title}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-description">Descripción</Label>
            <Textarea
              id="report-description"
              className="min-h-28 resize-y"
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'report-description-error' : undefined}
              maxLength={1500}
              placeholder="Qué ocurrió, cómo se detectó y qué equipo está afectado…"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            {errors.description && <p id="report-description-error" className="text-xs text-destructive">{errors.description}</p>}
          </div>
          <p className="border-l-2 border-primary/60 pl-3 text-xs text-muted-foreground">
            El aviso se registrará en estado «Reportada» y prioridad media. Un supervisor podrá evaluarlo después.
          </p>
          {errors.general && <p role="alert" className="text-xs text-destructive">{errors.general}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" disabled={saving} onClick={() => close(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Registrar aviso'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
