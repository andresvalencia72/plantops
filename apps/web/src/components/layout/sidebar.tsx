import { Activity, Boxes, ClipboardList, Gauge, Settings2, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Screen } from '@/app/types'

type SidebarProps = {
  screen: Screen
  onNavigate: (screen: Screen) => void
  mobileOpen: boolean
  onClose: () => void
}

const available = [
  { id: 'overview' as const, label: 'Vista general', icon: Gauge },
  { id: 'incidents' as const, label: 'Incidencias', icon: ClipboardList },
]

const upcoming = [
  { label: 'Activos', icon: Boxes },
  { label: 'Órdenes de trabajo', icon: Wrench },
]

export function Sidebar({ screen, onNavigate, mobileOpen, onClose }: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button aria-label="Cerrar navegación" className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} />
      )}
      <aside className={[
        'fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        'transition-transform duration-200 md:static md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}>
        <div className="flex h-18 items-center justify-between border-b border-sidebar-border px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity size={18} strokeWidth={2.2} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">plantops<span className="text-primary">.</span></span>
          </div>
          <Button aria-label="Cerrar menú" className="md:hidden" size="icon" variant="ghost" onClick={onClose}><X size={18}/></Button>
        </div>
        <nav aria-label="Navegación principal" className="flex-1 space-y-6 px-3 py-6">
          <section aria-label="Operaciones">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Operaciones</p>
            <div className="space-y-1">
              {available.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  aria-current={screen === id ? 'page' : undefined}
                  className={[
                    'flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    screen === id ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/75',
                  ].join(' ')}
                  onClick={() => { onNavigate(id); onClose() }}
                >
                  <Icon size={17} strokeWidth={1.7} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          </section>
          <section aria-label="Próximamente">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Próximamente</p>
            {upcoming.map(({ label, icon: Icon }) => (
              <div key={label} className="flex h-10 items-center gap-3 px-3 text-[13px] text-muted-foreground/70">
                <Icon size={17} strokeWidth={1.7} aria-hidden="true"/>{label}
              </div>
            ))}
          </section>
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-md px-3 py-3 text-xs text-muted-foreground">
            <Settings2 size={16} aria-hidden="true" />
            <span>Entorno de demostración</span>
          </div>
          <div className="flex items-center gap-2 px-3 pb-1 text-[11px] text-muted-foreground/75">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Sin conexión a producción
          </div>
        </div>
      </aside>
    </>
  )
}
