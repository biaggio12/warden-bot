<?php

namespace App\Security;

use App\Entity\User;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Staff of the Players tab. Admins are the accounts linked to the Discord ids listed in ADMIN_DISCORD_IDS
 * (comma separated). Admin rights follow the Discord account, so they need no
 * migration and are granted or taken away by editing .env. Moderators are granted by an
 * admin on the website (users.moderator) and get the Players tab without the admin-only
 * actions; an admin is never a moderator too.
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
        return $this->isDiscordIdAdmin($user->getDiscordUserId());
    }

    public function isModerator(User $user): bool
    {
        return $user->isModerator() && !$this->isAdmin($user);
    }

    /** Admin or moderator: may open the Players tab. */
    public function isStaff(User $user): bool
    {
        return $this->isAdmin($user) || $user->isModerator();
    }

    public function isDiscordIdAdmin(?string $discordUserId): bool
    {
        return null !== $discordUserId && \in_array($discordUserId, $this->discordIds, true);
    }
}
