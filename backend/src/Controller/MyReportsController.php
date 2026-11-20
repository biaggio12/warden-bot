<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\Problem;
use App\Service\ReportScoring;
use App\Service\StatsService;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/**
 * The player's own reports in a Stats period, each with the points it earned and why
 * (see ReportScoring::explain), so the points are no black box.
 */
final class MyReportsController extends AbstractController
{
    /** Reports listed; the totals count every report of the period. */
    public const SHOWN = 50;
    /** Reports looked at for the totals. */
    private const MAX = 2000;

    #[Route('/api/v1/me/reports', name: 'api_me_reports', methods: ['GET'])]
    public function list(
        #[CurrentUser] User $user,
        ReportScoring $scoring,
        ClockInterface $clock,
        #[MapQueryParameter] string $period = '30d',
    ): JsonResponse {
        if (!\array_key_exists($period, StatsService::PERIODS)) {
            return Problem::response(400, 'period must be one of: '.implode(', ', array_keys(StatsService::PERIODS)).'.');
        }
        $now = $clock->now();
        $days = StatsService::PERIODS[$period];
        // The same days as the Stats tab and the points leaderboard.
        $since = null === $days ? new \DateTimeImmutable('1970-01-01 00:00:00') : $now->setTime(0, 0)->modify(\sprintf('-%d days', $days - 1));

        $reports = $scoring->explain((int) $user->getId(), $since, $now->modify('+1 second'), $now, self::MAX);
        $outcomes = ['counted' => 0, 'waiting' => 0, 'unconfirmed' => 0, 'duplicate' => 0];
        foreach ($reports as $report) {
            ++$outcomes[$report['outcome']];
        }

        return $this->json([
            'period' => $period,
            'points' => array_sum(array_column($reports, 'points')),
            'outcomes' => $outcomes,
            'reports' => \array_slice($reports, 0, self::SHOWN),
            'total' => \count($reports),
        ]);
    }
}
