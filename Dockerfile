FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm test && npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/arc.html /srv/index.html
COPY --from=build /app/dist/teile.html /srv/teile.html
COPY --from=build /app/dist/arc-xp.html /app/dist/arc-xp.hta /app/dist/arc-xp.zip /srv/
EXPOSE 80 443 443/udp
