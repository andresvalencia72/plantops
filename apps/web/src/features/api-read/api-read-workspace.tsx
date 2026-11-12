import { useEffect, useState } from 'react'
import { Activity, ArrowLeft, LockKeyhole, LogOut, Moon, RefreshCw, Sun } from 'lucide-react'
import { useTheme } from '@/app/use-theme'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApiRequestError, apiReadClient } from './api-client'
import type { ApiReadClient, ApiProfile, ApiOrganization, ApiLoginProvider } from './api-client'
import { ApiIncidentsPanel } from './api-incidents-panel'
import { ApiOrganizationOrdersPanel } from './api-organization-orders-panel'
import { ApiAssetsPanel } from './api-assets-panel'

type Connection =
  | { status: 'loading' }
  | { status: 'unauthenticated'; providers: ApiLoginProvider[] }
  | { status: 'error'; message: string }
  | { status: 'ready'; profile: ApiProfile; organizations: ApiOrganization[] }

export function ApiReadWorkspace({ client = apiReadClient, standalone = false }: {
  client?: ApiReadClient; standalone?: boolean
}) {
  // Explicit local opt-in only: never expose writes in production or the pilot preview.
  const isolatedWrites = import.meta.env.DEV && !standalone &&
    import.meta.env.VITE_PLANTOPS_ENABLE_REPORTS === 'isolated-test'
  const loginRedirect = standalone ? '%2F' : '%2F%3Fsource%3Dapi'
  const { theme, setTheme } = useTheme()
  const [attempt, setAttempt] = useState(0)
  const [connection, setConnection] = useState<Connection>({ status: 'loading' })
  const [organizationId, setOrganizationId] = useState('')
  const [tab, setTab] = useState<'incidents' | 'orders' | 'assets'>('incidents')
  const [linkedIncident, setLinkedIncident] = useState<string | null>(null)
  const [linkedOrder, setLinkedOrder] = useState<{ id: string; incidentId: string } | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function connect() {
      try {
        const profile = await client.profile(controller.signal)
        const organizations = await client.organizations(controller.signal)
        if (controller.signal.aborted) return
        setOrganizationId(organizations[0]?.id ?? '')
        setTab('incidents')
        setLinkedIncident(null)
        setLinkedOrder(null)
        setConnection({ status: 'ready', profile, organizations })
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof ApiRequestError && error.status === 401) {
          try {
            const providers = await client.providers(controller.signal)
            if (!controller.signal.aborted) {
              setConnection({ status: 'unauthenticated', providers })
            }
          } catch {
            if (!controller.signal.aborted) {
              setConnection({ status: 'error',
                message: 'No se pudo comprobar la configuración del login.' })
            }
          }
        } else {
          setConnection({ status: 'error', message: error instanceof Error
            ? error.message : 'No se pudo conectar con la API.' })
        }
      }
    }
    void connect()
    return () => controller.abort()
  }, [client, attempt])

  function retryConnection() {
    setConnection({ status: 'loading' })
    setOrganizationId('')
    setTab('incidents')
    setLinkedIncident(null)
    setLinkedOrder(null)
    setAttempt((n) => n + 1)
  }

  // This fixed query marker contains no email, provider tokens or OAuth state.
  // It is informational only and never grants access.
  const accessDenied = new URLSearchParams(window.location.search)
    .get('auth') === 'access-denied'

  async function logout() {
    if (signingOut) return
    setSigningOut(true)
    setLogoutError('')
    try {
      await client.logout()
      setConnection({ status: 'loading' })
      setOrganizationId('')
      setTab('incidents')
      setLinkedIncident(null)
      setLinkedOrder(null)
      setAttempt((n) => n + 1)
    } catch {
      // If the request failed, leave the authenticated view intact.
      setLogoutError('No se pudo cerrar la sesión. Revisa la conexión e inténtalo de nuevo.')
    } finally {
      setSigningOut(false)
    }
  }

  const organization = connection.status === 'ready'
    ? connection.organizations.find((item) => item.id === organizationId)
    : undefined

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a href="#api-main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-primary focus:p-3 focus:text-primary-foreground">
        Saltar al contenido
      </a>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-18 max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity size={18} aria-hidden="true"/>
            </span>
            <span className="text-[15px] font-semibold tracking-tight">plantops<span className="text-primary">.</span></span>
            <span className="hidden h-5 w-px bg-border sm:inline" aria-hidden="true" />
            <Badge variant="outline" className="text-[10px]">{isolatedWrites ? 'API local · Laboratorio aislado' : standalone ? 'Entorno autenticado · Solo lectura' : 'API local · Solo lectura'}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {!standalone && <a href="/" className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <ArrowLeft size={14} aria-hidden="true" /> Volver a la demo
            </a>}
            <Button variant="outline" size="icon" aria-label={theme === 'dark'
              ? 'Activar modo claro' : 'Activar modo oscuro'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
            </Button>
          </div>
        </div>
      </header>
      <main id="api-main" className="mx-auto max-w-[1280px] space-y-7 px-4 py-9 sm:px-8">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.17em] text-primary">Integración HTTP · En desarrollo</p>
          <h1 className="text-[29px] font-semibold tracking-[-.045em] sm:text-[36px]">Centro de operaciones</h1>
          <p className="mt-2 max-w-[620px] text-[13px] leading-6 text-muted-foreground">
            Datos consultados directamente en la API de PlantOps. No se mezclan registros ficticios
            y {isolatedWrites ? 'las escrituras solo se habilitan para pruebas aisladas.' :
              'no se permiten altas o modificaciones desde esta vista.'}
          </p>
        </div>
        {connection.status === 'loading' && (
          <div role="status" className="border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Comprobando sesión de la API…
          </div>
        )}
        {connection.status === 'unauthenticated' && (
          <section className="mx-auto max-w-[600px] space-y-5 border border-border bg-card px-7 py-10 sm:px-10">
            <span className="flex size-11 items-center justify-center rounded-md bg-secondary text-primary">
              <LockKeyhole size={21} aria-hidden="true" />
            </span>
            <h2 className="text-[20px] font-semibold">
              {accessDenied ? 'Acceso pendiente de invitación' : 'Se requiere una sesión válida'}
            </h2>
            <p role="alert" className="text-sm leading-6 text-muted-foreground">
              {accessDenied
                ? 'No podemos habilitar esta cuenta en PlantOps. Solicita al responsable de tu organización una invitación vigente para el correo verificado con el que iniciaste sesión.'
                : 'La API respondió 401. Solo podrás ver organizaciones e incidencias cuando un proveedor autorizado haya verificado tu identidad.'}
            </p>
            {connection.providers.includes('google') && (
              <Button asChild className="w-full sm:w-auto">
                <a href={'/auth/oidc/google/login?redirectTo=' + loginRedirect}>
                  Continuar con Google
                </a>
              </Button>
            )}
            {connection.providers.includes('microsoft') && (
              <Button asChild className="w-full sm:w-auto">
                <a href={'/auth/oidc/microsoft/login?redirectTo=' + loginRedirect}>
                  Continuar con Microsoft
                </a>
              </Button>
            )}
            {connection.providers.length === 0 && (
              <p className="text-xs leading-5 text-muted-foreground">
                No hay proveedores de acceso configurados todavía en esta API.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={retryConnection}>
                <RefreshCw size={15} aria-hidden="true"/> Comprobar de nuevo
              </Button>
              {!standalone && <Button variant="secondary" asChild><a href="/">Usar la demo</a></Button>}
            </div>
          </section>
        )}
        {connection.status === 'error' && (
          <section className="space-y-4 border border-border bg-card p-8">
            <p role="alert" className="text-sm text-destructive">{connection.message}</p>
            <Button variant="outline" onClick={retryConnection}>
              <RefreshCw size={15} aria-hidden="true" /> Reintentar conexión
            </Button>
          </section>
        )}
        {connection.status === 'ready' && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
              <div>
                <p className="text-[12px] text-muted-foreground">Sesión verificada por el servidor</p>
                <p className="mt-1 text-[14px] font-semibold">{connection.profile.displayName}</p>
              </div>
              {connection.organizations.length > 0 && (
                <div className="space-y-2">
                  <label htmlFor="api-organization" className="block text-xs text-muted-foreground">
                    Organización autorizada
                  </label>
                  <select id="api-organization" className="h-10 min-w-[220px] rounded-md border border-border bg-card px-3 text-sm"
                    value={organizationId} onChange={(event) => {
                      setOrganizationId(event.target.value)
                      setTab('incidents')
                      setLinkedIncident(null)
                      setLinkedOrder(null)
                    }}>
                    {connection.organizations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <Button variant="outline" size="sm" disabled={signingOut} onClick={() => { void logout() }}>
                <LogOut size={14} aria-hidden="true" />
                {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
              </Button>
            </div>
            {logoutError && (
              <p role="alert" className="text-sm text-destructive">{logoutError}</p>
            )}
            {organization ? <>
              <nav aria-label="Secciones del centro de operaciones"
                className="flex flex-wrap gap-2 border-b border-border pb-4">
                <Button size="sm" variant={tab === 'incidents' ? 'secondary' : 'ghost'}
                  aria-current={tab === 'incidents' ? 'page' : undefined}
                  onClick={() => { setTab('incidents'); setLinkedIncident(null); setLinkedOrder(null) }}>
                  Incidencias
                </Button>
                <Button size="sm" variant={tab === 'orders' ? 'secondary' : 'ghost'}
                  aria-current={tab === 'orders' ? 'page' : undefined}
                  onClick={() => { setTab('orders'); setLinkedIncident(null); setLinkedOrder(null) }}>
                  Órdenes de trabajo
                </Button>
                <Button size="sm" variant={tab === 'assets' ? 'secondary' : 'ghost'}
                  aria-current={tab === 'assets' ? 'page' : undefined}
                  onClick={() => { setTab('assets'); setLinkedIncident(null); setLinkedOrder(null) }}>
                  Activos
                </Button>
              </nav>
              {tab === 'incidents'
                ? <ApiIncidentsPanel key={organization.id + ':incidents:' + (linkedIncident ?? '')}
                    organization={organization} client={client} userId={connection.profile.id}
                    allowWrites={isolatedWrites} initialIncidentId={linkedIncident}/>
                : tab === 'orders' ? <ApiOrganizationOrdersPanel
                    key={organization.id + ':orders:' + (linkedOrder?.id ?? '')}
                    organization={organization} client={client} userId={connection.profile.id}
                    allowWrites={isolatedWrites} initialOrder={linkedOrder}
                    onOpenIncident={(incidentId) => {
                      setLinkedIncident(incidentId); setLinkedOrder(null); setTab('incidents')
                    }}/>
                  : <ApiAssetsPanel key={organization.id + ':assets'}
                      organization={organization} client={client}
                      onOpenIncident={(incidentId) => {
                        setLinkedIncident(incidentId); setLinkedOrder(null); setTab('incidents')
                      }}
                      onOpenOrder={(order) => {
                        setLinkedOrder(order); setLinkedIncident(null); setTab('orders')
                      }}/>
              }
            </> : <p className="border border-border bg-card p-8 text-sm text-muted-foreground">
              No tienes ninguna organización activa. El servidor no ha autorizado datos.
            </p>}
          </>
        )}
      </main>
    </div>
  )
}
