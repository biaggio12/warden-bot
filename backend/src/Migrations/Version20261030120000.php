<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261030120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Warden spawns: the Discord server a /report came from.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE warden_spawns ADD discord_guild_id VARCHAR(20) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE warden_spawns DROP discord_guild_id');
    }
}
