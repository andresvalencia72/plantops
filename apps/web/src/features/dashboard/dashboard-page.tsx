import { ArrowUpRight, ChevronRight, CircleAlert, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DemoOrganization } from '@/app/types'
import { demoOrganizations } from '@/app/types'
import { PriorityBadge, StatusBadge } from '@/features/incidents/incident-badges'
import { filterIncidents, summarizeIncidents } from '@/features/incidents/selectors'
import { useIncidents } from '@/features/incidents/use-incidents'

type DashboardPageProps = { organization: DemoOrganization; onViewIncidents: () => void }

export function DashboardPage({ organization, onViewIncidents }: DashboardPageProps) {
  const { records, loading, error } = useIncidents(organization)
  const counts = summarizeIncidents(records)
  const latest = filterIncidents(records, { query: '', status: 'ALL', priority: 'ALL' }).slice(0, 4)
  const metrics = [
    { title: 'Total de avisos', value: counts.total, note: 'Registros de demo' },
    { title: 'Incidencias abiertas', value: counts.open, note: 'Pendientes de cierre' },
    { title: 'Prioridad crítica', value: counts.critical, note: 'Abiertas · requieren atención' },
    { title: 'En curso', value: counts.inProgress, note: 'Con intervención iniciada' },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-primary">Centro de operaciones</p>
          <h1 className="text-[28px] font-medium tracking-normal sm:text-[32px]">Vista general</h1>
          <p className="mt-2 text-sm text-muted-foreground">{demoOrganizations[organization]} · Datos ficticios del entorno de prueba.</p>
        </div>
        <Button variant="outline" onClick={onViewIncidents}>Ver incidencias <ArrowUpRight size={15} aria-hidden="true" /></Button>
      </div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : (
        <>
          <section aria-label="Indicadores de incidencias" className="grid grid-cols-2 border border-border bg-card lg:grid-cols-4">
            {metrics.map((metric, i) => (
              <div key={metric.title} className={['min-h-30 px-5 py-5', i % 2 === 1 ? 'border-l border-border' : '', i >= 2 ? 'border-t border-border lg:border-t-0' : '', i === 1 ? 'lg:border-r' : '', i === 2 ? 'lg:border-l-0' : ''].join(' ')}>
                <p className="text-xs font-medium text-muted-foreground">{metric.title}</p>
                <p className="mt-2 text-3xl font-medium tabular-nums">{loading ? '—' : metric.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{metric.note}</p>
              </div>
            ))}
          </section>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(270px,1fr)]">
            <section aria-labelledby="recent-incidents" className="border border-border bg-card">
              <header className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 id="recent-incidents" className="text-sm font-medium">Incidencias recientes</h2>
                <Button variant="ghost" size="sm" onClick={onViewIncidents}>Ver todas <ChevronRight size={15} aria-hidden="true" /></Button>
              </header>
              {loading ? <p role="status" className="p-8 text-xs text-muted-foreground">Cargando registros…</p> :
                latest.length ? <div className="divide-y divide-border">
                  {latest.map((incident) => (
                    <button key={incident.id} onClick={onViewIncidents} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-secondary/40">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{incident.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{incident.id} · {incident.asset.code}</p>
                      </div>
                      <StatusBadge value={incident.status}/>
                    </button>
                  ))}
                </div> : <p className="p-8 text-xs text-muted-foreground">No hay incidencias registradas.</p>
              }
            </section>
            <section aria-labelledby="attention-list" className="border border-border bg-card">
              <header className="border-b border-border px-5 py-4"><h2 id="attention-list" className="text-sm font-medium">Atención prioritaria</h2></header>
              <div className="space-y-5 px-5 py-6">
                <div className="flex items-start gap-3">
                  <CircleAlert size={19} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true"/>
                  <div>
                    <p className="text-sm font-medium">Avisos críticos abiertos</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Cantidad derivada de la lista de incidencias de esta organización.</p>
                    <p className="mt-3 text-2xl font-semibold tabular-nums">{loading ? '—' : counts.critical}</p>
                  </div>
                </div>
                <div className="border-t border-border pt-5">
                  <p className="mb-3 text-xs font-medium text-muted-foreground">Prioridad del último aviso</p>
                  {latest[0] ? <div className="flex items-center gap-2">
                    <PriorityBadge value={latest[0].priority}/>
                    <span className="text-xs text-muted-foreground">{latest[0].id}</span>
                  </div> : <span className="text-xs text-muted-foreground">Sin registros</span>}
                </div>
                <div className="border-t border-border pt-5 text-xs text-muted-foreground">
                  <ClipboardList size={16} className="mb-2"/>
                  Las órdenes de trabajo se incorporarán en el Sprint 2.
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
