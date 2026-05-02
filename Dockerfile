# Minimal image so MCP catalogs (Glama, etc.) can run introspection on
# the server. Listing tools does not require a working IRONFLOW_API_KEY,
# but actual tool calls do — provide one at runtime via env.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
ENTRYPOINT ["node", "build/index.js"]
