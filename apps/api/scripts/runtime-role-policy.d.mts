export const runtimePermissions: Readonly<Record<string, string>>;
export const runtimeLockColumns: Readonly<Record<string, string>>;
export function runtimeGrantStatements(role: string): string[];
