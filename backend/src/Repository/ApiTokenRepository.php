<?php

namespace App\Repository;

use App\Entity\ApiToken;
use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<ApiToken>
 */
class ApiTokenRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, ApiToken::class);
    }

    public function findOneByPlainToken(string $plainToken): ?ApiToken
    {
        return $this->createQueryBuilder('t')
            ->addSelect('u')
            ->join('t.user', 'u')
            ->where('t.tokenHash = :hash')
            ->setParameter('hash', ApiToken::hash($plainToken))
            ->getQuery()
            ->getOneOrNullResult();
    }

    /** Logs the player out everywhere (but `except`, the session making the request). */
    public function deleteAllOf(User $user, ?ApiToken $except = null): void
    {
        $qb = $this->createQueryBuilder('t')->delete()->where('t.user = :user')->setParameter('user', $user);
        if (null !== $except) {
            $qb->andWhere('t != :except')->setParameter('except', $except);
        }
        $qb->getQuery()->execute();
    }
}
