import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// The CLI (migrate / seed / studio) uses the direct Supabase connection.
// The running app uses the pooled DATABASE_URL (see src/prisma/prisma.service.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
