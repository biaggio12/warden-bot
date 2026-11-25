<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261119140000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Duels can be played for points: the winner takes the stake from the loser.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE duels ADD stake INT DEFAULT 0 NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE duels DROP stake');
    }
}
