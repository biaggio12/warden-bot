<?php

namespace App\Controller;

use App\Dto\CreateWardenSpawnRequest;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Http\Json;
use App\Http\Problem;
use App\Message\WardenKilledEvent;
use App\Message\WardenSpawnedEvent;
use App\Repository\CharacterRepository;
use App\Repository\MonsterRepository;
use App\Repository\WardenSpawnRepository;
use App\Service\CityRegistry;
use App\Service\DiscordGuildDirectory;
use App\Service\ReporterInfo;
use App\Service\SpawnHistory;
use App\Service\WorldRegistry;
use Doctrine\DBAL\LockMode;
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
use Symfony\Component\Uid\Uuid;

#[Route('/api/v1/warden-spawns')]
final class WardenSpawnController extends AbstractController
{
    /** Every report pings everyone missing the monster, so a player may send only a few at a time. */
    public const REPORT_LIMIT = 5;
    public const REPORT_WINDOW_SECONDS = 300;

    public function __construct(
        private readonly WardenSpawnRepository $spawns,
        private readonly ClockInterface $clock,
        private readonly ReporterInfo $reporters,
    ) {
    }

    #[Route('', name: 'api_warden_spawns_list', methods: ['GET'])]
    public function list(
        #[CurrentUser] User $user,
        CharacterRepository $characters,
        #[MapQueryParameter('server_name')] ?string $serverName = null,
    ): JsonResponse {
        $active = $this->spawns->findActive($serverName, $this->clock->now());
        $mine = $characters->killsOf($user, array_values(array_unique(array_map(
            static fn (WardenSpawn $spawn): int => (int) $spawn->getMonster()->getId(),
            $active,
        ))));

        return $this->json([
            'warden_spawns' => array_map(
                fn (WardenSpawn $spawn): array => Json::wardenSpawn($spawn, $this->reporters->of($spawn), $user)
                    + self::yourCharacters($spawn, $mine),
                $active,
            ),
        ]);
    }

    /**
     * The viewer's characters on the spawn's world, split by whether they still need the
     * monster: a player with several characters sees which one should go.
     *
     * @param list<array{name: string, server_name: string, killed: list<int>}> $mine
     *
     * @return array{your_characters: array{missing: list<string>, done: list<string>}}
     */
    private static function yourCharacters(WardenSpawn $spawn, array $mine): array
    {
        $monsterId = (int) $spawn->getMonster()->getId();
        $result = ['missing' => [], 'done' => []];
        foreach ($mine as $character) {
            if (0 === strcasecmp($character['server_name'], $spawn->getServerName())) {
                $result[\in_array($monsterId, $character['killed'], true) ? 'done' : 'missing'][] = $character['name'];
            }
        }

        return ['your_characters' => $result];
    }

    /** Past reports for the History tab, newest first; `before` pages on. */
    #[Route('/history', name: 'api_warden_spawns_history', methods: ['GET'])]
    public function history(
        SpawnHistory $history,
        #[MapQueryParameter('server_name')] ?string $serverName = null,
        #[MapQueryParameter('monster_id')] ?int $monsterId = null,
        #[MapQueryParameter] ?string $before = null,
    ): JsonResponse {
        if (null !== $before && !Uuid::isValid($before)) {
            return Problem::response(400, 'before must be the id of a report.');
        }

        return $this->json($history->page('' === $serverName ? null : $serverName, $monsterId, $before));
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
        DiscordGuildDirectory $guilds,
    ): JsonResponse {
        // Without Discord the bot cannot tell which servers are the reporter's, and the
        // alert would go to every server. Reports come from linked accounts only.
        $discordUserId = $user->getDiscordUserId();
        if (null === $discordUserId) {
            return Problem::response(403, 'Link your Discord account to report Wardens (Characters tab).', ['code' => 'discord_required']);
        }

        // A chosen server must be one the player is in (unknown when Discord is unreachable).
        $guildId = $payload->discordGuildId;
        if (null !== $guildId && false === $guilds->isMember($guildId, $discordUserId)) {
            return Problem::response(422, 'The submitted data is invalid.', [
                'type' => 'https://datatracker.ietf.org/doc/html/rfc4918#section-11.2',
                'violations' => [['property_path' => 'discord_guild_id', 'title' => 'You are not a member of this Discord server.']],
            ]);
        }

        // The check and the insert run under a lock on the player, so parallel requests
        // cannot all slip under the limit.
        $result = $em->wrapInTransaction(function () use ($user, $payload, $monsters, $worlds, $cities, $em): JsonResponse|WardenSpawn {
            $em->lock($user, LockMode::PESSIMISTIC_WRITE);
            $now = $this->clock->now();
            $recent = $this->spawns->reportTimesSince($user, $now->modify(\sprintf('-%d seconds', self::REPORT_WINDOW_SECONDS)));
            if (\count($recent) >= self::REPORT_LIMIT) {
                $retryAfter = max(1, $recent[\count($recent) - self::REPORT_LIMIT]->getTimestamp() + self::REPORT_WINDOW_SECONDS - $now->getTimestamp());
                $response = Problem::response(429, \sprintf(
                    'You can send at most %d reports in %d minutes. Try again in %s.',
                    self::REPORT_LIMIT,
                    intdiv(self::REPORT_WINDOW_SECONDS, 60),
                    $retryAfter >= 60 ? \sprintf('%d min', (int) ceil($retryAfter / 60)) : \sprintf('%d s', $retryAfter),
                ), ['code' => 'report_limit']);
                $response->headers->set('Retry-After', (string) $retryAfter);

                return $response;
            }

            $spawn = $this->newSpawn($user, $payload, $monsters, $worlds, $cities);
            $em->persist($spawn);

            return $spawn;
        });
        if ($result instanceof JsonResponse) {
            return $result;
        }

        // Only after the commit: the bot reads the report back as soon as the event arrives.
        $reportedBy = $this->reporters->of($result);
        $bus->dispatch(WardenSpawnedEvent::fromSpawn($result, $reportedBy));

        return $this->json(Json::wardenSpawn($result, $reportedBy, $user), 201);
    }

    private function newSpawn(User $user, CreateWardenSpawnRequest $payload, MonsterRepository $monsters, WorldRegistry $worlds, CityRegistry $cities): WardenSpawn
    {
        return new WardenSpawn(
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
