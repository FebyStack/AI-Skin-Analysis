# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

# --- web (nginx) ---
FROM nginx:1.27-alpine AS web
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# --- api (node) ---
FROM node:20-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist-server ./dist-server
# index.cjs reads database/schema/schema.sql relative to cwd (/app)
COPY database/schema ./database/schema
EXPOSE 3001
CMD ["node", "dist-server/index.cjs"]
