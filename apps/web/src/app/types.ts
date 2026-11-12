export type Screen = 'overview' | 'incidents' | 'orders' | 'assets'
export type DemoOrganization = 'atlas' | 'north'
export type ColorTheme = 'light' | 'dark'

export const demoOrganizations: Record<DemoOrganization, string> = {
  atlas: 'Atlas Manufacturing',
  north: 'Northline Industries',
}
