import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('file:./dev.db'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('glitch-secret-demo-key-12345678901234567890'),
  DEMO_MODE: z.enum(['true', 'false', '1', '0']).default('true').transform(v => v === 'true' || v === '1'),
  LOG_LEVEL: z.string().default('info'),
  SALT_SECRET: z.string().min(16).optional()
});

export type Env = z.infer<typeof envSchema>;
export const config = envSchema.parse(process.env);
