import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ColorTheme, DemoOrganization, Screen } from '@/app/types'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

type AppShellProps = {
  screen: Screen
  onNavigate: (next: Screen) => void
  organization: DemoOrganization
  onOrganizationChange: (next: DemoOrganization) => void
  theme: ColorTheme
  onThemeChange: (next: ColorTheme) => void
  children: ReactNode
}

export function AppShell({
  screen, onNavigate, organization, onOrganizationChange, theme, onThemeChange, children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-primary focus:p-3 focus:text-primary-foreground">
        Saltar al contenido
      </a>
      <Sidebar screen={screen} onNavigate={onNavigate} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          screen={screen}
          organization={organization}
          onOrganizationChange={onOrganizationChange}
          theme={theme}
          onThemeChange={onThemeChange}
          onMenuOpen={() => setMobileOpen(true)}
        />
        <main id="main-content" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-7 sm:px-7 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  )
}
