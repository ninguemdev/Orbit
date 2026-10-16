/** What may be logged about an error: its class name, never its message or details. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
