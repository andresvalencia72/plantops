import type { DemoOrganization } from '@/app/types'

export type DemoOrderStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type DemoOrder = Readonly<{
  id: string; organization: DemoOrganization; incidentId: string; assetId: string
  title: string; description: string; status: DemoOrderStatus
  responsible: string | null; createdAt: string
  history: readonly Readonly<{ at: string; action: string; detail: string }>[]
}>

// Only for the explicitly fictional demo tree; NEVER used by the API client.
export const demoOrders: readonly DemoOrder[] = [
  {
    id: 'OT-DEMO-021', organization: 'atlas', incidentId: 'INC-1040',
    assetId: 'a-103', title: 'Ajustar rodillos y alineación de banda',
    description: 'Inspección de rodillos guía, ajuste de tensión y verificación de banda.',
    status: 'IN_PROGRESS', responsible: 'Pablo Martín', createdAt: '2026-11-09T14:00:00Z',
    history: [
      { at: '2026-11-09T14:00:00Z', action: 'Creación', detail: 'Orden correctiva abierta' },
      { at: '2026-11-09T15:15:00Z', action: 'Asignación', detail: 'Responsable: Pablo Martín' },
      { at: '2026-11-10T08:30:00Z', action: 'Inicio', detail: 'Inspección en curso' },
    ],
  },
  {
    id: 'OT-DEMO-020', organization: 'atlas', incidentId: 'INC-1039',
    assetId: 'a-104', title: 'Sustituir junta de circuito hidráulico',
    description: 'Comprobar pérdida de aceite y sustituir la junta afectada.',
    status: 'ASSIGNED', responsible: 'Elena Santos', createdAt: '2026-11-09T10:05:00Z',
    history: [
      { at: '2026-11-09T10:05:00Z', action: 'Creación', detail: 'Orden correctiva abierta' },
      { at: '2026-11-09T11:00:00Z', action: 'Asignación', detail: 'Responsable: Elena Santos' },
    ],
  },
  {
    id: 'OT-DEMO-019', organization: 'atlas', incidentId: 'INC-1038',
    assetId: 'a-101', title: 'Revisar alimentación del panel CNC',
    description: 'Comprobar conectores y alimentación eléctrica del controlador.',
    status: 'COMPLETED', responsible: 'Pablo Martín', createdAt: '2026-11-07T18:00:00Z',
    history: [
      { at: '2026-11-07T18:00:00Z', action: 'Creación', detail: 'Orden correctiva abierta' },
      { at: '2026-11-08T08:00:00Z', action: 'Asignación', detail: 'Responsable: Pablo Martín' },
      { at: '2026-11-08T09:00:00Z', action: 'Inicio', detail: 'Comprobación eléctrica' },
      { at: '2026-11-08T10:20:00Z', action: 'Finalización',
        detail: 'Conector reajustado y panel verificado' },
    ],
  },
  {
    id: 'OT-DEMO-088', organization: 'north', incidentId: 'INC-2090',
    assetId: 'n-202', title: 'Inspección de retorno térmico',
    description: 'Verificar válvula de retorno y presión de la caldera auxiliar.',
    status: 'PENDING', responsible: null, createdAt: '2026-11-09T16:00:00Z',
    history: [{ at: '2026-11-09T16:00:00Z', action: 'Creación', detail: 'Pendiente de asignación' }],
  },
]
