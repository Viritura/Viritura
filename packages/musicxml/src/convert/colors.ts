export function normalizeMusicXmlColor(value: string | null): string | undefined {
  if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) return undefined;
  return value.toLowerCase();
}
