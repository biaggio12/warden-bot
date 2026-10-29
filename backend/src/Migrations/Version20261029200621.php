<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261029200621 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Monsters: TibiaWiki creature GIF.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE monsters ADD image_url VARCHAR(512) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE monsters DROP image_url');
    }
}
