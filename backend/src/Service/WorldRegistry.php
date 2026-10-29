<?php

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Whitelist of active Tibia worlds accepted by the API. Override with the
 * comma-separated TIBIA_WORLDS env var.
 */
final class WorldRegistry
{
    private const DEFAULT_WORLDS = [
        'Antica', 'Belobra', 'Bona', 'Calmera', 'Celesta', 'Damora', 'Dia', 'Gentebra',
        'Harmonia', 'Inabra', 'Kalibra', 'Lobera', 'Luminera', 'Menera', 'Monza', 'Nefera',
        'Ombra', 'Pacera', 'Peloria', 'Premia', 'Quintera', 'Refugia', 'Secura', 'Solidera',
        'Talera', 'Thyria', 'Unebra', 'Vunira', 'Wintera', 'Yonabra', 'Zuna', 'Zunera',
    ];

    /** @var array<string, string> lower-cased name => canonical name */
    private array $worlds = [];

    public function __construct(#[Autowire('%env(default::TIBIA_WORLDS)%')] ?string $configuredWorlds = null)
    {
        $names = array_filter(array_map('trim', explode(',', (string) $configuredWorlds)));
        foreach ([] !== $names ? $names : self::DEFAULT_WORLDS as $name) {
            $this->worlds[mb_strtolower($name)] = $name;
        }
        ksort($this->worlds);
    }

    /**
     * @return list<string>
     */
    public function all(): array
    {
        return array_values($this->worlds);
    }

    public function isActive(string $name): bool
    {
        return isset($this->worlds[mb_strtolower(trim($name))]);
    }

    /**
     * Returns the canonical spelling ("monza" -> "Monza").
     */
    public function canonicalize(string $name): string
    {
        return $this->worlds[mb_strtolower(trim($name))] ?? trim($name);
    }
}
