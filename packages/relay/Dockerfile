FROM node:24-alpine AS base
WORKDIR /app

# Copy package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY packages/relay/package.json ./packages/relay/

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile --filter @decisionator/relay...

# Copy source files
COPY packages/core ./packages/core
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY packages/relay ./packages/relay

# Environment settings
ENV NODE_ENV=production
ENV PORT=4179
EXPOSE 4179

CMD ["node", "--experimental-sqlite", "packages/relay/dist/cli.js"]
