import * as Sentry from '@sentry/react';

/**
 * Sentry for the web app: render crashes, uncaught errors and API 5xx become Issues;
 * console.warn/error go to Sentry Logs. No-op while VITE_SENTRY_DSN is empty.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE,
    initialScope: { tags: { component: 'frontend' } },
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })],
  });
}
