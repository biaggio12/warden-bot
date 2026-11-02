<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

/**
 * A wrong password, kept for the login limit (LoginThrottle) and purged after a day.
 */
#[ORM\Entity]
#[ORM\Table(name: 'login_failures')]
#[ORM\Index(name: 'idx_login_failures_email', columns: ['email', 'created_at'])]
#[ORM\Index(name: 'idx_login_failures_ip', columns: ['ip', 'created_at'])]
class LoginFailure
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    public function __construct(
        #[ORM\Column(length: 180)]
        private string $email,
        #[ORM\Column(length: 45)]
        private string $ip,
        #[ORM\Column]
        private \DateTimeImmutable $createdAt,
    ) {
    }
}
