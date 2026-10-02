FROM node:24.11.0-bookworm-slim@sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152
WORKDIR /app
RUN corepack enable pnpm && corepack prepare pnpm@10.21.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "dev:fulfillment"]
