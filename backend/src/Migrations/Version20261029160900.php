<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261029160900 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Warden spawns: optional city and additional info.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE warden_spawns ADD city VARCHAR(30) DEFAULT NULL');
        $this->addSql('ALTER TABLE warden_spawns ADD additional_info VARCHAR(500) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE warden_spawns DROP city');
        $this->addSql('ALTER TABLE warden_spawns DROP additional_info');
    }
}
