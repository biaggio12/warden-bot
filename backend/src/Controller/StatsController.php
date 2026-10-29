<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\Problem;
use App\Service\StatsService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

final class StatsController extends AbstractController
{
    #[Route('/api/v1/stats', name: 'api_stats', methods: ['GET'])]
    public function stats(#[CurrentUser] User $user, StatsService $stats, #[MapQueryParameter] string $period = '30d'): JsonResponse
    {
        if (!\array_key_exists($period, StatsService::PERIODS)) {
            return Problem::response(400, 'period must be one of: '.implode(', ', array_keys(StatsService::PERIODS)).'.');
        }

        return $this->json($stats->build($period, $user));
    }
}
