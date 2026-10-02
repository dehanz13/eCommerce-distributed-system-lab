FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app
RUN corepack enable pnpm && corepack prepare pnpm@10.21.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "dev:fulfillment"]
