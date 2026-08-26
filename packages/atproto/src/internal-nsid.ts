export const nsidPattern = /^[a-z][a-z0-9]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/;

export function assertNsid(value: string, label: string): void {
  if (!nsidPattern.test(value)) {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
}
