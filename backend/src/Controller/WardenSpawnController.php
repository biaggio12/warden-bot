<?php

namespace App\Controller;

use App\Dto\CreateWardenSpawnRequest;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Http\Json;
use App\Http\Problem;
use App\Message\WardenKilledEvent;
use App\Message\WardenSpawnedEvent;
use App\Repository\MonsterRepository;
use App\Repository\WardenSpawnRepository;
use App\Service\CityRegistry;
use App\Service\ReporterInfo;
use App\Service\WorldRegistry;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
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
        private readonly ReporterInfo $reporters,
    ) {
    }

    #[Route('', name: 'api_warden_spawns_list', methods: ['GET'])]
    public function list(#[CurrentUser] User $user, #[MapQueryParameter('server_name')] ?string $serverName = null): JsonResponse
    {
        return $this->json([
            'warden_spawns' => array_map(
                fn (WardenSpawn $spawn): array => Json::wardenSpawn($spawn, $this->reporters->of($spawn), $user),
                $this->spawns->findActive($serverName, $this->clock->now()),
            ),
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
            discordGuildId: $payload->discordGuildId,
        );

        $em->persist($spawn);
        $em->flush();

        $reportedBy = $this->reporters->of($spawn);
        $bus->dispatch(WardenSpawnedEvent::fromSpawn($spawn, $reportedBy));

        return $this->json(Json::wardenSpawn($spawn, $reportedBy, $user), 201);
    }

    /**
     * The Warden was killed before its time ran out: closes the report for everyone
     * and the bot takes the alert down. Any player may do it, like reporting.
     */
    #[Route('/{id}/kill', name: 'api_warden_spawns_kill', methods: ['POST'])]
    public function kill(
        string $id,
        #[CurrentUser] User $user,
        EntityManagerInterface $em,
        MessageBusInterface $bus,
        LoggerInterface $logger,
    ): JsonResponse {
        $spawn = $this->spawns->findByIdString($id) ?? throw $this->createNotFoundException('Report not found.');
        // The reporter is the one at the Warden: they call the attack, so they say when it is over.
        if (!$spawn->isReportedBy($user)) {
            return Problem::response(403, 'Only the player who reported this Warden can mark it as gone.');
        }
        if (!$spawn->isActive($this->clock->now())) {
            return Problem::response(409, 'This report is no longer active.');
        }

        $spawn->markKilled();
        $em->flush();

        $bus->dispatch(WardenKilledEvent::fromSpawn($spawn, $user));
        $logger->info('{user} closed the {monster} report on {world} as killed.', [
            'user' => $user->getDisplayName(),
            'monster' => $spawn->getMonster()->getName(),
            'world' => $spawn->getServerName(),
        ]);

        return $this->json(Json::wardenSpawn($spawn, $this->reporters->of($spawn), $user));
    }
}
