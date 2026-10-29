FROM node:24-alpine AS base
WORKDIR /app
RUN chown node:node /app
USER node

# --- dev: source bind-mounted, tsx restarts the bot on every change ---
FROM base AS dev
ENV NODE_ENV=development
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
EXPOSE 3001
CMD ["npm", "run", "dev"]

# --- build ---
FROM dev AS build
COPY --chown=node:node . .
RUN npm run build && npm prune --omit=dev

# --- prod: compiled JS only ---
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
