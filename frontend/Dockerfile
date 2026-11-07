# Pullwright web: the built SPA with prerendered public pages, served by scripts/serve.mjs,
# which also forwards /api/* to the API service (API_PROXY_TARGET) so everything is one origin.

# Build stage: the prerender step opens each public page in headless Chromium.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
RUN npx playwright install --with-deps chromium
COPY . .
# Empty = same origin (the API is reached through /api on this server).
ARG VITE_API_URL=""
ARG VITE_SITE_URL=""
ENV VITE_API_URL=${VITE_API_URL} VITE_SITE_URL=${VITE_SITE_URL}
RUN npm run build

# Run stage: just Node and the built files.
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY scripts/serve.mjs ./scripts/serve.mjs
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "scripts/serve.mjs", "dist"]
