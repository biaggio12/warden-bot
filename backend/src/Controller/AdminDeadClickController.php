<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\DateWindow;
use App\Http\Problem;
use App\Security\AdminPolicy;
use App\Service\DeadClickAudit;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/** Admins and moderators: who closes whose reports with [Dead] (see DeadClickAudit). */
#[Route('/api/v1/admin/dead-clicks')]
final class AdminDeadClickController extends AbstractController
{
    private const MAX_DAYS = 366;
    private const DEFAULT_DAYS = 30;

    public function __construct(
        private readonly AdminPolicy $admins,
        private readonly DeadClickAudit $audit,
        private readonly ClockInterface $clock,
    ) {
    }

    /** `from` / `until`: date-times (default: the last 30 days); `user_id`: pairs with that player on either side. */
    #[Route('', name: 'api_admin_dead_clicks', methods: ['GET'])]
    public function list(
        #[CurrentUser] User $user,
        #[MapQueryParameter] ?string $from = null,
        #[MapQueryParameter] ?string $until = null,
        #[MapQueryParameter('user_id')] ?int $userId = null,
    ): JsonResponse {
        if (!$this->admins->isStaff($user)) {
            return Problem::response(403, 'Admins and moderators only.');
        }
        $now = $this->clock->now();
        $window = DateWindow::parse(
            $from ?: $now->modify(\sprintf('-%d days', self::DEFAULT_DAYS))->format(\DATE_ATOM),
            $until ?: $now->modify('+1 second')->format(\DATE_ATOM),
            self::MAX_DAYS,
        );
        if ($window instanceof JsonResponse) {
            return $window;
        }

        return $this->json([
            'from' => $window->from?->format(\DATE_ATOM),
            'until' => $window->until?->format(\DATE_ATOM),
            'pairs' => $this->audit->pairs($window, $userId),
        ]);
    }
}
