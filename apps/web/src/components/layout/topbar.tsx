import type { RefObject } from 'react'
import { Database, Menu, Moon, Sun, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { demoOrganizations } from '@/app/types'
import type { ColorTheme, DemoOrganization, Screen } from '@/app/types'

type TopbarProps = {
  screen: Screen
  organization: DemoOrganization
  onOrganizationChange: (organization: DemoOrganization) => void
  theme: ColorTheme
  onThemeChange: (theme: ColorTheme) => void
  onMenuOpen: () => void
  menuTriggerRef: RefObject<HTMLButtonElement | null>
}

export function Topbar({
  screen, organization, onOrganizationChange, theme, onThemeChange, onMenuOpen, menuTriggerRef,
}: TopbarProps) {
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-2 sm:px-7">
      <div className="flex items-center gap-3">
        <Button ref={menuTriggerRef} aria-label="Abrir menú" className="md:hidden" size="icon" variant="ghost" onClick={onMenuOpen}>
          <Menu size={19} />
        </Button>
        <span className="text-[13px] font-medium text-muted-foreground">Operaciones</span>
        <span aria-hidden="true" className="text-border">/</span>
        <span className="text-[13px] font-semibold">{screen === 'overview' ? 'Vista general' : 'Incidencias'}</span>
      </div>
      <div className="flex items-center gap-2">
        {import.meta.env.DEV && (
          <a href="/?source=api"
            className="hidden h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:inline-flex">
            <Database size={14} aria-hidden="true" /> Vista API
          </a>
        )}
        <label className="sr-only" htmlFor="organization-select">Organización de demostración</label>
        <select
          id="organization-select"
          className="h-9 max-w-[155px] rounded-md border border-border bg-background px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring sm:max-w-[220px]"
          value={organization}
          onChange={(event) => onOrganizationChange(event.target.value as DemoOrganization)}
        >
          {Object.entries(demoOrganizations).map(([id, label]) => (
            <option key={id} value={id}>{label} · Demo</option>
          ))}
        </select>
        <Button
          aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
          aria-pressed={theme === 'dark'}
          size="icon"
          variant="outline"
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17}/>}
        </Button>
        <div className="hidden h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground sm:flex" aria-label="Perfil de demostración">
          <UserRound size={16} aria-hidden="true"/>
        </div>
      </div>
    </header>
  )
}
