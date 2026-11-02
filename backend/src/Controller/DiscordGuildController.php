<?php

namespace App\Controller;

use App\Entity\User;
use App\Service\DiscordGuildDirectory;
use App\Service\WorldRegistry;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/**
 * The Discord servers the report form offers: a web report goes to all of them by
 * default, or to the one the player picks.
 */
#[Route('/api/v1/discord-guilds')]
final class DiscordGuildController extends AbstractController
{
    #[Route('', name: 'api_discord_guilds', methods: ['GET'])]
    public function list(
        #[CurrentUser] User $user,
        DiscordGuildDirectory $directory,
        WorldRegistry $worlds,
        #[MapQueryParameter('server_name')] string $serverName = '',
    ): JsonResponse {
        $discordUserId = $user->getDiscordUserId();
        $guilds = null !== $discordUserId && $worlds->isActive($serverName)
            ? $directory->guildsFor($discordUserId, $worlds->canonicalize($serverName))
            : [];

        return $this->json(['enabled' => $directory->isEnabled(), 'guilds' => $guilds]);
    }
}
