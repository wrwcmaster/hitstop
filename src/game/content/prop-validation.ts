/** Small, composable validators for the game's open-ended content bags. */
export type ContentProps = Record<string, unknown> | undefined;

export function propsAt(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

export function rejectUnknownProps(
  props: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const known = new Set(allowed);
  for (const key of Object.keys(props)) {
    if (!known.has(key)) throw new Error(`${path}.${key}: unknown property`);
  }
}

export function requireString(props: Record<string, unknown>, key: string, path: string): string {
  const value = props[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path}.${key}: expected a non-empty string`);
  }
  return value;
}

export function optionalString(props: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = props[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path}.${key}: expected a non-empty string`);
  }
  return value;
}

export function optionalFiniteNumber(props: Record<string, unknown>, key: string, path: string): number | undefined {
  const value = props[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path}.${key}: expected a finite number`);
  }
  return value;
}

export function requirePositiveNumber(value: unknown, path: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${path}: expected a positive${integer ? ' integer' : ''} number`);
  }
  return value;
}
