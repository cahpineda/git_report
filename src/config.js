/**
 * Minimal .env loader — no npm dependencies.
 * Reads .env from the project root and injects values into process.env.
 * Silently skips if .env file does not exist.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envPath = resolve(__dirname, '..', '.env');

try {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    // Only set if not already defined in the environment
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env not found — rely on environment variables already set
}

/**
 * Validated config object. Throws with a clear message if required vars are missing.
 */
function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required config: ${key} (set it in .env or environment)`);
  return value;
}

export const config = {
  githubToken: required('GITHUB_TOKEN'),
  githubOrg:   process.env.GITHUB_ORG   || 'inkaviation',
  sinceDate:   process.env.SINCE_DATE   || '2026-04-06',
  untilDate:   process.env.UNTIL_DATE   || '2026-04-12',
};
