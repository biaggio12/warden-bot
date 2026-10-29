<?php

namespace App\Repository;

use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<User>
 */
class UserRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, User::class);
    }

    public function findOneByEmail(string $email): ?User
    {
        return $this->findOneBy(['email' => mb_strtolower(trim($email))]);
    }

    public function findOneByDiscordUserId(string $discordUserId): ?User
    {
        return $this->findOneBy(['discordUserId' => $discordUserId]);
    }

    public function findOneByDiscordLinkCode(string $code): ?User
    {
        return $this->findOneBy(['discordLinkCode' => mb_strtoupper(trim($code))]);
    }
}
