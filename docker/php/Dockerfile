# syntax=docker/dockerfile:1
FROM php:8.4-fpm-alpine AS base

ARG UID=1000
ARG GID=1000

COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_pgsql amqp intl opcache apcu zip \
    && apk add --no-cache fcgi shadow \
    && usermod -u "${UID}" www-data && groupmod -g "${GID}" www-data

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY docker/php/conf.d/app.ini /usr/local/etc/php/conf.d/zz-app.ini
COPY docker/php/zz-fpm.conf /usr/local/etc/php-fpm.d/zz-app.conf
COPY --chmod=755 docker/php/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
COPY --chmod=755 docker/php/healthcheck.sh /usr/local/bin/php-fpm-healthcheck

WORKDIR /var/www/app
RUN chown www-data:www-data /var/www/app
USER www-data

ENTRYPOINT ["docker-entrypoint"]
CMD ["php-fpm"]

# --- dev: source is bind-mounted, opcache revalidates on every request ---
FROM base AS dev
ENV APP_ENV=dev
COPY docker/php/conf.d/dev.ini /usr/local/etc/php/conf.d/zz-dev.ini

# --- prod: source baked into the image ---
FROM base AS prod
ENV APP_ENV=prod
COPY docker/php/conf.d/prod.ini /usr/local/etc/php/conf.d/zz-prod.ini
COPY --chown=www-data:www-data backend/composer.json backend/composer.lock backend/symfony.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-progress
COPY --chown=www-data:www-data backend/ ./
RUN composer dump-autoload --classmap-authoritative --no-dev \
    && composer dump-env prod \
    && php bin/console cache:warmup
