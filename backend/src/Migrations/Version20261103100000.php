<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261103100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Alert channels chosen by id per Discord server and world.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE alert_channels (guild_id VARCHAR(20) NOT NULL, server_name VARCHAR(64) NOT NULL, channel_id VARCHAR(20) NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY (guild_id, server_name))');
        $this->addSql('CREATE UNIQUE INDEX uniq_alert_channels_channel ON alert_channels (channel_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE alert_channels');
    }
}
