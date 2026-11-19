import { CalendarDays, MapPin, UserRound, Wrench } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PriorityBadge, StatusBadge } from './incident-badges'
import type { IncidentView } from './types'

interface IncidentInspectorProps {
  incident: IncidentView | null
  onClose: () => void
}

function humanDate(date: string) {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(date))
}

export function IncidentInspector({ incident, onClose }: IncidentInspectorProps) {
  return (
    <Sheet open={Boolean(incident)} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
        {incident && (
          <>
            <SheetHeader className="border-b border-border px-6 py-8 pr-12">
              <p className="mb-1 font-mono text-[11px] tracking-wide text-muted-foreground">{incident.id}</p>
              <SheetTitle className="text-xl font-semibold tracking-tight">{incident.title}</SheetTitle>
              <SheetDescription className="mt-2">Incidencia registrada · Datos de demostración</SheetDescription>
              <div className="mt-4 flex flex-wrap gap-2">
                <PriorityBadge value={incident.priority}/>
                <StatusBadge value={incident.status}/>
              </div>
            </SheetHeader>
            <div className="space-y-7 px-6 py-8">
              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Descripción del aviso</h3>
                <p className="text-[13px] leading-6">{incident.description}</p>
              </section>
              <section className="border-t border-border pt-6">
                <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Activo afectado</h3>
                <div className="flex items-start gap-3">
                  <Wrench size={18} className="mt-0.5 text-primary" aria-hidden="true"/>
                  <div>
                    <p className="text-sm font-medium">{incident.asset.name}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{incident.asset.code}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <MapPin size={15} aria-hidden="true" />{incident.asset.location}
                </div>
              </section>
              <section className="space-y-3 border-t border-border pt-6">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registro</h3>
                <p className="flex items-center gap-3 text-xs"><UserRound size={15} className="text-muted-foreground"/>{incident.reportedBy}</p>
                <p className="flex items-center gap-3 text-xs"><CalendarDays size={15} className="text-muted-foreground"/>{humanDate(incident.reportedAt)}</p>
              </section>
              <p className="border-l-2 border-primary/60 pl-3 text-xs leading-5 text-muted-foreground">
                Esta vista es de solo lectura. Las órdenes y acciones del supervisor llegarán después del primer corte.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
