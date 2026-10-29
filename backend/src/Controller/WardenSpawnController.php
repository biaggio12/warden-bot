<?php

namespace App\Controller;

use App\Dto\CreateWardenSpawnRequest;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Http\Json;
use App\Message\WardenSpawnedEvent;
use App\Repository\MonsterRepository;
use App\Repository\WardenSpawnRepository;
use App\Service\CityRegistry;
use App\Service\WorldRegistry;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

#[Route('/api/v1/warden-spawns')]
final class WardenSpawnController extends AbstractController
{
    public function __construct(
        private readonly WardenSpawnRepository $spawns,
        private readonly ClockInterface $clock,
    ) {
    }

    #[Route('', name: 'api_warden_spawns_list', methods: ['GET'])]
    public function list(#[MapQueryParameter('server_name')] ?string $serverName = null): JsonResponse
    {
        return $this->json([
            'warden_spawns' => array_map(Json::wardenSpawn(...), $this->spawns->findActive($serverName, $this->clock->now())),
        ]);
    }

    #[Route('', name: 'api_warden_spawns_create', methods: ['POST'])]
    public function create(
        #[CurrentUser] User $user,
        #[MapRequestPayload] CreateWardenSpawnRequest $payload,
        MonsterRepository $monsters,
        WorldRegistry $worlds,
        CityRegistry $cities,
        EntityManagerInterface $em,
        MessageBusInterface $bus,
    ): JsonResponse {
        $spawn = new WardenSpawn(
            monster: $monsters->find((int) $payload->monsterId),
            serverName: $worlds->canonicalize((string) $payload->serverName),
            locationDescription: (string) $payload->locationDescription,
            reportedBy: $user,
            ttlMinutes: $payload->ttlMinutes,
            createdAt: $this->clock->now(),
            city: null === $payload->city || '' === $payload->city ? null : $cities->canonicalize($payload->city),
            additionalInfo: $payload->additionalInfo,
        );

        $em->persist($spawn);
        $em->flush();

        $bus->dispatch(WardenSpawnedEvent::fromSpawn($spawn));

        return $this->json(Json::wardenSpawn($spawn), 201);
    }
}
