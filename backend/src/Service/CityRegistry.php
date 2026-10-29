<?php

namespace App\Service;

/**
 * Tibia cities a Warden report can be attached to.
 */
final class CityRegistry
{
    private const CITIES = [
        "Ab'Dendriel", 'Ankrahmun', 'Carlin', 'Darashia', 'Edron', 'Farmine', 'Feyrist', 'Gray Beach',
        'Issavi', 'Kazordoon', 'Krailos', 'Liberty Bay', 'Marapur', 'Port Hope', 'Rathleton', 'Roshamuul',
        'Svargrond', 'Thais', 'Venore', 'Yalahar',
    ];

    /**
     * @return list<string>
     */
    public function all(): array
    {
        return self::CITIES;
    }

    public function isValid(string $name): bool
    {
        return null !== $this->find($name);
    }

    /**
     * Returns the canonical spelling ("liberty bay" -> "Liberty Bay").
     */
    public function canonicalize(string $name): string
    {
        return $this->find($name) ?? trim($name);
    }

    private function find(string $name): ?string
    {
        $needle = mb_strtolower(trim($name));
        foreach (self::CITIES as $city) {
            if (mb_strtolower($city) === $needle) {
                return $city;
            }
        }

        return null;
    }
}
