<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261102120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'The full [OMW] / [On site] lists of each Discord alert.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE warden_spawn_presence (spawn_id UUID NOT NULL, message_id VARCHAR(20) NOT NULL, on_my_way JSON NOT NULL, on_site JSON NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY (spawn_id, message_id))');
        $this->addSql('CREATE INDEX IDX_C84982786136E503 ON warden_spawn_presence (spawn_id)');
        $this->addSql('ALTER TABLE warden_spawn_presence ADD CONSTRAINT FK_C84982786136E503 FOREIGN KEY (spawn_id) REFERENCES warden_spawns (id) ON DELETE CASCADE NOT DEFERRABLE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE warden_spawn_presence');
    }
}
