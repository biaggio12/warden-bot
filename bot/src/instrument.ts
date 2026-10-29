import * as Sentry from '@sentry/node';

/**
 * Sentry for the bot: uncaught errors become Issues, console.* output goes to Sentry Logs.
 * Imported first in index.ts. No-op while SENTRY_DSN is empty.
 */
const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || 'dev',
    initialScope: { tags: { component: 'bot' } },
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['log', 'info', 'warn', 'error'] })],
  });
}

export const sentryEnabled = Boolean(dsn);
