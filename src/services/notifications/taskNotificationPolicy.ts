export function suppressTaskNotification(data: Record<string, unknown>, environment: string, scope: string) {
  return data.environment !== environment || data.scope !== scope;
}
