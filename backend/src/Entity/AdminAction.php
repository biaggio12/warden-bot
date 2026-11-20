<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

/**
 * What an admin did to a player's account, for the history in the Players tab. The
 * names are copied, so the entry still reads right after either account is deleted.
 */
#[ORM\Entity]
#[ORM\Table(name: 'admin_actions')]
#[ORM\Index(name: 'idx_admin_actions_created_at', columns: ['created_at'])]
class AdminAction
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 180)]
    private string $adminName;

    #[ORM\Column(length: 180)]
    private string $playerName;

    /** Why the admin did it, in their words (optional). */
    #[ORM\Column(length: self::REASON_LENGTH, nullable: true)]
    private ?string $reason;

    public const REASON_LENGTH = 255;

    public function __construct(
        User $admin,
        ?User $player,
        #[ORM\Column(length: 40)]
        private string $action,
        #[ORM\Column(length: 255, nullable: true)]
        private ?string $details,
        #[ORM\Column]
        private \DateTimeImmutable $createdAt,
        /** What the action was done to when it is not an account (e.g. a Discord server). */
        ?string $target = null,
        ?string $reason = null,
    ) {
        $this->adminName = $admin->getDisplayName();
        $reason = null === $reason ? '' : trim($reason);
        $this->reason = '' === $reason ? null : mb_substr($reason, 0, self::REASON_LENGTH);
        $this->playerName = mb_substr($target ?? $player?->getDisplayName() ?? 'deleted account', 0, 180);
    }

    /** @return array{id: int|null, admin: string, player: string, action: string, details: string|null, reason: string|null, created_at: \DateTimeImmutable} */
    public function toArray(): array
    {
        return ['id' => $this->id, 'admin' => $this->adminName, 'player' => $this->playerName, 'action' => $this->action, 'details' => $this->details, 'reason' => $this->reason, 'created_at' => $this->createdAt];
    }
}
