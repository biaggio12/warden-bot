<?php

namespace App\EventListener;

use Sentry\Logs\Logs;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\Messenger\Event\WorkerMessageFailedEvent;
use Symfony\Component\Messenger\Event\WorkerMessageHandledEvent;

/**
 * The Sentry bundle sends buffered logs when a request or console command ends. A
 * messenger worker runs for an hour, so without this its logs (e.g. the TTL scheduler)
 * would arrive late or be lost on restart. Flush after every handled message instead.
 */
final class SentryLogsFlushListener
{
    #[AsEventListener(event: WorkerMessageHandledEvent::class, priority: -256)]
    #[AsEventListener(event: WorkerMessageFailedEvent::class, priority: -256)]
    public function __invoke(): void
    {
        Logs::getInstance()->flush();
    }
}
