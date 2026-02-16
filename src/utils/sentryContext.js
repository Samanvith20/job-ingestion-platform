import * as Sentry from '@sentry/node';

export function setScraperContext(source) {
  Sentry.setTag('source', source);
}
