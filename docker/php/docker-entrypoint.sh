#!/bin/sh
set -e

# Only bootstrap for the long-running app processes (php-fpm, bin/console workers),
# not for one-off commands such as `composer` or `bin/phpunit`.
if [ "$1" = 'php-fpm' ] || [ "$1" = 'bin/console' ]; then
    if [ "$APP_ENV" != 'prod' ] && [ ! -f vendor/autoload_runtime.php ]; then
        composer install --prefer-dist --no-progress --no-interaction
    fi

    if [ "${RUN_MIGRATIONS:-0}" = '1' ]; then
        echo 'Waiting for the database...'
        until php bin/console dbal:run-sql -q 'SELECT 1' >/dev/null 2>&1; do
            sleep 1
        done
        php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration
    fi
fi

exec "$@"
