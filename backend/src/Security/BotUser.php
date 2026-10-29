<?php

namespace App\Security;

use Symfony\Component\Security\Core\User\UserInterface;

/**
 * The Discord bot authenticated with BOT_API_TOKEN and no acting user,
 * allowed to call the /api/v1/internal endpoints only.
 */
final class BotUser implements UserInterface
{
    public function getRoles(): array
    {
        return ['ROLE_BOT'];
    }

    public function getUserIdentifier(): string
    {
        return 'discord-bot';
    }

    public function eraseCredentials(): void
    {
    }
}
