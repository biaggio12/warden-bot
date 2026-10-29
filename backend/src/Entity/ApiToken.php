<?php

namespace App\Entity;

use App\Repository\ApiTokenRepository;
use Doctrine\ORM\Mapping as ORM;

/**
 * Bearer token issued on login. Only a SHA-256 hash of the token is stored.
 */
#[ORM\Entity(repositoryClass: ApiTokenRepository::class)]
#[ORM\Table(name: 'api_tokens')]
class ApiToken
{
    public const TTL = '+30 days';

    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 64, unique: true)]
    private string $tokenHash;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    private function __construct(User $user, string $tokenHash, \DateTimeImmutable $now)
    {
        $this->user = $user;
        $this->tokenHash = $tokenHash;
        $this->createdAt = $now;
        $this->expiresAt = $now->modify(self::TTL);
    }

    /**
     * @return array{0: self, 1: string} the entity and the plain token to hand out once
     */
    public static function issue(User $user, \DateTimeImmutable $now = new \DateTimeImmutable()): array
    {
        $plain = bin2hex(random_bytes(32));

        return [new self($user, self::hash($plain), $now), $plain];
    }

    public static function hash(string $plainToken): string
    {
        return hash('sha256', $plainToken);
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function isValid(\DateTimeImmutable $now): bool
    {
        return $this->expiresAt > $now;
    }
}
