<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\DateWindow;
use App\Http\Problem;
use App\Security\AdminPolicy;
use App\Service\DuelAudit;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;
use Symfony\Component\Uid\Uuid;

/**
 * Admins and moderators: who challenged whom, the pairs that keep meeting, and for one duel
 * which reports counted and who confirmed them, to spot points being farmed.
 */
#[Route('/api/v1/admin/duels')]
final class AdminDuelController extends AbstractController
{
    public function __construct(
        private readonly AdminPolicy $admins,
        private readonly DuelAudit $audit,
    ) {
    }

    /** Longest window that can be asked for at once. */
    private const MAX_DAYS = 366;

    /**
     * `from` and `until` are date-times (ISO 8601, the website sends the viewer's local
     * midnights); `user_id` keeps only that player's duels.
     */
    #[Route('', name: 'api_admin_duels', methods: ['GET'])]
    public function list(
        #[CurrentUser] User $user,
        #[MapQueryParameter] ?string $from = null,
        #[MapQueryParameter] ?string $until = null,
        #[MapQueryParameter('user_id')] ?int $userId = null,
    ): JsonResponse {
        if (!$this->admins->isStaff($user)) {
            return Problem::response(403, 'Admins and moderators only.');
        }
        $window = DateWindow::parse($from, $until, self::MAX_DAYS);
        if ($window instanceof JsonResponse) {
            return $window;
        }

        return $this->json($this->audit->overview($window->from, $window->until, $userId));
    }

    #[Route('/{id}', name: 'api_admin_duel_details', methods: ['GET'])]
    public function details(string $id, #[CurrentUser] User $user): JsonResponse
    {
        if (!$this->admins->isStaff($user)) {
            return Problem::response(403, 'Admins and moderators only.');
        }
        $details = Uuid::isValid($id) ? $this->audit->details($id) : null;

        return null === $details ? throw $this->createNotFoundException('Duel not found.') : $this->json($details);
    }
}
