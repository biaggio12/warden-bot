<?php

namespace App\Security;

use App\Entity\User;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Admins are the accounts linked to the Discord ids listed in ADMIN_DISCORD_IDS
 * (comma separated). Admin rights follow the Discord account, so they need no
 * migration and are granted or taken away by editing .env.
 */
final readonly class AdminPolicy
{
    /** @var list<string> */
    private array $discordIds;

    public function __construct(#[Autowire('%env(default::ADMIN_DISCORD_IDS)%')] ?string $adminDiscordIds = null)
    {
        $this->discordIds = array_values(array_filter(
            array_map('trim', explode(',', (string) $adminDiscordIds)),
            static fn (string $id): bool => 1 === preg_match('/^\d{17,20}$/', $id),
        ));
    }

    public function isAdmin(User $user): bool
    {
        return null !== $user->getDiscordUserId() && \in_array($user->getDiscordUserId(), $this->discordIds, true);
    }
}
