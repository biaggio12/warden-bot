<?php

namespace App\Entity;

use App\Repository\UserRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;

#[ORM\Entity(repositoryClass: UserRepository::class)]
#[ORM\Table(name: 'users')]
class User implements UserInterface, PasswordAuthenticatedUserInterface
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    /** Null for accounts created through "Log in with Discord" without a verified e-mail. */
    #[ORM\Column(length: 180, unique: true, nullable: true)]
    private ?string $email;

    #[ORM\Column]
    private string $password = '';

    #[ORM\Column(length: 32, unique: true, nullable: true)]
    private ?string $discordUserId = null;

    #[ORM\Column(length: 64, nullable: true)]
    private ?string $discordUsername = null;

    #[ORM\Column(length: 16, unique: true, nullable: true)]
    private ?string $discordLinkCode = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $discordLinkCodeExpiresAt = null;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    /** Set by an admin: the account cannot log in, report or be pinged until unblocked. */
    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $blockedAt = null;

    /** Granted by an admin on the website: the Players tab, without the admin-only actions. */
    #[ORM\Column(options: ['default' => false])]
    private bool $moderator = false;

    public function __construct(?string $email)
    {
        $this->email = null === $email ? null : mb_strtolower(trim($email));
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getEmail(): ?string
    {
        return $this->email;
    }

    public function getUserIdentifier(): string
    {
        return $this->email ?? 'discord:'.($this->discordUserId ?? '');
    }

    /** What to show for the account: e-mail, else the Discord name. */
    public function getDisplayName(): string
    {
        return $this->email ?? $this->discordUsername ?? 'Player';
    }

    public function getRoles(): array
    {
        return ['ROLE_USER'];
    }

    public function getPassword(): string
    {
        return $this->password;
    }

    public function setPassword(string $hashedPassword): void
    {
        $this->password = $hashedPassword;
    }

    public function getDiscordUserId(): ?string
    {
        return $this->discordUserId;
    }

    public function getDiscordUsername(): ?string
    {
        return $this->discordUsername;
    }

    public function issueDiscordLinkCode(string $code, \DateTimeImmutable $expiresAt): void
    {
        $this->discordLinkCode = $code;
        $this->discordLinkCodeExpiresAt = $expiresAt;
    }

    public function getDiscordLinkCodeExpiresAt(): ?\DateTimeImmutable
    {
        return $this->discordLinkCodeExpiresAt;
    }

    public function isDiscordLinkCodeValid(\DateTimeImmutable $now): bool
    {
        return null !== $this->discordLinkCode && $this->discordLinkCodeExpiresAt > $now;
    }

    public function linkDiscord(string $discordUserId, ?string $discordUsername = null): void
    {
        $this->discordUserId = $discordUserId;
        $this->discordUsername = $discordUsername ?? $this->discordUsername;
        $this->discordLinkCode = null;
        $this->discordLinkCodeExpiresAt = null;
    }

    /** Admins only (the player may link again). The pending /link code goes too. */
    public function unlinkDiscord(): void
    {
        $this->discordUserId = null;
        $this->discordUsername = null;
        $this->discordLinkCode = null;
        $this->discordLinkCodeExpiresAt = null;
    }

    public function block(\DateTimeImmutable $now): void
    {
        $this->blockedAt ??= $now;
    }

    public function unblock(): void
    {
        $this->blockedAt = null;
    }

    public function isBlocked(): bool
    {
        return null !== $this->blockedAt;
    }

    public function isModerator(): bool
    {
        return $this->moderator;
    }

    public function setModerator(bool $moderator): void
    {
        $this->moderator = $moderator;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function eraseCredentials(): void
    {
    }

    public function __serialize(): array
    {
        $data = (array) $this;
        $data["\0".self::class."\0password"] = hash('crc32c', $this->password);

        return $data;
    }
}
