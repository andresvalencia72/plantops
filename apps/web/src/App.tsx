import { useState } from 'react'
import { useTheme } from '@/app/use-theme'
import type { DemoOrganization, Screen } from '@/app/types'
import { AppShell } from '@/components/layout/app-shell'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { IncidentsPage } from '@/features/incidents/incidents-page'
import { ApiReadWorkspace } from '@/features/api-read/api-read-workspace'

function DemoApp() {
  const [screen, setScreen] = useState<Screen>('overview')
  const [organization, setOrganization] = useState<DemoOrganization>('atlas')
  const { theme, setTheme } = useTheme()

  return (
    <AppShell
      screen={screen}
      onNavigate={setScreen}
      organization={organization}
      onOrganizationChange={setOrganization}
      theme={theme}
      onThemeChange={setTheme}
    >
      {screen === 'overview'
        ? <DashboardPage organization={organization} onViewIncidents={() => setScreen('incidents')} />
        : <IncidentsPage key={organization} organization={organization} />}
    </AppShell>
  )
}

// Never enable this preview in production. Demo and API trees never share records.
export default function App() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('source') === 'api'
    ? <ApiReadWorkspace />
    : <DemoApp />
}
