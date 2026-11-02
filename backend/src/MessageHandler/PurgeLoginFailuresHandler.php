<?php

namespace App\MessageHandler;

use App\Message\PurgeLoginFailures;
use App\Service\LoginThrottle;
use Psr\Clock\ClockInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler]
final readonly class PurgeLoginFailuresHandler
{
    public function __construct(private LoginThrottle $throttle, private ClockInterface $clock)
    {
    }

    public function __invoke(PurgeLoginFailures $message): int
    {
        return $this->throttle->purge($this->clock->now()->modify('-1 day'));
    }
}
