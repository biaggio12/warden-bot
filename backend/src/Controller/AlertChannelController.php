<?php

namespace App\Controller;

use App\Dto\SetAlertChannelRequest;
use App\Entity\AdminAction;
use App\Entity\AlertChannel;
use App\Entity\User;
use App\Http\Problem;
use App\Repository\AlertChannelRepository;
use App\Security\AdminPolicy;
use App\Service\DiscordGuildDirectory;
use App\Service\WorldRegistry;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;

/**
 * Admins pick, per Discord server and world, the channel that gets the alerts. The bot
 * reads the choice by channel id (InternalController); a world without one keeps using
 * the channel named <prefix><world>.
 */
#[Route('/api/v1/admin/alert-channels')]
final class AlertChannelController extends AbstractController
{
    public function __construct(
        private readonly AdminPolicy $admins,
        private readonly DiscordGuildDirectory $discord,
        private readonly AlertChannelRepository $assignments,
        private readonly WorldRegistry $worlds,
        private readonly EntityManagerInterface $em,
        private readonly ClockInterface $clock,
        private readonly LoggerInterface $logger,
    ) {
    }

    /** The bot's servers with their text channels, the worlds and the current choices. */
    #[Route('', name: 'api_admin_alert_channels', methods: ['GET'])]
    public function list(#[CurrentUser] User $admin, #[MapQueryParameter] bool $refresh = false): JsonResponse
    {
        return $this->notAdmin($admin) ?? $this->state($refresh);
    }

    #[Route('', name: 'api_admin_alert_channels_set', methods: ['PUT'])]
    public function set(#[CurrentUser] User $admin, #[MapRequestPayload] SetAlertChannelRequest $payload): JsonResponse
    {
        if ($denied = $this->notAdmin($admin)) {
            return $denied;
        }
        $guildId = (string) $payload->guildId;
        $channelId = (string) $payload->channelId;
        if (!$this->worlds->isActive((string) $payload->serverName)) {
            return $this->invalid('server_name', 'Unknown world.');
        }
        $world = $this->worlds->canonicalize((string) $payload->serverName);

        try {
            $server = $this->serverOf($guildId);
        } catch (ExceptionInterface $e) {
            return $this->discordDown($e);
        }
        if (null === $server) {
            return $this->invalid('guild_id', 'The bot is not on this Discord server.');
        }
        $channel = array_values(array_filter($server['channels'], static fn (array $c): bool => $c['id'] === $channelId))[0] ?? null;
        if (null === $channel) {
            return $this->invalid('channel_id', 'No such text channel on this Discord server.');
        }
        $taken = $this->assignments->findOneByChannel($channelId);
        if (null !== $taken && ($taken->getGuildId() !== $guildId || $taken->getServerName() !== $world)) {
            return $this->invalid('channel_id', \sprintf('#%s already gets the alerts of %s.', $channel['name'], $taken->getServerName()));
        }

        $now = $this->clock->now();
        $assignment = $this->assignments->findOneByGuildAndWorld($guildId, $world);
        if (null === $assignment) {
            $this->em->persist(new AlertChannel($guildId, $world, $channelId, $now));
        } else {
            $assignment->changeChannel($channelId, $now);
        }
        $this->record($admin, 'set_alert_channel', $server['name'], \sprintf('%s → #%s', $world, $channel['name']));

        return $this->state();
    }

    /** Back to the channel named <prefix><world> on this server. */
    #[Route('/{guildId<\d{17,20}>}/{world}', name: 'api_admin_alert_channels_reset', methods: ['DELETE'])]
    public function reset(#[CurrentUser] User $admin, string $guildId, string $world): JsonResponse
    {
        if ($denied = $this->notAdmin($admin)) {
            return $denied;
        }
        $assignment = $this->assignments->findOneByGuildAndWorld($guildId, $this->worlds->canonicalize($world));
        if (null === $assignment) {
            return Problem::response(404, 'This world has no chosen channel on this server.');
        }
        $this->em->remove($assignment);
        try {
            $serverName = $this->serverOf($guildId)['name'] ?? $guildId;
        } catch (ExceptionInterface) {
            $serverName = $guildId;
        }
        $this->record($admin, 'reset_alert_channel', $serverName, \sprintf('%s → #%s%s', $assignment->getServerName(), $this->discord->prefix(), strtolower($assignment->getServerName())));

        return $this->state();
    }

    private function state(bool $refresh = false): JsonResponse
    {
        $assignments = array_map(static fn (AlertChannel $a): array => $a->toArray(), $this->assignments->all());
        $base = ['enabled' => $this->discord->isEnabled(), 'prefix' => $this->discord->prefix(), 'worlds' => $this->worlds->all(), 'assignments' => $assignments];
        if (!$this->discord->isEnabled()) {
            return $this->json($base + ['servers' => []]);
        }
        try {
            return $this->json($base + ['servers' => $this->discord->serversWithChannels($refresh)]);
        } catch (ExceptionInterface $e) {
            return $this->discordDown($e);
        }
    }

    /** @return array{id: string, name: string, channels: list<array{id: string, name: string, category: ?string}>}|null */
    private function serverOf(string $guildId): ?array
    {
        foreach ($this->discord->serversWithChannels() as $server) {
            if ($server['id'] === $guildId) {
                return $server;
            }
        }

        return null;
    }

    private function record(User $admin, string $action, string $serverName, string $details): void
    {
        $this->em->persist(new AdminAction($admin, null, $action, $details, $this->clock->now(), target: $serverName));
        $this->em->flush();
        $this->logger->info('Admin {admin}: {action} on {server}: {details}.', ['admin' => $admin->getDisplayName(), 'action' => $action, 'server' => $serverName, 'details' => $details]);
    }

    private function notAdmin(User $user): ?JsonResponse
    {
        return $this->admins->isAdmin($user) ? null : Problem::response(403, 'Admins only.');
    }

    private function invalid(string $field, string $message): JsonResponse
    {
        return Problem::response(422, 'The submitted data is invalid.', [
            'type' => 'https://datatracker.ietf.org/doc/html/rfc4918#section-11.2',
            'violations' => [['property_path' => $field, 'title' => $message]],
        ]);
    }

    private function discordDown(ExceptionInterface $e): JsonResponse
    {
        $this->logger->warning('Could not read the Discord servers: {error}', ['error' => $e->getMessage()]);

        return Problem::response(502, 'Could not read the Discord servers. Try again in a moment.');
    }
}
