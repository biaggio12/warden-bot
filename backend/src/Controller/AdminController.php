<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\Problem;
use App\Security\AdminPolicy;
use App\Service\UserDirectory;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

#[Route('/api/v1/admin')]
final class AdminController extends AbstractController
{
    public function __construct(private readonly AdminPolicy $admins)
    {
    }

    #[Route('/users', name: 'api_admin_users', methods: ['GET'])]
    public function users(#[CurrentUser] User $user, UserDirectory $directory): JsonResponse
    {
        if (!$this->admins->isAdmin($user)) {
            return Problem::response(403, 'Admins only.');
        }

        return $this->json(['users' => $directory->all()]);
    }
}
