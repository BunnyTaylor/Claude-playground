# Self-host the Mushroom Dress app on any Docker host (e.g. a home server).
# The app is pure static files — the pattern engine runs in the browser — so
# this is just nginx serving web/. No build step, no runtime dependencies.
#
#   docker build -t mushroom-dress .
#   docker run -d --restart unless-stopped -p 8080:80 --name mushroom-dress mushroom-dress
#   # then open http://<your-server>:8080
#
# To update: git pull, then rebuild and re-run (or use a watchtower-style
# auto-updater pointed at the rebuilt image).

FROM nginx:1.27-alpine

# Static assets only.
COPY web/ /usr/share/nginx/html/

# SPA-agnostic: serve files directly, no-cache so updates show immediately.
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    add_header Cache-Control "no-cache";\n\
    location / { try_files $uri $uri/ =404; }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
