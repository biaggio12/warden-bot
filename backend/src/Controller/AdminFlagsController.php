<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\DateWindow;
use App\Http\Problem;
use App\Security\AdminPolicy;
use App\Service\DeadClickAudit;
use App\Service\DuelAudit;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/**
 * The flagged pairs of the last 30 days, for the summary at the top of the Players tab:
 * Dead clicks (DeadClickAudit) and duels (DuelAudit). Flagged reporters come with the
 * players list itself.
 */
final class AdminFlagsController extends AbstractController
{
    public const DAYS = 30;

    #[Route('/api/v1/admin/flags', name: 'api_admin_flags', methods: ['GET'])]
    public function summary(#[CurrentUser] User $user, AdminPolicy $admins, DeadClickAudit $deadClicks, DuelAudit $duels, ClockInterface $clock): JsonResponse
    {
        if (!$admins->isStaff($user)) {
            return Problem::response(403, 'Admins and moderators only.');
        }
        $until = $clock->now()->modify('+1 second');
        $from = $until->modify(\sprintf('-%d days', self::DAYS));
        $window = DateWindow::parse($from->format(\DATE_ATOM), $until->format(\DATE_ATOM));
        \assert($window instanceof DateWindow);
        $flagged = static fn (array $pairs): int => \count(array_filter($pairs, static fn (array $pair): bool => [] !== $pair['flags']));

        return $this->json([
            'days' => self::DAYS,
            'dead_click_pairs' => $flagged($deadClicks->pairs($window)),
            'duel_pairs' => $flagged($duels->overview($from, $until)['pairs']),
        ]);
    }
}
