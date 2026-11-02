<?php

namespace App\Service;

use App\Entity\LoginFailure;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Limits password guessing: at most 10 wrong passwords per e-mail and 30 per IP address
 * in 15 minutes. A successful login clears the e-mail's count.
 */
final readonly class LoginThrottle
{
    public const PER_EMAIL = 10;
    public const PER_IP = 30;
    public const WINDOW_SECONDS = 900;

    public function __construct(
        private EntityManagerInterface $em,
        private Connection $db,
    ) {
    }

    /** Seconds until the next attempt is allowed, or null when it is allowed now. */
    public function retryAfter(string $email, string $ip, \DateTimeImmutable $now): ?int
    {
        $since = $now->modify(\sprintf('-%d seconds', self::WINDOW_SECONDS))->format('Y-m-d H:i:s');
        $waits = [];
        foreach (['email' => [$this->normalize($email), self::PER_EMAIL], 'ip' => [$ip, self::PER_IP]] as $column => [$value, $limit]) {
            // The failure that has to leave the window before one more attempt is allowed.
            $oldest = $this->db->fetchOne(
                "SELECT created_at FROM login_failures WHERE $column = :value AND created_at > :since ORDER BY created_at DESC OFFSET :skip LIMIT 1",
                ['value' => $value, 'since' => $since, 'skip' => $limit - 1],
            );
            if (false !== $oldest) {
                $waits[] = (new \DateTimeImmutable($oldest, new \DateTimeZone('UTC')))->getTimestamp() + self::WINDOW_SECONDS - $now->getTimestamp();
            }
        }

        return [] === $waits ? null : max(1, max($waits));
    }

    public function recordFailure(string $email, string $ip, \DateTimeImmutable $now): void
    {
        $this->em->persist(new LoginFailure(mb_substr($this->normalize($email), 0, 180), mb_substr($ip, 0, 45), $now));
        $this->em->flush();
    }

    public function clear(string $email): void
    {
        $this->db->delete('login_failures', ['email' => $this->normalize($email)]);
    }

    /** @return int rows deleted */
    public function purge(\DateTimeImmutable $before): int
    {
        return (int) $this->db->executeStatement('DELETE FROM login_failures WHERE created_at < :before', ['before' => $before->format('Y-m-d H:i:s')]);
    }

    private function normalize(string $email): string
    {
        return mb_strtolower(trim($email));
    }
}
