<?php

namespace App\Service;

use App\Entity\Character;
use App\Entity\WardenSpawn;
use App\Repository\CharacterRepository;

/**
 * Who reported a Warden, as players know them: their characters on the spawn's world
 * (the reporter usually calls the attack in game) and their Discord username.
 * The account e-mail is never part of it.
 */
final readonly class ReporterInfo
{
    private const MAX_CHARACTERS = 3;

    public function __construct(private CharacterRepository $characters)
    {
    }

    /**
     * @return array{characters: list<string>, discord_name: ?string}
     */
    public function of(WardenSpawn $spawn): array
    {
        $reporter = $spawn->getReportedBy();
        $names = array_map(
            static fn (Character $c): string => $c->getName(),
            $this->characters->findByUser($reporter, $spawn->getServerName()),
        );

        return [
            'characters' => \array_slice($names, 0, self::MAX_CHARACTERS),
            'discord_name' => $reporter->getDiscordUsername(),
        ];
    }
}
