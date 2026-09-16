import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SCHEMA: z.string().default('app'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3000/api/auth/google/callback'),
  GOOGLE_ALLOWED_DOMAIN: z.string().default(''),
  GOOGLE_DRIVE_REDIRECT_URI: z.string().default('http://localhost:3000/api/integrations/google-drive/callback'),
  GOOGLE_CALENDAR_REDIRECT_URI: z.string().default('http://localhost:3000/api/integrations/google-calendar/callback'),

  SESSION_COOKIE_NAME: z.string().default('teamos_session'),
  SESSION_TTL_HOURS: z.coerce.number().default(168),
  MFA_ENCRYPTION_KEY: z.string().default(''),
  AUTH_DEV_LOGIN: bool,
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example`);
  }
  // Without the same key, the live server could not read the saved authenticator and Google tokens.
  if (parsed.data.NODE_ENV === 'production' && parsed.data.MFA_ENCRYPTION_KEY.length < 32) {
    throw new Error('MFA_ENCRYPTION_KEY must be set in production — copy the exact value from BACKEND/.env');
  }
  return parsed.data;
}

export const env = load();

export const isProduction = env.NODE_ENV === 'production';
/** Dev email login is never available in production, whatever the flag says. */
export const devLoginEnabled = env.AUTH_DEV_LOGIN && !isProduction;
export const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
