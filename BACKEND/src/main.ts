import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { devLoginEnabled, env, googleConfigured } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.FRONTEND_URL, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT);

  const log = new Logger('Bootstrap');
  log.log(`TEAM OS API listening on http://localhost:${env.PORT}`);
  if (!googleConfigured()) log.warn('Google OAuth is not configured — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET');
  if (devLoginEnabled) log.warn('Development email login is ENABLED (AUTH_DEV_LOGIN=true)');
}

await bootstrap();
