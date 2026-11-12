import { useMemo, useState } from 'react'
import { ArrowUpRight, Wrench } from 'lucide-react'
import type { DemoOrganization } from '@/app/types'
import { demoOrganizations } from '@/app/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader,
  SheetTitle } from '@/components/ui/sheet'
import { assets, incidents } from '@/features/incidents/fixtures'
import { demoOrders, type DemoOrder, type DemoOrderStatus } from './demo-orders'

const labels: Record<DemoOrderStatus, string> = {
  PENDING: 'Pendiente', ASSIGNED: 'Asignada', IN_PROGRESS: 'En ejecución',
  COMPLETED: 'Completada', CANCELLED: 'Cancelada',
}

/** Read-only fictional preview; real orders live in the authenticated workspace. */
export function DemoWorkOrdersPage({ organization }: { organization: DemoOrganization }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<DemoOrderStatus | 'ALL'>('ALL')
  const [assetId, setAssetId] = useState('')
  const [selected, setSelected] = useState<DemoOrder | null>(null)
  const scopedAssets = assets.filter((item) => item.organization === organization)
  const visible = useMemo(() => demoOrders.filter((order) => {
    if (order.organization !== organization || (status !== 'ALL' && order.status !== status)) {
      return false
    }
    if (assetId && order.assetId !== assetId) return false
    const asset = assets.find((item) => item.id === order.assetId)
    return [order.id, order.title, asset?.code, order.responsible]
      .some((value) => (value ?? '').toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es').trim()))
  }), [organization, query, status, assetId])
  const selectedAsset = selected && assets.find((item) => item.id === selected.assetId)
  const parent = selected && incidents.find((item) => item.id === selected.incidentId)
  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.16em] text-primary">
          Gestión de mantenimiento
        </p>
        <h1 className="text-[28px] font-semibold tracking-[-.045em] sm:text-[32px]">
          Órdenes de trabajo</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {demoOrganizations[organization]} · Órdenes correctivas de demostración.
        </p>
      </div>
      <span className="text-[11px] text-muted-foreground">Datos ficticios · Solo lectura</span>
    </div>
    <section aria-label="Listado de órdenes de trabajo" className="border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-4 sm:px-5">
        <Input aria-label="Buscar órdenes" type="search" className="h-9 min-w-44 flex-1 text-xs"
          placeholder="Título, código o responsable" value={query}
          onChange={(event) => setQuery(event.target.value)} />
        <label htmlFor="demo-order-status" className="sr-only">Estado de orden</label>
        <select id="demo-order-status" value={status}
          className="h-9 rounded-md border border-border bg-background px-3 text-xs"
          onChange={(event) => setStatus(event.target.value as DemoOrderStatus | 'ALL')}>
          <option value="ALL">Todos los estados</option>
          {Object.entries(labels).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor="demo-order-asset" className="sr-only">Activo de orden</label>
        <select id="demo-order-asset" value={assetId}
          className="h-9 rounded-md border border-border bg-background px-3 text-xs"
          onChange={(event) => setAssetId(event.target.value)}>
          <option value="">Todos los activos</option>
          {scopedAssets.map((item) => <option key={item.id} value={item.id}>
            {item.code} · {item.name}</option>)}
        </select>
      </div>
      {visible.length === 0 ? <div className="space-y-2 p-10 text-center">
        <Wrench size={24} className="mx-auto text-muted-foreground" aria-hidden="true"/>
        <p className="text-sm font-medium">No hay órdenes para estos filtros</p>
        <Button size="sm" variant="outline" onClick={() => {
          setQuery(''); setStatus('ALL'); setAssetId('')
        }}>Limpiar filtros</Button>
      </div> : <div className="divide-y divide-border">
        {visible.map((order) => {
          const asset = assets.find((item) => item.id === order.assetId)
          return <button key={order.id} type="button" onClick={() => setSelected(order)}
            className="flex w-full flex-wrap items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-[13px] font-semibold">{order.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {order.id} · {asset?.code ?? 'Activo desconocido'}</p>
              <p className="text-[11px] text-muted-foreground">
                Responsable: {order.responsible ?? 'Sin asignar'}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline">{labels[order.status]}</Badge>
              <ArrowUpRight size={15} className="text-muted-foreground" aria-hidden="true" />
            </div>
          </button>
        })}
      </div>}
      <footer className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
        {visible.length} órdenes de demostración · Sin conexión a producción
      </footer>
    </section>
    <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null) }}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
        <SheetHeader className="border-b border-border px-6 py-6">
          <SheetTitle>{selected?.title ?? 'Orden de trabajo'}</SheetTitle>
          <SheetDescription>Ficha e historial ficticios de demostración</SheetDescription>
        </SheetHeader>
        {selected && <div className="space-y-6 px-6 py-5">
          <p className="text-sm leading-6">{selected.description}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-xs">
            <dt className="text-muted-foreground">Estado</dt><dd>{labels[selected.status]}</dd>
            <dt className="text-muted-foreground">Activo</dt>
            <dd>{selectedAsset?.code} · {selectedAsset?.name}</dd>
            <dt className="text-muted-foreground">Incidencia</dt>
            <dd>{parent?.id} · {parent?.title}</dd>
            <dt className="text-muted-foreground">Responsable</dt>
            <dd>{selected.responsible ?? 'Sin asignar'}</dd>
          </dl>
          <section aria-label="Historial de orden" className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Historial de intervención</h3>
            <ol className="space-y-3">
              {selected.history.map((event, idx) => <li key={idx}
                className="border-l-2 border-border pl-3 text-xs">
                <p className="font-semibold">{event.action}</p>
                <p className="mt-1 text-muted-foreground">{event.detail}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
                    .format(new Date(event.at))}</p>
              </li>)}
            </ol>
          </section>
        </div>}
      </SheetContent>
    </Sheet>
  </div>
}
