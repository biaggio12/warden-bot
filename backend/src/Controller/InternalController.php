<?php

namespace App\Controller;

use App\Dto\LinkDiscordRequest;
use App\Http\Problem;
use App\Repository\CharacterRepository;
use App\Repository\UserRepository;
use App\Repository\WardenSpawnRepository;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Endpoints for the Discord bot only (ROLE_BOT, see security.yaml).
 */
#[Route('/api/v1/internal')]
final class InternalController extends AbstractController
{
    /**
     * Who should get a DM about this spawn: linked players with a character on the
     * spawn's world that has not killed the monster yet.
     */
    #[Route('/warden-spawns/{spawn_id}/recipients', name: 'api_internal_spawn_recipients', methods: ['GET'])]
    public function recipients(string $spawn_id, WardenSpawnRepository $spawns, CharacterRepository $characters): JsonResponse
    {
        $spawn = $spawns->findByIdString($spawn_id) ?? throw $this->createNotFoundException('Report not found.');

        $byDiscordUser = [];
        foreach ($characters->findNotificationRecipients($spawn->getServerName(), (int) $spawn->getMonster()->getId()) as $row) {
            $byDiscordUser[$row['discord_user_id']]['discord_user_id'] = $row['discord_user_id'];
            $byDiscordUser[$row['discord_user_id']]['characters'][] = [
                'id' => $row['character_id'],
                'name' => $row['character_name'],
            ];
        }

        return $this->json([
            'spawn_id' => $spawn->getId()->toRfc4122(),
            'recipients' => array_values($byDiscordUser),
        ]);
    }

    #[Route('/discord-links', name: 'api_internal_discord_link', methods: ['POST'])]
    public function linkDiscord(
        #[MapRequestPayload] LinkDiscordRequest $payload,
        UserRepository $users,
        EntityManagerInterface $em,
        ClockInterface $clock,
    ): JsonResponse {
        $user = $users->findOneByDiscordLinkCode((string) $payload->code);
        if (null === $user || !$user->isDiscordLinkCodeValid($clock->now())) {
            return Problem::response(404, 'The code is invalid or has expired. Generate a new one in the web app.');
        }

        $previous = $users->findOneByDiscordUserId((string) $payload->discordUserId);
        if (null !== $previous && $previous !== $user) {
            return Problem::response(409, 'This Discord account is already linked to another account.');
        }

        $user->linkDiscord((string) $payload->discordUserId);
        $em->flush();

        return $this->json(['display_name' => $user->getDisplayName(), 'discord_user_id' => $user->getDiscordUserId()]);
    }
}
