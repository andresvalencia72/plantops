export const identityPermissions: Readonly<Record<string, string>>;
export const identityColumnUpdates: Readonly<Record<string, readonly string[]>>;
export function identityGrantStatements(role: string): string[];
