import { useMemo, useState } from 'react'
import { ArrowUpRight, Boxes, Search } from 'lucide-react'
import type { DemoOrganization } from '@/app/types'
import { demoOrganizations } from '@/app/types'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription,
  SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { assets } from '@/features/incidents/fixtures'
import { useIncidents } from '@/features/incidents/use-incidents'
import { demoOrders } from '@/features/work-orders/demo-orders'

/** Functional fictional inventory preview: no HTTP and no real tenant data. */
export function DemoAssetsPage({ organization, onOpenIncident, onOpenOrder }: {
  organization: DemoOrganization
  onOpenIncident: (id: string) => void
  onOpenOrder: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { records, loading, error, refresh } = useIncidents(organization)
  const scoped = useMemo(() => assets.filter((asset) =>
    asset.organization === organization &&
    [asset.name, asset.code, asset.location].some((text) =>
      text.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))),
  [organization, query])
  const selected = assets.find((item) =>
    item.id === selectedId && item.organization === organization)
  const related = records.filter((record) => record.assetId === selectedId)
  const orders = demoOrders.filter((order) => order.organization === organization &&
    order.assetId === selectedId)

  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.16em] text-primary">
          Gestión de mantenimiento</p>
        <h1 className="text-[28px] font-semibold tracking-[-.045em] sm:text-[32px]">Activos</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Catálogo de equipos de {demoOrganizations[organization]}.
        </p>
      </div>
      <span className="text-[11px] text-muted-foreground">Datos ficticios · Solo lectura</span>
    </div>
    <section aria-label="Catálogo de activos de demostración" className="border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5">
        <div>
          <h2 className="text-[14px] font-semibold">Equipos registrados</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Consulta de fichas e historial simulado del mantenimiento
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>Actualizar</Button>
      </header>
      <div className="relative border-b border-border px-5 py-4">
        <Search size={15} className="absolute left-8 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true"/>
        <Input type="search" aria-label="Buscar activos de demostración"
          placeholder="Buscar por código, nombre o ubicación…" value={query}
          className="max-w-[420px] pl-9 text-xs"
          onChange={(event) => setQuery(event.target.value)}/>
      </div>
      {scoped.length === 0 && <div className="space-y-2 p-10 text-center">
        <Boxes size={24} className="mx-auto text-muted-foreground" aria-hidden="true"/>
        <p className="text-sm">No hay equipos para esta búsqueda</p>
        <Button size="sm" variant="outline" onClick={() => setQuery('')}>
          Limpiar búsqueda</Button>
      </div>}
      {scoped.length > 0 && <div className="divide-y divide-border">
        {scoped.map((asset) => <button key={asset.id} type="button"
          onClick={() => setSelectedId(asset.id)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
          <span className="min-w-0 space-y-1">
            <span className="block truncate text-[13px] font-semibold">{asset.name}</span>
            <span className="block text-[11px] text-muted-foreground">
              {asset.code} · {asset.location}</span>
          </span>
          <ArrowUpRight size={16} className="text-muted-foreground" aria-hidden="true" />
        </button>)}
      </div>}
      <footer className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
        {scoped.length} equipos de demostración · No conectados al servidor
      </footer>
    </section>
    <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null) }}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
        <SheetHeader className="border-b border-border px-6 py-6">
          <SheetTitle>Ficha del activo</SheetTitle>
          <SheetDescription>Equipo ficticio · Información de demostración</SheetDescription>
        </SheetHeader>
        {selected && <div className="space-y-6 px-6 py-5">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">{selected.name}</h3>
            <Badge variant="outline">{selected.code}</Badge>
            <p className="text-xs text-muted-foreground">Ubicación: {selected.location}</p>
          </div>
          <section aria-label="Incidencias relacionadas del activo" className="space-y-3 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">Incidencias relacionadas</h4>
            {loading && <p role="status" className="text-xs">Consultando incidencias ficticias…</p>}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            {!loading && !error && related.length === 0 && <p className="text-xs text-muted-foreground">
              Sin incidencias registradas en la demo.</p>}
            {related.map((record) => <button key={record.id} type="button"
              onClick={() => onOpenIncident(record.id)}
              className="block w-full border-l-2 border-border py-1 pl-3 text-left hover:text-primary">
              <span className="block text-xs font-medium">{record.title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {record.id} · {record.status}</span>
            </button>)}
          </section>
          <section aria-label="Órdenes relacionadas del activo" className="space-y-3 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">Órdenes relacionadas</h4>
            {orders.length === 0 && <p className="text-xs text-muted-foreground">
              Sin órdenes correctivas registradas en la demo.</p>}
            {orders.map((order) => <button key={order.id} type="button"
              onClick={() => onOpenOrder(order.id)}
              className="block w-full border-l-2 border-border py-1 pl-3 text-left hover:text-primary">
              <span className="block text-xs font-medium">{order.title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {order.id} · {order.status}</span>
            </button>)}
          </section>
        </div>}
      </SheetContent>
    </Sheet>
  </div>
}
