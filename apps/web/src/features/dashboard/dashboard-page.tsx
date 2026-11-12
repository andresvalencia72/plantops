import { ArrowUpRight, ChevronRight, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DemoOrganization } from '@/app/types'
import { demoOrganizations } from '@/app/types'
import { PriorityBadge, StatusBadge } from '@/features/incidents/incident-badges'
import { priorityMarker } from '@/features/incidents/priority-marker'
import { filterIncidents, summarizeIncidents } from '@/features/incidents/selectors'
import { useIncidents } from '@/features/incidents/use-incidents'

type DashboardPageProps = { organization: DemoOrganization; onViewIncidents: () => void }

export function DashboardPage({ organization, onViewIncidents }: DashboardPageProps) {
  const { records, loading, error } = useIncidents(organization)
  const counts = summarizeIncidents(records)
  const incidents = filterIncidents(records, { query: '', status: 'ALL', priority: 'ALL' })
  const latest = incidents.slice(0, 5)
  const critical = incidents.find((item) => item.priority === 'CRITICAL' && item.status !== 'CLOSED')
  const metrics = [
    { title: 'Incidencias abiertas', value: counts.open, note: 'Pendientes de cierre' },
    { title: 'Prioridad crítica', value: counts.critical, note: 'Abiertas · requieren atención' },
    { title: 'En curso', value: counts.inProgress, note: 'Con intervención iniciada' },
    { title: 'Total de avisos', value: counts.total, note: 'Registros de demostración' },
  ]

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            Mantenimiento / {demoOrganizations[organization]}
          </p>
          <h1 className="text-[30px] font-medium leading-tight sm:text-[36px]">Vista general</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Registro de incidencias, prioridades y trabajo pendiente
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">Datos ficticios</span>
          <Button variant="outline" onClick={onViewIncidents}>
            Ver incidencias <ArrowUpRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : (
        <>
          <section aria-label="Indicadores de incidencias" className="grid grid-cols-2 gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            {metrics.map((metric, index) => (
              <div key={metric.title} className={[
                'flex min-h-36 flex-col justify-between rounded-xl border p-5',
                index === 0
                  ? 'border-[#2b4943] bg-[#233934] text-[#f2f7f4] dark:border-[#496b5f] dark:bg-[#2c4941]'
                  : 'border-border bg-card text-foreground',
              ].join(' ')}>
                <p className={[
                  'text-xs font-medium',
                  index === 0 ? 'text-[#c8ded4]' : 'text-muted-foreground',
                ].join(' ')}>{metric.title}</p>
                <div>
                  <p className={['tabular-nums font-medium leading-none', index === 0 ? 'text-5xl' : 'text-[34px]'].join(' ')}>
                    {loading ? '—' : metric.value}
                  </p>
                  <p className={[
                    'mt-3 text-xs leading-4',
                    index === 0 ? 'text-[#c8ded4]' : 'text-muted-foreground',
                  ].join(' ')}>{metric.note}</p>
                </div>
              </div>
            ))}
          </section>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(290px,.85fr)]">
            <section aria-labelledby="recent-incidents" className="overflow-hidden rounded-xl border border-border bg-card">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5">
                <div>
                  <h2 id="recent-incidents" className="text-base font-medium">Incidencias recientes</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Bitácora de avisos de esta organización</p>
                </div>
                <Button variant="ghost" size="sm" onClick={onViewIncidents}>
                  Ver todas <ChevronRight size={16} aria-hidden="true" />
                </Button>
              </header>
              {loading ? <p role="status" className="p-8 text-sm text-muted-foreground">Cargando registros…</p> :
                latest.length ? <div className="divide-y divide-border">
                  {latest.map((incident) => (
                    <button key={incident.id} onClick={onViewIncidents}
                      className="grid w-full grid-cols-[4px_minmax(0,1fr)] gap-x-4 gap-y-3 px-5 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[4px_minmax(0,1fr)_auto] sm:items-center">
                      <span aria-hidden="true" className={['h-10 w-1 rounded-full', priorityMarker[incident.priority]].join(' ')} />
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-muted-foreground">{incident.id} · {incident.asset.code}</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{incident.title}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{incident.asset.name}</p>
                      </div>
                      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-1">
                        <PriorityBadge value={incident.priority} />
                        <StatusBadge value={incident.status} />
                      </div>
                    </button>
                  ))}
                </div> : <p className="p-8 text-sm text-muted-foreground">No hay incidencias registradas.</p>
              }
              <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                {loading ? 'Consultando registros…' : `Últimos ${latest.length} de ${counts.total} avisos`} · Datos ficticios
              </footer>
            </section>
            <section aria-labelledby="attention-list" className="overflow-hidden rounded-xl border border-border bg-card">
              <header className="border-b border-border px-5 py-5">
                <h2 id="attention-list" className="text-base font-medium">Atención prioritaria</h2>
                <p className="mt-1 text-xs text-muted-foreground">Avisos críticos sin cerrar</p>
              </header>
              <div className="px-5 py-6">
                {loading ? <p role="status" className="text-sm text-muted-foreground">Consultando prioridades…</p> :
                  critical ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <PriorityBadge value={critical.priority} />
                        <StatusBadge value={critical.status} />
                      </div>
                      <div>
                        <p className="font-mono text-xs text-muted-foreground">{critical.id} / {critical.asset.code}</p>
                        <p className="mt-2 text-lg font-medium leading-snug">{critical.title}</p>
                        <p className="mt-2 text-sm text-muted-foreground">{critical.asset.name}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={onViewIncidents}>
                        Consultar incidencias <ArrowUpRight size={15} aria-hidden="true" />
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No hay avisos críticos abiertos en esta organización.</p>
                  )}
              </div>
              <div className="flex items-start gap-3 border-t border-border bg-muted/30 px-5 py-5">
                <ClipboardList size={17} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="text-xs leading-5 text-muted-foreground">
                  Las órdenes de trabajo se incorporarán en el Sprint 2.
                </p>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
