import { useEffect, useState } from 'react'
import { Boxes, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ApiAsset, ApiOrganization, ApiReadClient } from './api-client'
import type { AssetCatalogFilters, AssetCatalogPage } from './asset-catalog-api'
import { ApiAssetDetail } from './api-asset-detail'

type State = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; page: AssetCatalogPage }

export function ApiAssetsPanel({ client, organization, onOpenIncident, onOpenOrder }: {
  client: ApiReadClient; organization: ApiOrganization
  onOpenIncident: (id: string) => void
  onOpenOrder: (order: { id: string; incidentId: string }) => void
}) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<AssetCatalogFilters>({})
  const [cursor, setCursor] = useState<string | undefined>()
  const [previous, setPrevious] = useState<(string | undefined)[]>([])
  const [state, setState] = useState<State>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<ApiAsset | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void client.assetCatalog(organization.id, filters, cursor,
      controller.signal).then((page) => {
      if (!controller.signal.aborted) setState({ status: 'ready', page })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: 'error', message:
        error instanceof Error ? error.message : 'No se pudo consultar el catálogo.' })
    })
    return () => controller.abort()
  }, [client, organization.id, filters, cursor, revision])

  const page = state.status === 'ready' ? state.page : null
  function apply(next: AssetCatalogFilters) {
    setFilters(next); setCursor(undefined); setPrevious([])
    setState({ status: 'loading' }); setSelected(null)
  }
  function navigate(next: string | undefined, back: boolean) {
    setSelected(null); setState({ status: 'loading' })
    setPrevious((list) => back ? list.slice(0, -1) : [...list, cursor])
    setCursor(next)
  }
  function refresh() {
    setSelected(null); setState({ status: 'loading' })
    setRevision((n) => n + 1)
  }

  return <div className="space-y-6">
    <section className="border border-border bg-card" aria-labelledby="asset-catalog-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5">
        <div>
          <h2 id="asset-catalog-title" className="text-[14px] font-semibold">Catálogo de activos</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Equipos de {organization.name} · consulta autorizada sin modificaciones
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw size={14} aria-hidden="true"/> Actualizar
        </Button>
      </header>
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-5">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Estado del activo</span>
          <select aria-label="Filtrar estado del activo"
            value={filters.status ?? 'ALL'}
            onChange={(event) => apply({ ...filters,
              status: event.target.value as AssetCatalogFilters['status'] })}
            className="h-9 min-w-[160px] rounded-md border border-border bg-background px-3 text-foreground">
            <option value="ALL">Todos los activos</option>
            <option value="ACTIVE">Habilitados</option>
            <option value="INACTIVE">Inactivos</option>
          </select>
        </label>
        <form className="min-w-[220px] flex-1 space-y-1" onSubmit={(event) => {
          event.preventDefault()
          const search = query.trim()
          if (search.length === 1) return
          apply({ ...filters, query: search })
        }}>
          <label htmlFor="asset-catalog-search" className="block text-xs text-muted-foreground">
            Código o nombre
          </label>
          <div className="flex gap-2">
            <Input id="asset-catalog-search" type="search" maxLength={100}
              placeholder="Buscar activos…" value={query}
              onChange={(event) => setQuery(event.target.value)} />
            <Button size="sm" variant="outline" type="submit">Buscar</Button>
          </div>
          {query.trim().length === 1 && <p role="status" className="text-xs text-muted-foreground">
            Introduce al menos 2 caracteres
          </p>}
        </form>
      </div>
      {state.status === 'loading' && <p role="status" className="p-10 text-center text-sm text-muted-foreground">
        Consultando activos registrados…
      </p>}
      {state.status === 'error' && <div className="space-y-3 p-10 text-center">
        <p role="alert" className="text-sm text-destructive">{state.message}</p>
        <Button size="sm" variant="outline" onClick={refresh}>Reintentar catálogo</Button>
      </div>}
      {page?.items.length === 0 && <div className="space-y-2 p-10 text-center">
        <Boxes size={24} className="mx-auto text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">No hay activos para estos filtros</p>
        <p className="text-xs text-muted-foreground">No se muestran equipos de otras organizaciones.</p>
        <Button size="sm" variant="outline" onClick={() => {
          setQuery(''); apply({})
        }}>Limpiar filtros</Button>
      </div>}
      {page && page.items.length > 0 && <div className="divide-y divide-border">
        {page.items.map((item) => <button key={item.id} type="button"
          onClick={() => setSelected(item)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
          <span className="min-w-0 space-y-1">
            <span className="block truncate text-[13px] font-semibold">{item.name}</span>
            <span className="block text-[11px] text-muted-foreground">{item.code}</span>
          </span>
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {item.active ? 'Habilitado' : 'Inactivo'}
          </Badge>
        </button>)}
      </div>}
      {page && <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p className="text-[11px] text-muted-foreground">Página {previous.length + 1} · {page.items.length} activos</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!previous.length}
            onClick={() => navigate(previous[previous.length - 1], true)}>
            <ChevronLeft size={14} aria-hidden="true"/> Anterior
          </Button>
          <Button size="sm" variant="outline" disabled={!page.nextCursor}
            onClick={() => navigate(page.nextCursor ?? undefined, false)}>
            Siguiente <ChevronRight size={14} aria-hidden="true" />
          </Button>
        </div>
      </footer>}
    </section>
    {selected && <ApiAssetDetail key={selected.id} client={client}
      organizationId={organization.id} assetId={selected.id}
      onClose={() => setSelected(null)} onOpenIncident={onOpenIncident}
      onOpenOrder={onOpenOrder} />}
  </div>
}
