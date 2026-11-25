<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\Problem;
use App\Repository\DuelRepository;
use App\Service\StatsService;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/**
 * The player's points (one per confirmed, non-duplicate report), their rank, the top
 * players and their duel record. For the bot's /points.
 */
final class PointsController extends AbstractController
{
    private const TOP = 5;

    #[Route('/api/v1/points', name: 'api_points', methods: ['GET'])]
    public function points(
        #[CurrentUser] User $user,
        StatsService $stats,
        DuelRepository $duels,
        ClockInterface $clock,
        #[MapQueryParameter] string $period = '30d',
    ): JsonResponse {
        if (!\array_key_exists($period, StatsService::PERIODS)) {
            return Problem::response(400, 'period must be one of: '.implode(', ', array_keys(StatsService::PERIODS)).'.');
        }
        $now = $clock->now();
        $days = StatsService::PERIODS[$period];
        $since = null === $days ? new \DateTimeImmutable('1970-01-01 00:00:00') : $now->setTime(0, 0)->modify(\sprintf('-%d days', $days - 1));

        $board = $stats->pointsLeaderboard($since, $now);
        $mine = array_values(array_filter($board, static fn (array $row): bool => $row['user_id'] === $user->getId()))[0] ?? null;

        return $this->json([
            'period' => $period,
            'points' => $mine['points'] ?? 0,
            'rank' => $mine['rank'] ?? null,
            'players' => \count($board),
            'top' => array_map(
                static fn (array $row): array => ['rank' => $row['rank'], 'player' => $row['player'], 'points' => $row['points'], 'is_you' => $row['user_id'] === $user->getId()],
                \array_slice($board, 0, self::TOP),
            ),
            'duels' => $duels->recordOf($user),
        ]);
    }
}
