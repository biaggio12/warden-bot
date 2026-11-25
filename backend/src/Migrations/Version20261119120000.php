<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261119120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Duels: who reports more Wardens in the agreed time.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE duels (id UUID NOT NULL, challenger_id INT NOT NULL, opponent_id INT NOT NULL, duration_minutes INT NOT NULL, status VARCHAR(10) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, accept_by TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, starts_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, ends_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, challenger_score INT DEFAULT NULL, opponent_score INT DEFAULT NULL, discord_channel_id VARCHAR(20) DEFAULT NULL, discord_message_id VARCHAR(20) DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE INDEX IDX_B8297BD82D521FDF ON duels (challenger_id)');
        $this->addSql('CREATE INDEX IDX_B8297BD87F656CDC ON duels (opponent_id)');
        $this->addSql('CREATE INDEX idx_duels_status_ends_at ON duels (status, ends_at)');
        $this->addSql('ALTER TABLE duels ADD CONSTRAINT FK_B8297BD82D521FDF FOREIGN KEY (challenger_id) REFERENCES users (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE duels ADD CONSTRAINT FK_B8297BD87F656CDC FOREIGN KEY (opponent_id) REFERENCES users (id) ON DELETE CASCADE NOT DEFERRABLE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE duels');
    }
}
