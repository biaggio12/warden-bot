<?php

namespace App\Repository;

use App\Entity\Character;
use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/**
 * @extends ServiceEntityRepository<Character>
 */
class CharacterRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Character::class);
    }

    public function findByIdString(string $id): ?Character
    {
        if (!Uuid::isValid($id)) {
            return null;
        }

        return $this->find(Uuid::fromString($id));
    }

    /**
     * @return list<Character>
     */
    public function findByUser(User $user, ?string $serverName = null): array
    {
        $qb = $this->createQueryBuilder('c')
            ->where('c.user = :user')
            ->setParameter('user', $user)
            ->orderBy('c.serverName')
            ->addOrderBy('c.name');

        if (null !== $serverName) {
            $qb->andWhere('LOWER(c.serverName) = LOWER(:server)')->setParameter('server', $serverName);
        }

        return $qb->getQuery()->getResult();
    }

    /**
     * For each of the user's characters, which of $monsterIds it has killed, so the
     * active list can say which character still needs a Warden.
     *
     * @param list<int> $monsterIds
     *
     * @return list<array{name: string, server_name: string, killed: list<int>}>
     */
    public function killsOf(User $user, array $monsterIds): array
    {
        $rows = $this->getEntityManager()->getConnection()->executeQuery(
            'SELECT c.id, c.name, c.server_name, k.monster_id
             FROM characters c
             LEFT JOIN character_killed_monsters k ON k.character_id = c.id AND k.monster_id IN (:monsters)
             WHERE c.user_id = :user
             ORDER BY c.name',
            ['user' => $user->getId(), 'monsters' => $monsterIds ?: [0]],
            ['monsters' => \Doctrine\DBAL\ArrayParameterType::INTEGER],
        )->fetchAllAssociative();

        $characters = [];
        foreach ($rows as $row) {
            $characters[$row['id']] ??= ['name' => (string) $row['name'], 'server_name' => (string) $row['server_name'], 'killed' => []];
            if (null !== $row['monster_id']) {
                $characters[$row['id']]['killed'][] = (int) $row['monster_id'];
            }
        }

        return array_values($characters);
    }

    public function nameExists(string $name): bool
    {
        return null !== $this->createQueryBuilder('c')
            ->select('1')
            ->where('LOWER(c.name) = LOWER(:name)')
            ->setParameter('name', $name)
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /**
     * Characters with a linked Discord account that play on $serverName and have
     * not killed $monsterId yet - the audience for a targeted Warden DM.
     *
     * @return list<array{discord_user_id: string, character_id: string, character_name: string}>
     */
    public function findNotificationRecipients(string $serverName, int $monsterId): array
    {
        $sql = <<<'SQL'
            SELECT u.discord_user_id, c.id AS character_id, c.name AS character_name
            FROM characters c
            JOIN users u ON u.id = c.user_id
            WHERE u.discord_user_id IS NOT NULL
              AND u.blocked_at IS NULL
              AND c.server_name = :server
              AND NOT EXISTS (
                  SELECT 1 FROM character_killed_monsters k
                  WHERE k.character_id = c.id AND k.monster_id = :monster
              )
            ORDER BY u.discord_user_id, c.name
            SQL;

        return $this->getEntityManager()->getConnection()
            ->executeQuery($sql, ['server' => $serverName, 'monster' => $monsterId])
            ->fetchAllAssociative();
    }
}
