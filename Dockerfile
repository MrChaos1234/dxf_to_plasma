FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm test && npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/arc.html /srv/index.html
COPY --from=build /app/dist/teile.html /srv/teile.html
EXPOSE 80 443 443/udp
