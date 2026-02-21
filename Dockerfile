FROM node:24-slim

# pnpm
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

WORKDIR /app

# Copy package files first (cache layer)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tentickle/package.json packages/tentickle/
COPY packages/agent/package.json packages/agent/
COPY packages/storage/package.json packages/storage/
COPY packages/memory/package.json packages/memory/
COPY packages/tools/package.json packages/tools/
COPY packages/cli/package.json packages/cli/
COPY packages/tui/package.json packages/tui/
COPY agents/main/package.json agents/main/
COPY agents/coding/package.json agents/coding/

# Strip local dev overrides and website from workspace (neither exists in Docker)
RUN node -e "\
  const fs=require('fs');\
  const p=JSON.parse(fs.readFileSync('package.json','utf8'));\
  delete p.pnpm?.overrides;\
  fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');\
  const ws=fs.readFileSync('pnpm-workspace.yaml','utf8');\
  fs.writeFileSync('pnpm-workspace.yaml', ws.replace(/^.*website.*\n/gm,''))"

# Install from npm (no frozen lockfile — overrides were stripped)
RUN pnpm install --no-frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# Default: daemon foreground with WebSocket on 18789
ENV NODE_ENV=production
EXPOSE 18789

ENTRYPOINT ["node", "packages/tentickle/bin/tentickle.js"]
CMD ["start", "--foreground", "--port", "18789"]
