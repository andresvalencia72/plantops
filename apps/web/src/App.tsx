import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export default function App() {
  return (
    <main className="flex min-h-svh flex-col items-start justify-center gap-5 bg-background px-8 text-foreground">
      <Badge variant="outline">PlantOps · entorno de desarrollo</Badge>
      <h1 className="text-3xl font-semibold tracking-tight">Preparando la consola de operaciones</h1>
      <p className="max-w-xl text-sm text-muted-foreground">
        Este es un placeholder técnico de la rama de fundación, no la interfaz v0.4 aprobada.
      </p>
      <Button type="button" disabled>Interfaz en construcción</Button>
    </main>
  )
}
