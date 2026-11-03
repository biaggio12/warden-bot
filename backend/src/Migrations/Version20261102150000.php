<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261102150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Moderators: admins grant them the Players tab on the website.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE users ADD moderator BOOLEAN DEFAULT false NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE users DROP moderator');
    }
}
