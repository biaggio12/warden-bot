<?php

namespace App\Controller;

use App\Dto\AttachDuelMessageRequest;
use App\Dto\CreateDuelRequest;
use App\Entity\Duel;
use App\Entity\User;
use App\Http\Problem;
use App\Repository\DuelRepository;
use App\Repository\UserRepository;
use App\Service\DuelView;
use App\Service\ReportScoring;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/**
 * Duels: a player challenges another to report more Wardens in the next N minutes; only
 * reports that earn points count (see ReportScoring). A player is in one duel at a time.
 */
final class DuelController extends AbstractController
{
    public function __construct(
        private readonly DuelRepository $duels,
        private readonly DuelView $view,
        private readonly EntityManagerInterface $em,
        private readonly ClockInterface $clock,
        private readonly LoggerInterface $logger,
        private readonly ReportScoring $scoring,
    ) {
    }

    /** The player's open duel (if any), recent ones and their record. */
    #[Route('/api/v1/duels', name: 'api_duels_list', methods: ['GET'])]
    public function list(#[CurrentUser] User $user): JsonResponse
    {
        $current = $this->duels->findOpenOf($user, $this->clock->now());

        return $this->json([
            'current' => null === $current ? null : $this->view->of($current, $user),
            'recent' => array_map(fn (Duel $duel): array => $this->view->of($duel, $user), $this->duels->recentOf($user)),
            'record' => $this->duels->recordOf($user),
        ]);
    }

    #[Route('/api/v1/duels', name: 'api_duels_create', methods: ['POST'])]
    public function create(
        #[CurrentUser] User $user,
        #[MapRequestPayload] CreateDuelRequest $payload,
        UserRepository $users,
    ): JsonResponse {
        $opponent = $users->findOneByDiscordUserId((string) $payload->opponentDiscordUserId);
        if (null === $opponent || $opponent->isBlocked()) {
            return Problem::response(404, 'This player has no linked Warden Tracker account.', ['code' => 'opponent_not_linked']);
        }
        if ($opponent->getId() === $user->getId()) {
            return Problem::response(422, 'You cannot challenge yourself.', ['code' => 'duel_self']);
        }

        $result = $this->em->wrapInTransaction(function () use ($user, $opponent, $payload): JsonResponse|Duel {
            // Lock both players (always in the same order), so two challenges sent at once
            // cannot both get through the "one duel at a time" check.
            foreach ($user->getId() < $opponent->getId() ? [$user, $opponent] : [$opponent, $user] as $player) {
                $this->em->lock($player, LockMode::PESSIMISTIC_WRITE);
            }
            $now = $this->clock->now();
            if (null !== $this->duels->findOpenOf($user, $now)) {
                return Problem::response(409, 'You are already in a duel (or waiting for an answer to one).', ['code' => 'duel_busy']);
            }
            if (null !== $this->duels->findOpenOf($opponent, $now)) {
                return Problem::response(409, 'This player is already in a duel.', ['code' => 'opponent_busy']);
            }
            if ($payload->stake > 0) {
                $mine = $this->scoring->balanceOf((int) $user->getId(), $now);
                if ($payload->stake > $mine) {
                    return Problem::response(422, \sprintf('You have only %d point(s) to put at stake.', max(0, $mine)), ['code' => 'stake_too_high']);
                }
                $theirs = $this->scoring->balanceOf((int) $opponent->getId(), $now);
                if ($payload->stake > $theirs) {
                    return Problem::response(422, \sprintf('This player has only %d point(s) to put at stake.', max(0, $theirs)), ['code' => 'opponent_stake_too_high']);
                }
            }
            $duel = new Duel($user, $opponent, (int) $payload->minutes, $now, $payload->discordChannelId, $payload->stake);
            $this->em->persist($duel);

            return $duel;
        });
        if ($result instanceof JsonResponse) {
            return $result;
        }

        $this->logger->info('{a} challenged {b} to a {minutes} min duel for {stake} point(s).', [
            'stake' => $result->getStake(),
            'a' => $user->getDisplayName(),
            'b' => $opponent->getDisplayName(),
            'minutes' => $result->getDurationMinutes(),
        ]);

        return $this->json($this->view->of($result, $user), 201);
    }

    #[Route('/api/v1/duels/{id}', name: 'api_duels_show', methods: ['GET'])]
    public function show(string $id, #[CurrentUser] User $user): JsonResponse
    {
        return $this->json($this->view->of($this->find($id), $user));
    }

    /** The opponent takes the challenge: the clock starts now. */
    #[Route('/api/v1/duels/{id}/accept', name: 'api_duels_accept', methods: ['POST'])]
    public function accept(string $id, #[CurrentUser] User $user): JsonResponse
    {
        $duel = $this->find($id);
        if (!$duel->isOpponent($user)) {
            return Problem::response(403, 'Only the challenged player can accept this duel.');
        }

        $result = $this->em->wrapInTransaction(function () use ($duel, $user): ?JsonResponse {
            $this->em->lock($duel, LockMode::PESSIMISTIC_WRITE);
            $this->em->refresh($duel);
            $now = $this->clock->now();
            if (!$duel->canBeAcceptedAt($now)) {
                return Problem::response(409, 'This challenge can no longer be accepted.', ['code' => 'duel_closed']);
            }
            // Points may have changed since the challenge (another duel ended): check again.
            foreach ([$duel->getChallenger(), $user] as $player) {
                $balance = $this->scoring->balanceOf((int) $player->getId(), $now);
                if ($duel->getStake() > $balance) {
                    return Problem::response(422, \sprintf(
                        '%s only %d point(s) now, less than the %d at stake.',
                        $player === $user ? 'You have' : 'The challenger has',
                        max(0, $balance),
                        $duel->getStake(),
                    ), ['code' => 'stake_too_high']);
                }
            }
            $duel->accept($now);

            return null;
        });

        return $result ?? $this->json($this->view->of($duel, $user));
    }

    /** The opponent says no, or the challenger takes the challenge back (before it is accepted). */
    #[Route('/api/v1/duels/{id}/decline', name: 'api_duels_decline', methods: ['POST'])]
    public function decline(string $id, #[CurrentUser] User $user): JsonResponse
    {
        $duel = $this->find($id);
        if (!$duel->involves($user)) {
            return Problem::response(403, 'This duel is not yours.');
        }

        $result = $this->em->wrapInTransaction(function () use ($duel): ?JsonResponse {
            $this->em->lock($duel, LockMode::PESSIMISTIC_WRITE);
            $this->em->refresh($duel);
            if (!$duel->canBeAcceptedAt($this->clock->now())) {
                return Problem::response(409, 'This challenge is no longer waiting for an answer.', ['code' => 'duel_closed']);
            }
            $duel->decline();

            return null;
        });

        return $result ?? $this->json($this->view->of($duel, $user));
    }

    /** The bot's message that shows the challenge; the result updates it. */
    #[Route('/api/v1/internal/duels/{id}/message', name: 'api_internal_duel_message', methods: ['PUT'])]
    public function attachMessage(string $id, #[MapRequestPayload] AttachDuelMessageRequest $payload): JsonResponse
    {
        $duel = $this->find($id);
        $duel->attachDiscordMessage((string) $payload->channelId, (string) $payload->messageId);
        $this->em->flush();

        return $this->json($this->view->of($duel));
    }

    private function find(string $id): Duel
    {
        return $this->duels->findByIdString($id) ?? throw $this->createNotFoundException('Duel not found.');
    }
}
