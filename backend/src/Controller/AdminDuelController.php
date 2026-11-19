<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\Problem;
use App\Security\AdminPolicy;
use App\Service\DuelAudit;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
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

    #[Route('', name: 'api_admin_duels', methods: ['GET'])]
    public function list(#[CurrentUser] User $user): JsonResponse
    {
        if (!$this->admins->isStaff($user)) {
            return Problem::response(403, 'Admins and moderators only.');
        }

        return $this->json($this->audit->overview());
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
