import { ClipboardList } from 'lucide-react'

export function IncidentsPage() {
  return (
    <div className="space-y-7">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.16em] text-primary">Gestión de mantenimiento</p>
        <h1 className="text-[28px] font-semibold tracking-[-.045em] sm:text-[32px]">Incidencias</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">Registro y seguimiento de incidencias por activo.</p>
      </div>
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 border border-dashed border-border bg-card px-5 text-center">
        <ClipboardList size={28} className="text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Próximamente: listado de incidencias</h2>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">
          En esta rama solo se ha construido el App Shell. Los registros, filtros e inspector llegarán en el siguiente corte.
        </p>
      </div>
    </div>
  )
}
