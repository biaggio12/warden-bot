<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261102130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Admins block accounts; deleting an account keeps its reports without a reporter.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE users ADD blocked_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('ALTER TABLE warden_spawns DROP CONSTRAINT fk_977cab81b79def28');
        $this->addSql('ALTER TABLE warden_spawns ALTER reported_by_user_id DROP NOT NULL');
        $this->addSql('ALTER TABLE warden_spawns ADD CONSTRAINT FK_977CAB81B79DEF28 FOREIGN KEY (reported_by_user_id) REFERENCES users (id) ON DELETE SET NULL NOT DEFERRABLE');
    }

    public function down(Schema $schema): void
    {
        // Reports of deleted accounts have no reporter and cannot go back under NOT NULL.
        $this->addSql('DELETE FROM warden_spawns WHERE reported_by_user_id IS NULL');
        $this->addSql('ALTER TABLE warden_spawns DROP CONSTRAINT FK_977CAB81B79DEF28');
        $this->addSql('ALTER TABLE warden_spawns ALTER reported_by_user_id SET NOT NULL');
        $this->addSql('ALTER TABLE warden_spawns ADD CONSTRAINT fk_977cab81b79def28 FOREIGN KEY (reported_by_user_id) REFERENCES users (id) NOT DEFERRABLE');
        $this->addSql('ALTER TABLE users DROP blocked_at');
    }
}
