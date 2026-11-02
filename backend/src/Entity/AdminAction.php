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

    public function __construct(
        User $admin,
        User $player,
        #[ORM\Column(length: 40)]
        private string $action,
        #[ORM\Column(length: 255, nullable: true)]
        private ?string $details,
        #[ORM\Column]
        private \DateTimeImmutable $createdAt,
    ) {
        $this->adminName = $admin->getDisplayName();
        $this->playerName = $player->getDisplayName();
    }

    /** @return array{id: int|null, admin: string, player: string, action: string, details: string|null, created_at: \DateTimeImmutable} */
    public function toArray(): array
    {
        return ['id' => $this->id, 'admin' => $this->adminName, 'player' => $this->playerName, 'action' => $this->action, 'details' => $this->details, 'created_at' => $this->createdAt];
    }
}
