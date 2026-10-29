<?php

namespace App\Service;

/**
 * Reads data/bestiary.json: every creature of Tibia's bestiary with its class, difficulty
 * and TibiaWiki GIF.
 */
final class BestiaryData
{
    public const DEFAULT_PATH = __DIR__.'/../../data/bestiary.json';

    /** Charm points awarded for completing a creature, by bestiary difficulty. */
    private const CHARM_POINTS = [
        'Harmless' => 1,
        'Trivial' => 5,
        'Easy' => 15,
        'Medium' => 25,
        'Hard' => 50,
        'Challenging' => 100,
    ];

    /**
     * @return list<array{name: string, category: string, charm_points: int, image_url: ?string}>
     */
    public static function load(string $path = self::DEFAULT_PATH): array
    {
        $rows = json_decode((string) file_get_contents($path), true, 512, \JSON_THROW_ON_ERROR);

        return array_map(static function (array $row): array {
            if (!isset($row['name'], $row['class'], $row['difficulty'], self::CHARM_POINTS[$row['difficulty']])) {
                throw new \UnexpectedValueException('Invalid bestiary entry: '.json_encode($row));
            }

            return [
                'name' => $row['name'],
                'category' => $row['class'],
                'charm_points' => self::CHARM_POINTS[$row['difficulty']],
                'image_url' => $row['image'] ?? null,
            ];
        }, $rows);
    }
}
