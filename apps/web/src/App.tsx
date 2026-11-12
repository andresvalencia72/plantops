import { useState } from 'react'
import { useTheme } from '@/app/use-theme'
import { resolveAppSurface } from '@/app/app-surface'
import type { DemoOrganization, Screen } from '@/app/types'
import { AppShell } from '@/components/layout/app-shell'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { IncidentsPage } from '@/features/incidents/incidents-page'
import { DemoWorkOrdersPage } from '@/features/work-orders/demo-work-orders-page'
import { DemoAssetsPage } from '@/features/assets/demo-assets-page'
import { ApiReadWorkspace } from '@/features/api-read/api-read-workspace'

function DemoApp() {
  const [screen, setScreen] = useState<Screen>('overview')
  const [organization, setOrganization] = useState<DemoOrganization>('atlas')
  const [linkedIncident, setLinkedIncident] = useState<string | null>(null)
  const [linkedOrder, setLinkedOrder] = useState<string | null>(null)
  const { theme, setTheme } = useTheme()

  return (
    <AppShell
      screen={screen}
      onNavigate={(next) => { setScreen(next); setLinkedIncident(null); setLinkedOrder(null) }}
      organization={organization}
      onOrganizationChange={(next) => {
        setOrganization(next); setLinkedIncident(null); setLinkedOrder(null)
      }}
      theme={theme}
      onThemeChange={setTheme}
    >
      {screen === 'overview'
        ? <DashboardPage organization={organization} onViewIncidents={() => setScreen('incidents')} />
        : screen === 'incidents'
          ? <IncidentsPage key={organization + (linkedIncident ?? '')}
              organization={organization} initialIncidentId={linkedIncident} />
          : screen === 'orders'
            ? <DemoWorkOrdersPage key={organization + (linkedOrder ?? '')}
                organization={organization} initialOrderId={linkedOrder} />
            : <DemoAssetsPage key={organization} organization={organization}
                onOpenIncident={(id) => {
                  setLinkedIncident(id); setLinkedOrder(null); setScreen('incidents')
                }}
                onOpenOrder={(id) => {
                  setLinkedOrder(id); setLinkedIncident(null); setScreen('orders')
                }} />}
    </AppShell>
  )
}

// Production defaults to the demo. An authenticated build is an explicit,
// read-only product surface; no query parameter can turn it into demo records.
export default function App() {
  const configured = import.meta.env.VITE_PLANTOPS_APP_SURFACE
  // Build-time constant: Vite can omit the demo bundle in authenticated builds.
  if (import.meta.env.VITE_PLANTOPS_APP_SURFACE === 'authenticated') {
    return <ApiReadWorkspace standalone />
  }
  const surface = resolveAppSurface(configured, import.meta.env.DEV,
    window.location.search)
  return surface === 'authenticated'
    ? <ApiReadWorkspace standalone={configured === 'authenticated'} />
    : <DemoApp />
}
