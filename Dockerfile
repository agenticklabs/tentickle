FROM node:24-slim AS build

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

# Strip local dev overrides and website from workspace
RUN node -e "\
  const fs=require('fs');\
  const p=JSON.parse(fs.readFileSync('package.json','utf8'));\
  delete p.pnpm?.overrides;\
  fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');\
  const ws=fs.readFileSync('pnpm-workspace.yaml','utf8');\
  fs.writeFileSync('pnpm-workspace.yaml', ws.replace(/^.*website.*\n/gm,''))"

RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm build

# Apply publishConfig, strip source files
RUN node -e "\
  const fs=require('fs'),{join}=require('path');\
  const dirs=['packages/tentickle','packages/agent','packages/storage',\
    'packages/memory','packages/tools','packages/cli','packages/tui',\
    'agents/main','agents/coding'];\
  for(const d of dirs){\
    const f=join(d,'package.json');\
    const p=JSON.parse(fs.readFileSync(f,'utf8'));\
    if(p.publishConfig){Object.assign(p,p.publishConfig);delete p.publishConfig}\
    fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n');\
    fs.rmSync(join(d,'src'),{recursive:true,force:true});\
    try{fs.rmSync(join(d,'tsconfig.json'),{force:true})}catch{};\
    try{fs.rmSync(join(d,'tsconfig.build.json'),{force:true})}catch{}};\
  fs.rmSync('.turbo',{recursive:true,force:true});"

# --- Production image (clean layer history) ---
FROM node:24-slim

WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 18789

ENTRYPOINT ["node", "packages/tentickle/bin/tentickle.js"]
CMD ["start", "--foreground", "--port", "18789"]
