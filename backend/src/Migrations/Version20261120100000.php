<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261120100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Who clicked Dead on a report, and when.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE warden_spawns ADD killed_by_user_id INT DEFAULT NULL');
        $this->addSql('ALTER TABLE warden_spawns ADD killed_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('ALTER TABLE warden_spawns ADD CONSTRAINT FK_977CAB81A6819869 FOREIGN KEY (killed_by_user_id) REFERENCES users (id) ON DELETE SET NULL NOT DEFERRABLE');
        $this->addSql('CREATE INDEX IDX_977CAB81A6819869 ON warden_spawns (killed_by_user_id)');

    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE warden_spawns DROP CONSTRAINT FK_977CAB81A6819869');
        $this->addSql('DROP INDEX IDX_977CAB81A6819869');
        $this->addSql('ALTER TABLE warden_spawns DROP killed_by_user_id');
        $this->addSql('ALTER TABLE warden_spawns DROP killed_at');
    }
}
