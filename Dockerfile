FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Install ALL deps first — the build needs devDependencies (vite, typescript).
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

COPY . .

# Generate the Prisma client and build the Remix app, then drop dev deps so the
# runtime image stays small. Migrations run at release (fly.toml release_command)
# and again idempotently on boot via `docker-start`.
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production
# remix-serve binds 0.0.0.0 and listens on $PORT; Fly maps to internal_port=3000.
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "docker-start"]
