<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261120100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Who clicked Dead on a report, and when; admin history names players by Discord or character, not e-mail.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE warden_spawns ADD killed_by_user_id INT DEFAULT NULL');
        $this->addSql('ALTER TABLE warden_spawns ADD killed_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('ALTER TABLE warden_spawns ADD CONSTRAINT FK_977CAB81A6819869 FOREIGN KEY (killed_by_user_id) REFERENCES users (id) ON DELETE SET NULL NOT DEFERRABLE');
        $this->addSql('CREATE INDEX IDX_977CAB81A6819869 ON warden_spawns (killed_by_user_id)');

        // Past admin history entries saved the e-mail: the same name the page shows now instead.
        foreach (['player_name', 'admin_name'] as $column) {
            $this->addSql(<<<SQL
                UPDATE admin_actions a SET $column = LEFT(COALESCE(
                    NULLIF(u.discord_username, ''),
                    (SELECT STRING_AGG(c.name, ', ' ORDER BY c.name) FROM characters c WHERE c.user_id = u.id),
                    'Player #' || u.id
                ), 180)
                FROM users u WHERE u.email IS NOT NULL AND a.$column = u.email
                SQL);
        }
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE warden_spawns DROP CONSTRAINT FK_977CAB81A6819869');
        $this->addSql('DROP INDEX IDX_977CAB81A6819869');
        $this->addSql('ALTER TABLE warden_spawns DROP killed_by_user_id');
        $this->addSql('ALTER TABLE warden_spawns DROP killed_at');
    }
}
