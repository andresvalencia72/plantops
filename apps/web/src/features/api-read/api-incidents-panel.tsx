import { useEffect, useState } from 'react'
import { ArrowUpRight, ChevronLeft, ChevronRight, Database, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/incidents/incident-badges'
import { ApiRequestError } from './api-client'
import type { ApiAsset, ApiIncidentPage, ApiReadClient, ApiOrganization } from './api-client'
import { ApiIncidentDetailSheet } from './api-incident-detail'
import { ApiReportDialog } from './api-report-dialog'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; page: ApiIncidentPage; assets: ApiAsset[] }

type Props = { client: ApiReadClient; organization: ApiOrganization; userId: string; allowWrites?: boolean }

function errorMessage(error: unknown) {
  return error instanceof ApiRequestError ? error.message
    : 'No se pudieron obtener datos de la API. Revisa la conexión y vuelve a intentar.'
}

export function ApiIncidentsPanel({ client, organization, userId, allowWrites = false }: Props) {
  const [reportOpen, setReportOpen] = useState(false)
  const [cursor, setCursor] = useState<string | undefined>()
  const [previous, setPrevious] = useState<(string | undefined)[]>([])
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      client.assets(organization.id, controller.signal),
      client.incidents(organization.id, cursor, controller.signal),
    ]).then(([assets, page]) => {
      if (!controller.signal.aborted) setState({ status: 'ready', assets, page })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: errorMessage(error) })
      }
    })
    return () => controller.abort()
  }, [client, organization.id, cursor, revision])

  const page = state.status === 'ready' ? state.page : null
  const assets = state.status === 'ready' ? state.assets : []
  const assetLookup = new Map(assets.map((item) => [item.id, item]))
  const pageNumber = previous.length + 1

  function next() {
    if (!page?.nextCursor) return
    setSelectedId(null)
    setState({ status: 'loading' })
    setPrevious((list) => [...list, cursor])
    setCursor(page.nextCursor)
  }
  function back() {
    if (!previous.length) return
    setSelectedId(null)
    setState({ status: 'loading' })
    setCursor(previous[previous.length - 1])
    setPrevious((list) => list.slice(0, -1))
  }

  function created(id: string) {
    setSelectedId(id)
    setCursor(undefined)
    setPrevious([])
    setState({ status: 'loading' })
    setRevision((value) => value + 1)
  }

  function refresh() {
    setSelectedId(null)
    setState({ status: 'loading' })
    setRevision((n) => n + 1)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <section className="border border-border bg-card p-5">
          <p className="text-[11px] font-medium text-muted-foreground">Organización autorizada</p>
          <p className="mt-3 truncate text-lg font-semibold">{organization.name}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Rol confirmado por el servidor: {organization.role}</p>
        </section>
        <section className="border border-border bg-card p-5">
          <p className="text-[11px] font-medium text-muted-foreground">Activos registrados</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums">
            {state.status === 'ready' ? assets.length : '—'}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Datos consultados en esta organización</p>
        </section>
        <section className="border border-border bg-card p-5">
          <p className="text-[11px] font-medium text-muted-foreground">Incidencias en esta página</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums">
            {page ? page.items.length : '—'}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Página {pageNumber} · No representa el total global</p>
        </section>
      </div>
      <section className="border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5">
          <div>
            <h2 className="text-[14px] font-semibold">Incidencias registradas</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {allowWrites ? 'Consulta y reporte en entorno aislado de pruebas'
                : 'Consulta paginada del servidor · sin operaciones de escritura'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {allowWrites && userId && state.status === 'ready' && (
              <Button size="sm" disabled={!assets.some((item) => item.active)}
                onClick={() => setReportOpen(true)}>Reportar incidencia</Button>
            )}
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" /> Actualizar
          </Button>
          </div>
        </header>
        {state.status === 'loading' && (
          <div role="status" className="p-10 text-center text-sm text-muted-foreground">
            Consultando activos e incidencias autorizadas…
          </div>
        )}
        {state.status === 'error' && (
          <div className="space-y-4 p-10 text-center">
            <p role="alert" className="text-sm text-destructive">{state.message}</p>
            <Button variant="outline" onClick={refresh}>Reintentar</Button>
          </div>
        )}
        {page && page.items.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Database size={24} className="text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No hay incidencias en esta página</p>
            <p className="text-xs text-muted-foreground">El servidor no devolvió registros. No se muestran ejemplos ficticios.</p>
          </div>
        )}
        {page && page.items.length > 0 && (
          <div className="divide-y divide-border">
            {page.items.map((incident) => {
              const asset = assetLookup.get(incident.assetId)
              return (
                <button
                  key={incident.id}
                  className="flex w-full flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => setSelectedId(incident.id)}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-[13px] font-semibold">{incident.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {asset ? `${asset.code} · ${asset.name}` : 'Activo no disponible'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <StatusBadge value={incident.status} />
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">
                      {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' })
                        .format(new Date(incident.reportedAt))}
                    </span>
                    <ArrowUpRight size={16} className="text-muted-foreground" aria-hidden="true" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
        {page && (
          <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
            <p className="text-[11px] text-muted-foreground">Página {pageNumber} · {page.items.length} registros</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!previous.length} onClick={back}>
                <ChevronLeft size={14} aria-hidden="true" /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={!page.nextCursor} onClick={next}>
                Siguiente <ChevronRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </footer>
        )}
      </section>
      {allowWrites && userId && (
        <ApiReportDialog
          client={client} assets={assets} organizationId={organization.id} userId={userId}
          open={reportOpen} onOpenChange={setReportOpen} onCreated={created}
        />
      )}
      <ApiIncidentDetailSheet
        key={selectedId ?? 'closed'}
        client={client}
        organizationId={organization.id}
        incidentId={selectedId}
        assets={assets}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
