FROM node:22-alpine AS base

RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# Step 1: Install workspace dependencies
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json ./packages/domain/
COPY packages/lexicons/package.json ./packages/lexicons/
COPY packages/atproto/package.json ./packages/atproto/
COPY packages/testkit/package.json ./packages/testkit/
COPY apps/web/package.json ./apps/web/
COPY apps/appview/package.json ./apps/appview/

RUN pnpm install --frozen-lockfile

# Step 2: Build packages and Next.js web application
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps
COPY . .

ARG NEXT_PUBLIC_ATGALLERY_NSID_AUTHORITY="am.noz.atgallery.alpha"
ARG NEXT_PUBLIC_ATGALLERY_MEDIA_GATEWAY_URL=""
ARG NEXT_PUBLIC_ATPROTO_ALPHA_PDS="https://spaces-alpha.host.bsky.network"
ARG NEXT_PUBLIC_ATPROTO_OAUTH_CLIENT_ID=""
ARG NEXT_PUBLIC_ATPROTO_HANDLE_RESOLVER=""

ENV NEXT_PUBLIC_ATGALLERY_NSID_AUTHORITY=$NEXT_PUBLIC_ATGALLERY_NSID_AUTHORITY
ENV NEXT_PUBLIC_ATGALLERY_MEDIA_GATEWAY_URL=$NEXT_PUBLIC_ATGALLERY_MEDIA_GATEWAY_URL
ENV NEXT_PUBLIC_ATPROTO_ALPHA_PDS=$NEXT_PUBLIC_ATPROTO_ALPHA_PDS
ENV NEXT_PUBLIC_ATPROTO_OAUTH_CLIENT_ID=$NEXT_PUBLIC_ATPROTO_OAUTH_CLIENT_ID
ENV NEXT_PUBLIC_ATPROTO_HANDLE_RESOLVER=$NEXT_PUBLIC_ATPROTO_HANDLE_RESOLVER

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter './packages/**' -r --if-present run build
RUN pnpm --filter @atgallery/web build

# Step 3: Minimal runner image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
