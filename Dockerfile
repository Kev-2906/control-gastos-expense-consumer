FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine
RUN apk add --no-cache sqlite
WORKDIR /app
ENV NODE_ENV=production \
    ODOO_AUDIT_DB_PATH=/app/data/odoo-audit.sqlite
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/sqlite/init/ /docker-entrypoint-initdb.d/
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME /app/data
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
