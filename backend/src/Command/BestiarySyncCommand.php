<?php

namespace App\Command;

use App\Entity\Monster;
use App\Repository\MonsterRepository;
use App\Service\BestiaryData;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Brings the monster dictionary in line with data/bestiary.json without touching players'
 * data: adds missing creatures, updates class, charm points and image of existing ones, and removes
 * creatures no longer in the bestiary - unless a kill or a spawn report still uses them.
 */
#[AsCommand(name: 'app:bestiary:sync', description: 'Add missing bestiary creatures and fix existing ones')]
final class BestiarySyncCommand
{
    public function __construct(
        private readonly MonsterRepository $monsters,
        private readonly EntityManagerInterface $em,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Option(description: 'Bestiary JSON file')] string $file = BestiaryData::DEFAULT_PATH,
        #[Option(description: 'Only report what would change')] bool $dryRun = false,
    ): int {
        $entries = BestiaryData::load($file);

        /** @var array<string, Monster> $existing */
        $existing = [];
        foreach ($this->monsters->findAll() as $monster) {
            $existing[mb_strtolower($monster->getName())] = $monster;
        }

        $added = $updated = 0;
        foreach ($entries as $entry) {
            $monster = $existing[mb_strtolower($entry['name'])] ?? null;
            unset($existing[mb_strtolower($entry['name'])]);

            if (null === $monster) {
                $this->em->persist(new Monster($entry['name'], $entry['category'], $entry['charm_points'], $entry['image_url']));
                ++$added;
            } elseif ($monster->getCategory() !== $entry['category']
                || $monster->getCharmPoints() !== $entry['charm_points']
                || $monster->getImageUrl() !== $entry['image_url']) {
                $monster->updateBestiaryEntry($entry['category'], $entry['charm_points'], $entry['image_url']);
                ++$updated;
            }
        }

        $removed = $kept = [];
        foreach ($existing as $monster) {
            if ($this->isUsed($monster)) {
                $kept[] = $monster->getName();
            } else {
                $this->em->remove($monster);
                $removed[] = $monster->getName();
            }
        }

        if ($dryRun) {
            $this->em->clear();
        } else {
            $this->em->flush();
        }

        $io->definitionList(
            ['Added' => (string) $added],
            ['Updated' => (string) $updated],
            ['Removed' => [] === $removed ? '0' : implode(', ', $removed)],
            ['Kept (in use, not in bestiary)' => [] === $kept ? '0' : implode(', ', $kept)],
        );
        $io->success($dryRun ? 'Dry run - nothing was saved.' : \sprintf('Monster dictionary now has %d creatures.', $this->monsters->count([])));

        return Command::SUCCESS;
    }

    private function isUsed(Monster $monster): bool
    {
        return (bool) $this->em->getConnection()->fetchOne(
            'SELECT EXISTS(SELECT 1 FROM character_killed_monsters WHERE monster_id = :id)
                 OR EXISTS(SELECT 1 FROM warden_spawns WHERE monster_id = :id)',
            ['id' => $monster->getId()],
        );
    }
}
