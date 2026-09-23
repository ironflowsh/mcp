# Image for the Ironflow MCP server. The default entrypoint is the stdio
# server, which MCP catalogs (Glama, etc.) run for introspection; no key is
# needed. The hosted endpoint runs the same image with
#   --entrypoint node ... build/http.js   (Streamable HTTP on $PORT, default 8080)
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
USER node
ENTRYPOINT ["node", "build/index.js"]
