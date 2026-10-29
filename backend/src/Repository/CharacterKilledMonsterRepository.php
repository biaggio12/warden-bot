<?php

namespace App\Repository;

use App\Entity\Character;
use App\Entity\CharacterKilledMonster;
use App\Entity\Monster;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<CharacterKilledMonster>
 */
class CharacterKilledMonsterRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, CharacterKilledMonster::class);
    }

    public function findOneFor(Character $character, Monster $monster): ?CharacterKilledMonster
    {
        return $this->findOneBy(['character' => $character, 'monster' => $monster]);
    }

    /**
     * Records a kill unless it already exists. Uses ON CONFLICT so concurrent
     * duplicate requests never hit a unique constraint violation.
     *
     * @return bool true when a new row was inserted
     */
    public function markKilled(Character $character, Monster $monster, \DateTimeImmutable $killedAt): bool
    {
        return 1 === $this->getEntityManager()->getConnection()->executeStatement(
            'INSERT INTO character_killed_monsters (character_id, monster_id, killed_at)
             VALUES (:character, :monster, :killed_at)
             ON CONFLICT (character_id, monster_id) DO NOTHING',
            [
                'character' => $character->getId()->toRfc4122(),
                'monster' => $monster->getId(),
                'killed_at' => $killedAt->format('Y-m-d H:i:s'),
            ],
        );
    }

    /**
     * @param list<int> $addIds
     * @param list<int> $removeIds
     */
    public function applyBulkChange(Character $character, array $addIds, array $removeIds, \DateTimeImmutable $killedAt): void
    {
        $connection = $this->getEntityManager()->getConnection();
        $characterId = $character->getId()->toRfc4122();

        $connection->transactional(static function ($connection) use ($characterId, $addIds, $removeIds, $killedAt): void {
            if ([] !== $removeIds) {
                $connection->executeStatement(
                    'DELETE FROM character_killed_monsters WHERE character_id = :character AND monster_id IN (:ids)',
                    ['character' => $characterId, 'ids' => $removeIds],
                    ['ids' => ArrayParameterType::INTEGER],
                );
            }

            if ([] !== $addIds) {
                $connection->executeStatement(
                    'INSERT INTO character_killed_monsters (character_id, monster_id, killed_at)
                     SELECT :character, m.id, :killed_at FROM monsters m WHERE m.id IN (:ids)
                     ON CONFLICT (character_id, monster_id) DO NOTHING',
                    ['character' => $characterId, 'ids' => $addIds, 'killed_at' => $killedAt->format('Y-m-d H:i:s')],
                    ['ids' => ArrayParameterType::INTEGER],
                );
            }
        });
    }

    /**
     * @return list<int>
     */
    public function findKilledMonsterIds(Character $character): array
    {
        return array_map('intval', $this->getEntityManager()->getConnection()->fetchFirstColumn(
            'SELECT monster_id FROM character_killed_monsters WHERE character_id = :character ORDER BY monster_id',
            ['character' => $character->getId()->toRfc4122()],
        ));
    }
}
