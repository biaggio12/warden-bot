import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A fake amqplib connection with one channel; `deliver` hands it a message. */
function fakeBroker() {
  const channel = Object.assign(new EventEmitter(), {
    assertExchange: vi.fn(),
    assertQueue: vi.fn(),
    bindQueue: vi.fn(),
    prefetch: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    onMessage: null as null | ((message: unknown) => void),
    consume: vi.fn(async (_queue: string, onMessage: (message: unknown) => void) => {
      channel.onMessage = onMessage;
    }),
  });
  const connection = Object.assign(new EventEmitter(), {
    createChannel: vi.fn(async () => channel),
    closed: false,
    // Like amqplib: the channel closes with the connection, a second close is refused.
    close: vi.fn(async () => {
      if (connection.closed) throw new Error('Connection closing');
      connection.closed = true;
      channel.emit('close');
      connection.emit('close');
    }),
  });
  const deliver = (body: unknown, redelivered = false) =>
    channel.onMessage!({ content: Buffer.from(JSON.stringify(body)), fields: { redelivered } });
  return { channel, connection, deliver };
}

const brokers: ReturnType<typeof fakeBroker>[] = [];
vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn(async () => {
      const broker = fakeBroker();
      brokers.push(broker);
      return broker.connection;
    }),
  },
}));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

const { EventConsumer } = await import('../src/consumer.js');

const expired = { event: 'warden.expired', data: { spawn_id: 's1', monster_id: 1, server_name: 'Monza', expires_at: '2026-10-29T12:00:00Z' } };

describe('EventConsumer', () => {
  let consumer: InstanceType<typeof EventConsumer> | null = null;

  beforeEach(() => {
    brokers.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await consumer?.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('acks a handled event', async () => {
    consumer = new EventConsumer('amqp://test', vi.fn().mockResolvedValue(undefined));
    await consumer.start();

    brokers[0]!.deliver(expired);

    await vi.waitFor(() => expect(brokers[0]!.channel.ack).toHaveBeenCalledOnce());
  });

  it('survives an ack after the connection dropped (no unhandled rejection)', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    let finish!: () => void;
    consumer = new EventConsumer('amqp://test', () => new Promise<void>((resolve) => (finish = resolve)));
    await consumer.start();
    const { channel, deliver } = brokers[0]!;
    channel.ack.mockImplementation(() => {
      throw new Error('Channel closed');
    });

    deliver(expired);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));

    process.off('unhandledRejection', unhandled);
    expect(channel.ack).toHaveBeenCalledOnce();
    expect(unhandled).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('will be redelivered'), 'Channel closed');
  });

  it('reconnects when the broker closes only the channel', async () => {
    vi.useFakeTimers();
    consumer = new EventConsumer('amqp://test', vi.fn().mockResolvedValue(undefined));
    await consumer.start();
    expect(consumer.connected).toBe(true);

    brokers[0]!.channel.emit('close');
    await vi.advanceTimersByTimeAsync(0);
    expect(brokers[0]!.connection.close).toHaveBeenCalled();
    expect(consumer.connected).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(brokers).toHaveLength(2);
    expect(consumer.connected).toBe(true);
  });

  it('reconnects when the broker cancels the consumer', async () => {
    vi.useFakeTimers();
    consumer = new EventConsumer('amqp://test', vi.fn().mockResolvedValue(undefined));
    await consumer.start();

    brokers[0]!.channel.onMessage!(null);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(brokers).toHaveLength(2);
    expect(consumer.connected).toBe(true);
  });
});
