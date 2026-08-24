import { readFileSync } from 'node:fs';

export function protectedValue(envName: string, fileEnvName: string): string | undefined {
  const direct = process.env[envName]?.trim();
  if (direct) return direct;

  const file = process.env[fileEnvName]?.trim();
  if (!file) return undefined;
  try {
    return readFileSync(file, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}
