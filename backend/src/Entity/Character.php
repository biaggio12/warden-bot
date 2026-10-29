<?php

namespace App\Entity;

use App\Repository\CharacterRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity(repositoryClass: CharacterRepository::class)]
#[ORM\Table(name: 'characters')]
#[ORM\UniqueConstraint(name: 'uniq_characters_name', columns: ['name'])]
#[ORM\Index(name: 'idx_characters_server_name', columns: ['server_name'])]
class Character
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    private Uuid $id;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 30)]
    private string $name;

    #[ORM\Column(length: 30)]
    private string $serverName;

    public function __construct(User $user, string $name, string $serverName)
    {
        $this->id = Uuid::v7();
        $this->user = $user;
        $this->name = $name;
        $this->serverName = $serverName;
    }

    public function getId(): Uuid
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function isOwnedBy(User $user): bool
    {
        return $this->user === $user
            || (null !== $user->getId() && $this->user->getId() === $user->getId());
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function getServerName(): string
    {
        return $this->serverName;
    }
}
