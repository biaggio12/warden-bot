<?php

namespace App\Entity;

use App\Repository\WardenSpawnPresenceRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * The [OMW] / [No Need] lists of one Discord alert of a report (a report posted on two
 * servers has two alerts, each with its own lists). The alert names only the first few
 * players; the full lists, in click order, live here so a bot restart does not lose them.
 */
#[ORM\Entity(repositoryClass: WardenSpawnPresenceRepository::class)]
#[ORM\Table(name: 'warden_spawn_presence')]
class WardenSpawnPresence
{
    #[ORM\Id]
    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private WardenSpawn $spawn;

    /** Discord message id of the alert. */
    #[ORM\Id]
    #[ORM\Column(length: 20)]
    private string $messageId;

    /** @var list<string> Discord user ids */
    #[ORM\Column(type: Types::JSON)]
    private array $onMyWay = [];

    /** @var list<string> Discord user ids */
    #[ORM\Column(type: Types::JSON)]
    private array $onSite = [];

    #[ORM\Column]
    private \DateTimeImmutable $updatedAt;

    public function __construct(WardenSpawn $spawn, string $messageId, \DateTimeImmutable $now)
    {
        $this->spawn = $spawn;
        $this->messageId = $messageId;
        $this->updatedAt = $now;
    }

    /**
     * @param list<string> $onMyWay
     * @param list<string> $onSite
     */
    public function replace(array $onMyWay, array $onSite, \DateTimeImmutable $now): void
    {
        $this->onMyWay = array_values(array_unique($onMyWay));
        // A player is on one list at most.
        $this->onSite = array_values(array_diff(array_unique($onSite), $this->onMyWay));
        $this->updatedAt = $now;
    }

    public function getSpawn(): WardenSpawn
    {
        return $this->spawn;
    }

    public function getMessageId(): string
    {
        return $this->messageId;
    }

    /** @return list<string> */
    public function getOnMyWay(): array
    {
        return $this->onMyWay;
    }

    /** @return list<string> */
    public function getOnSite(): array
    {
        return $this->onSite;
    }
}
