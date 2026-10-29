<?php

namespace App\Entity;

use App\Enum\WardenSpawnStatus;
use App\Repository\WardenSpawnRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity(repositoryClass: WardenSpawnRepository::class)]
#[ORM\Table(name: 'warden_spawns')]
#[ORM\Index(name: 'idx_warden_spawns_status_expires_at', columns: ['status', 'expires_at'])]
#[ORM\Index(name: 'idx_warden_spawns_server_name', columns: ['server_name'])]
class WardenSpawn
{
    public const DEFAULT_TTL_MINUTES = 7;

    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    private Uuid $id;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false)]
    private Monster $monster;

    #[ORM\Column(length: 30)]
    private string $serverName;

    #[ORM\Column(length: 255)]
    private string $locationDescription;

    #[ORM\Column(length: 30, nullable: true)]
    private ?string $city;

    #[ORM\Column(length: 500, nullable: true)]
    private ?string $additionalInfo;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(name: 'reported_by_user_id', nullable: false)]
    private User $reportedBy;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(length: 10, enumType: WardenSpawnStatus::class)]
    private WardenSpawnStatus $status = WardenSpawnStatus::Active;

    public function __construct(
        Monster $monster,
        string $serverName,
        string $locationDescription,
        User $reportedBy,
        int $ttlMinutes = self::DEFAULT_TTL_MINUTES,
        \DateTimeImmutable $createdAt = new \DateTimeImmutable(),
        ?string $city = null,
        ?string $additionalInfo = null,
    ) {
        $this->id = Uuid::v7();
        $this->monster = $monster;
        $this->serverName = $serverName;
        $this->locationDescription = $locationDescription;
        $this->city = $city;
        $this->additionalInfo = $additionalInfo;
        $this->reportedBy = $reportedBy;
        // The database keeps whole seconds; drop microseconds so the API echoes what is stored.
        $this->createdAt = $createdAt->setMicrosecond(0);
        $this->expiresAt = $this->createdAt->modify(\sprintf('+%d minutes', $ttlMinutes));
    }

    public function getId(): Uuid
    {
        return $this->id;
    }

    public function getMonster(): Monster
    {
        return $this->monster;
    }

    public function getServerName(): string
    {
        return $this->serverName;
    }

    public function getLocationDescription(): string
    {
        return $this->locationDescription;
    }

    public function getCity(): ?string
    {
        return $this->city;
    }

    public function getAdditionalInfo(): ?string
    {
        return $this->additionalInfo;
    }

    public function getReportedBy(): User
    {
        return $this->reportedBy;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getStatus(): WardenSpawnStatus
    {
        return $this->status;
    }
}
