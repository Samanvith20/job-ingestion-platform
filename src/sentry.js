import * as Sentry from '@sentry/node';
import { BACKEND_NODE_ENV, SENTRY_DSN } from './utils/constants.js';

const isProductionLike =
  Boolean(SENTRY_DSN) &&
  ['prod', 'production'].includes(BACKEND_NODE_ENV);

if (isProductionLike) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: BACKEND_NODE_ENV,

    // Keep sampling explicit
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
  });

  Sentry.setTag('service', 'job-scraper');

  process.on('unhandledRejection', (reason) => {
    Sentry.captureException(reason);
  });

  process.on('uncaughtException', (error) => {
    Sentry.captureException(error);
  });
}

export default Sentry;
