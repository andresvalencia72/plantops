import { ArrowUpRight, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DemoOrganization } from '@/app/types'
import { demoOrganizations } from '@/app/types'

type DashboardPageProps = { organization: DemoOrganization; onViewIncidents: () => void }

export function DashboardPage({ organization, onViewIncidents }: DashboardPageProps) {
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.16em] text-primary">Centro de operaciones</p>
        <h1 className="text-[28px] font-semibold tracking-[-.045em] sm:text-[32px]">Vista general</h1>
        <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">
          {demoOrganizations[organization]} · Datos de demostración. Los indicadores aparecerán al integrar las fixtures.
        </p>
      </div>
      <section aria-labelledby="activity-title" className="max-w-4xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="activity-title" className="text-sm font-semibold">Actividad operativa</h2>
          <span className="text-xs text-muted-foreground">Próxima iteración</span>
        </div>
        <div className="flex flex-col items-start gap-3 px-5 py-12">
          <ClipboardList size={26} strokeWidth={1.5} className="text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Datos aún no disponibles</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            No se muestran métricas artificiales. La siguiente fase incorporará incidencias y activos ficticios coherentes.
          </p>
          <Button className="mt-1" variant="outline" onClick={onViewIncidents}>
            Ir a incidencias <ArrowUpRight size={15} aria-hidden="true"/>
          </Button>
        </div>
      </section>
    </div>
  )
}
