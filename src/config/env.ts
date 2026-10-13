/**
 * Environment variable validation & secret redaction utilities.
 *
 * Startup validation fails fast with a descriptive error when a required
 * variable is missing or empty, instead of surfacing later as cryptic
 * "API credentials missing" failures inside the exchange clients.
 */

/** Variables that must be present and non-empty for real-exchange / webhook operation. */
export const REQUIRED_ENV_VARS: readonly string[] = [
  'EXCHANGE_API_KEY',
  'EXCHANGE_API_SECRET',
  'WEBHOOK_SECRET',
];

function readEnvValue(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Returns the trimmed value of an environment variable, throwing a
 * descriptive error when it is missing or empty.
 */
export function requireEnvVar(name: string): string {
  const value = readEnvValue(name);
  if (!value) {
    throw new Error(
      `Required environment variable "${name}" is missing or empty. ` +
      `Set "${name}" to a non-empty value before starting the application.`
    );
  }
  return value;
}

/**
 * Validates that every required environment variable is present and non-empty.
 * Throws a single descriptive error listing all missing variables.
 */
export function validateRequiredEnv(vars: readonly string[] = REQUIRED_ENV_VARS): void {
  const missing = vars.filter((name) => !readEnvValue(name));
  if (missing.length > 0) {
    throw new Error(
      `Missing or empty required environment variable(s): ${missing.join(', ')}. ` +
      'Set each variable to a non-empty value before starting the application.'
    );
  }
}

/**
 * Redacts secret-like values (apiKey, apiSecret, private_key, password and
 * known secret environment values) so they can never be written to logs.
 */
export function redactSecrets(text: string): string {
  if (typeof text !== 'string') return text;
  let redacted = text.replace(
    /\b(apiKey|apiSecret|private_key|password)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;"')}]+)/gi,
    (_match: string, key: string, sep: string) => `${key}${sep}***`
  );
  const knownSecrets = [
    ...REQUIRED_ENV_VARS,
    'GEMINI_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'FIREBASE_CREDENTIALS_JSON',
    'SQL_ADMIN_PASSWORD',
    'SQL_PASSWORD',
  ];
  for (const name of knownSecrets) {
    const value = readEnvValue(name);
    if (value.length >= 8) {
      redacted = redacted.split(value).join('***');
    }
  }
  return redacted;
}
