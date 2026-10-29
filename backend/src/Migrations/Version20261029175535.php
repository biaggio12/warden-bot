<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261029175535 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Users: optional e-mail (Discord-only accounts) and Discord username.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE users ADD discord_username VARCHAR(64) DEFAULT NULL');
        $this->addSql('ALTER TABLE users ALTER email DROP NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE users DROP discord_username');
        $this->addSql('ALTER TABLE users ALTER email SET NOT NULL');
    }
}
