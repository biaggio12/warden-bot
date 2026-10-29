FROM node:24-alpine AS base
WORKDIR /app
RUN chown node:node /app
USER node

# --- dev: source bind-mounted, Vite dev server with HMR ---
FROM base AS dev
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
EXPOSE 5173
CMD ["npm", "run", "dev"]

# --- build: static bundle; the API URL is baked in at build time ---
FROM dev AS build
ARG VITE_API_URL=http://localhost:8080
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=prod
ENV VITE_API_URL=${VITE_API_URL} VITE_SENTRY_DSN=${VITE_SENTRY_DSN} VITE_SENTRY_ENVIRONMENT=${VITE_SENTRY_ENVIRONMENT}
COPY --chown=node:node . .
RUN npm run build

# --- prod: static files served by nginx ---
FROM nginx:1.29-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
