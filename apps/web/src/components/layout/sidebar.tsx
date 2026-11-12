import type { RefObject } from 'react'
import { Activity, Boxes, ClipboardList, Gauge, Settings2, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { Screen } from '@/app/types'

type SidebarProps = {
  screen: Screen
  onNavigate: (screen: Screen) => void
  mobileOpen: boolean
  onClose: () => void
  menuTriggerRef: RefObject<HTMLButtonElement | null>
}

const available = [
  { id: 'overview' as const, label: 'Vista general', icon: Gauge },
  { id: 'incidents' as const, label: 'Incidencias', icon: ClipboardList },
  { id: 'orders' as const, label: 'Órdenes de trabajo', icon: Wrench },
  { id: 'assets' as const, label: 'Activos', icon: Boxes },
]

function NavigationContent({
  screen, onNavigate, onClose, mobile = false,
}: Pick<SidebarProps, 'screen' | 'onNavigate' | 'onClose'> & { mobile?: boolean }) {
  return (
    <>
      <div className="flex h-18 items-center justify-between border-b border-sidebar-border px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Activity size={18} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-tight">plantops<span className="text-sidebar-primary">.</span></span>
        </div>
        {mobile && (
          <Button aria-label="Cerrar menú" size="icon" variant="ghost" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        )}
      </div>
      <nav aria-label="Navegación principal" className="flex-1 space-y-7 px-3 py-6">
        <section aria-label="Operaciones">
          <p className="px-3 pb-2 text-xs font-medium text-sidebar-foreground/65">Operaciones</p>
          <div className="space-y-1">
            {available.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-current={screen === id ? 'page' : undefined}
                className={[
                  'flex h-10 w-full items-center gap-3 rounded-md border-l-2 px-3 text-left text-sm transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  screen === id
                    ? 'border-sidebar-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'border-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground',
                ].join(' ')}
                onClick={() => { onNavigate(id); onClose() }}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        </section>
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-md px-3 py-3 text-xs text-sidebar-foreground/75">
          <Settings2 size={16} aria-hidden="true" />
          <span>Entorno de demostración</span>
        </div>
        <div className="flex items-center gap-2 px-3 pb-1 text-xs text-sidebar-foreground/65">
          <span className="size-1.5 rounded-full bg-sidebar-foreground/50" />
          Sin conexión a producción
        </div>
      </div>
    </>
  )
}

export function Sidebar({ screen, onNavigate, mobileOpen, onClose, menuTriggerRef }: SidebarProps) {
  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <NavigationContent screen={screen} onNavigate={onNavigate} onClose={onClose} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={(open) => { if (!open) onClose() }}>
        <SheetContent
          side="left"
          showCloseButton={false}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            menuTriggerRef.current?.focus()
          }}
          className="w-60 max-w-60 gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground md:hidden"
        >
          <SheetTitle className="sr-only">Navegación móvil</SheetTitle>
          <NavigationContent screen={screen} onNavigate={onNavigate} onClose={onClose} mobile />
        </SheetContent>
      </Sheet>
    </>
  )
}
