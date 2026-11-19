import type { AssetSummary, IncidentRecord } from './types'

// Deliberately fictional demonstration data. Never use names or identifiers of real clients.
export const assets: AssetSummary[] = [
  { id: 'a-101', organization: 'atlas', code: 'CNC-004', name: 'Fresadora CNC', location: 'Nave A · Línea 2' },
  { id: 'a-102', organization: 'atlas', code: 'CMP-018', name: 'Compresor principal', location: 'Nave B · Servicios' },
  { id: 'a-103', organization: 'atlas', code: 'CVY-012', name: 'Cinta transportadora', location: 'Nave A · Línea 1' },
  { id: 'a-104', organization: 'atlas', code: 'PMP-006', name: 'Bomba hidráulica', location: 'Nave C · Sala técnica' },
  { id: 'n-201', organization: 'north', code: 'PRS-008', name: 'Prensa hidráulica', location: 'Planta Norte · Zona 1' },
  { id: 'n-202', organization: 'north', code: 'BLR-002', name: 'Caldera auxiliar', location: 'Planta Norte · Zona 3' },
]

export const incidents: IncidentRecord[] = [
  {
    id: 'INC-1042', organization: 'atlas', assetId: 'a-102',
    title: 'Presión inestable en circuito auxiliar',
    description: 'El manómetro oscila fuera del rango habitual durante el turno de mañana.',
    status: 'REPORTED', priority: 'CRITICAL', reportedAt: '2026-11-10T08:40:00Z',
    reportedBy: 'María Romero',
  },
  {
    id: 'INC-1041', organization: 'atlas', assetId: 'a-101',
    title: 'Vibración anómala en el cabezal',
    description: 'Se aprecia vibración intermitente al ejecutar ciclos de mecanizado.',
    status: 'UNDER_REVIEW', priority: 'HIGH', reportedAt: '2026-11-10T07:15:00Z',
    reportedBy: 'Carlos Pérez',
  },
  {
    id: 'INC-1040', organization: 'atlas', assetId: 'a-103',
    title: 'Desalineación de banda en rodillos',
    description: 'La banda se desvía hacia el lateral derecho en funcionamiento continuo.',
    status: 'IN_PROGRESS', priority: 'MEDIUM', reportedAt: '2026-11-09T13:05:00Z',
    reportedBy: 'Lucía Torres',
  },
  {
    id: 'INC-1039', organization: 'atlas', assetId: 'a-104',
    title: 'Pérdida de aceite en junta',
    description: 'Aparecen gotas de aceite bajo la unidad hidráulica después del ciclo.',
    status: 'IN_PROGRESS', priority: 'HIGH', reportedAt: '2026-11-09T09:25:00Z',
    reportedBy: 'María Romero',
  },
  {
    id: 'INC-1038', organization: 'atlas', assetId: 'a-101',
    title: 'Reinicio inesperado del panel de mando',
    description: 'El panel de control reinició sin intervención durante la noche.',
    status: 'CLOSED', priority: 'LOW', reportedAt: '2026-11-07T17:30:00Z',
    reportedBy: 'Carlos Pérez',
  },
  {
    id: 'INC-1037', organization: 'atlas', assetId: 'a-102',
    title: 'Ruido irregular de válvula de descarga',
    description: 'Se escucha un golpeteo al final de la fase de compresión.',
    status: 'REPORTED', priority: 'MEDIUM', reportedAt: '2026-11-07T12:15:00Z',
    reportedBy: 'Lucía Torres',
  },
  {
    id: 'INC-2091', organization: 'north', assetId: 'n-201',
    title: 'Velocidad de descenso irregular',
    description: 'El cilindro tarda más de lo habitual en completar el recorrido.',
    status: 'UNDER_REVIEW', priority: 'HIGH', reportedAt: '2026-11-10T09:12:00Z',
    reportedBy: 'Elena Ruiz',
  },
  {
    id: 'INC-2090', organization: 'north', assetId: 'n-202',
    title: 'Oscilación de temperatura en retorno',
    description: 'Se registran picos de temperatura en el circuito de retorno.',
    status: 'IN_PROGRESS', priority: 'CRITICAL', reportedAt: '2026-11-09T15:45:00Z',
    reportedBy: 'Jorge Mora',
  },
]
