import { config } from '@glitch/config';
import { buildApp } from './app';

buildApp()
  .then(app => app.listen({ port: config.PORT, host: process.env.HOST ?? '127.0.0.1' }))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
