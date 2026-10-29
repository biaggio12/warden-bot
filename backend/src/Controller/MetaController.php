<?php

namespace App\Controller;

use App\Http\Json;
use App\Repository\MonsterRepository;
use App\Service\CityRegistry;
use App\Service\WorldRegistry;
use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/v1')]
final class MetaController extends AbstractController
{
    #[Route('/health', name: 'api_health', methods: ['GET'])]
    public function health(Connection $connection): JsonResponse
    {
        try {
            $connection->executeQuery('SELECT 1');
        } catch (\Throwable) {
            return $this->json(['status' => 'degraded', 'database' => 'down'], 503);
        }

        return $this->json(['status' => 'ok']);
    }

    #[Route('/worlds', name: 'api_worlds', methods: ['GET'])]
    public function worlds(WorldRegistry $worlds): JsonResponse
    {
        return $this->json(['worlds' => $worlds->all()]);
    }

    #[Route('/cities', name: 'api_cities', methods: ['GET'])]
    public function cities(CityRegistry $cities): JsonResponse
    {
        return $this->json(['cities' => $cities->all()]);
    }

    #[Route('/monsters', name: 'api_monsters', methods: ['GET'])]
    public function monsters(MonsterRepository $monsters): JsonResponse
    {
        $response = $this->json(['monsters' => array_map(Json::monster(...), $monsters->findAllOrdered())]);
        $response->setPublic()->setMaxAge(300);

        return $response;
    }
}
