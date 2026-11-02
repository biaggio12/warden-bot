<?php

namespace App\Scheduler;

use App\Message\ExpireWardenSpawns;
use App\Message\PurgeLoginFailures;
use Symfony\Component\Scheduler\Attribute\AsSchedule;
use Symfony\Component\Scheduler\RecurringMessage;
use Symfony\Component\Scheduler\Schedule;
use Symfony\Component\Scheduler\ScheduleProviderInterface;
use Symfony\Contracts\Cache\CacheInterface;

/**
 * Consumed by `bin/console messenger:consume scheduler_default` (the `worker` container).
 */
#[AsSchedule]
final class WardenTtlSchedule implements ScheduleProviderInterface
{
    public function __construct(private readonly CacheInterface $cache)
    {
    }

    public function getSchedule(): Schedule
    {
        return (new Schedule())
            ->stateful($this->cache)
            ->processOnlyLastMissedRun(true)
            ->add(RecurringMessage::every('60 seconds', new ExpireWardenSpawns()))
            ->add(RecurringMessage::every('1 hour', new PurgeLoginFailures()));
    }
}
