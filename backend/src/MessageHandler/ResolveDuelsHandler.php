<?php

namespace App\MessageHandler;

use App\Entity\Duel;
use App\Enum\DuelStatus;
use App\Message\DuelExpiredEvent;
use App\Message\DuelFinishedEvent;
use App\Message\ResolveDuels;
use App\Repository\DuelRepository;
use App\Service\DuelView;
use App\Service\PlayerNames;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\MessageBusInterface;

#[AsMessageHandler]
final readonly class ResolveDuelsHandler
{
    public function __construct(
        private DuelRepository $duels,
        private DuelView $view,
        private EntityManagerInterface $em,
        private MessageBusInterface $bus,
        private ClockInterface $clock,
        private LoggerInterface $logger,
        private PlayerNames $names,
    ) {
    }

    /**
     * @return array{expired: int, finished: int}
     */
    public function __invoke(ResolveDuels $message): array
    {
        $now = $this->clock->now();
        $expired = 0;
        $finished = 0;

        foreach ($this->duels->findPendingPastDeadline($now) as $duel) {
            // Under a lock: the opponent may be clicking [Accept] right now.
            $done = $this->em->wrapInTransaction(function () use ($duel, $now): bool {
                $this->em->lock($duel, LockMode::PESSIMISTIC_WRITE);
                $this->em->refresh($duel);
                if ($duel->canBeAcceptedAt($now) || DuelStatus::Pending !== $duel->getStatus()) {
                    return false;
                }
                $duel->expire();

                return true;
            });
            if ($done) {
                ++$expired;
                $this->bus->dispatch(DuelExpiredEvent::fromDuel($duel));
            }
        }

        foreach ($this->duels->findReadyToScore($now) as $duel) {
            $done = $this->em->wrapInTransaction(function () use ($duel): bool {
                $this->em->lock($duel, LockMode::PESSIMISTIC_WRITE);
                $this->em->refresh($duel);
                if (DuelStatus::Active !== $duel->getStatus()) {
                    return false;
                }
                [$challengerScore, $opponentScore] = $this->view->count($duel);
                $duel->finish($challengerScore, $opponentScore);

                return true;
            });
            if ($done) {
                ++$finished;
                $this->bus->dispatch(DuelFinishedEvent::fromDuel($duel, $this->names->of([(int) $duel->getChallenger()->getId(), (int) $duel->getOpponent()->getId()])));
                $this->logger->info('Duel {id} finished {a}:{b}.', [
                    'id' => $duel->getId()->toRfc4122(),
                    'a' => $duel->getChallengerScore(),
                    'b' => $duel->getOpponentScore(),
                ]);
            }
        }

        return ['expired' => $expired, 'finished' => $finished];
    }
}
