import * as Sentry from '@sentry/node';
import amqp, { type ChannelModel } from 'amqplib';
import { InvalidEventError, parseEvent, type WardenEvent } from './events.js';

/** Must match config/packages/messenger.yaml in the backend. */
export const EXCHANGE = 'warden_events';
export const QUEUE = 'discord_bot';

const RECONNECT_DELAY_MS = 5_000;

/**
 * Consumes integration events from RabbitMQ and reconnects forever on failure.
 * A message whose handler throws is requeued once, then dropped, so a poison
 * message cannot block the queue.
 */
export class EventConsumer {
  private connection: ChannelModel | null = null;
  private stopped = false;
  connected = false;

  constructor(
    private readonly url: string,
    private readonly handler: (event: WardenEvent) => Promise<void>,
  ) {}

  async start(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connect();
        return;
      } catch (error) {
        console.error(`[amqp] Connection failed (${(error as Error).message}), retrying in ${RECONNECT_DELAY_MS / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.connection?.close().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const connection = await amqp.connect(this.url);
    const channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE, 'fanout', { durable: true });
    await channel.assertQueue(QUEUE, { durable: true });
    await channel.bindQueue(QUEUE, EXCHANGE, '');
    await channel.prefetch(5);

    connection.on('error', (error: Error) => console.error('[amqp] Connection error:', error.message));
    connection.on('close', () => {
      this.connected = false;
      this.connection = null;
      if (!this.stopped) {
        console.warn('[amqp] Connection closed, reconnecting');
        setTimeout(() => void this.start(), RECONNECT_DELAY_MS);
      }
    });

    await channel.consume(QUEUE, (message) => {
      if (!message) {
        return;
      }
      let event: WardenEvent;
      try {
        event = parseEvent(message.content.toString('utf8'));
      } catch (error) {
        console.error('[amqp] Dropping malformed event:', error instanceof InvalidEventError ? error.message : error);
        channel.nack(message, false, false);
        return;
      }

      this.handler(event).then(
        () => channel.ack(message),
        (error: unknown) => {
          const requeue = !message.fields.redelivered;
          console.error(`[amqp] Handling ${event.event} failed (${requeue ? 'requeued' : 'dropped'}):`, error);
          Sentry.captureException(error, { tags: { event: event.event, requeued: String(requeue) } });
          channel.nack(message, false, requeue);
        },
      );
    });

    this.connection = connection;
    this.connected = true;
    console.info(`[amqp] Consuming "${QUEUE}" bound to exchange "${EXCHANGE}"`);
  }
}
