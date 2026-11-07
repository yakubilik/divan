#!/bin/sh
# Apply Divan's patches to the Plane on the ThinkPad, and put the products'
# logos where Plane serves them. Run from the Mac after every Plane upgrade:
#   sh ops/plane/apply.sh
# What it does there (~/plane, the compose project "plane"):
#   divan-patch/assets/<chunk>.js   the logo component, taught to draw a picture
#   divan-patch/logos/<slug>.png    the products' logos (from ~/.divan/project-icons)
#   docker-compose.override.yml     mounts both into the web container
set -eu
HOST=${PLANE_HOST:-yakup@thinkpad}
HERE=$(cd "$(dirname "$0")" && pwd)
ssh "$HOST" 'set -e; cd ~/plane; rm -rf divan-patch/src; mkdir -p divan-patch/src divan-patch/assets divan-patch/logos
  docker compose -p plane --env-file plane.env -f docker-compose.yml cp web:/usr/share/nginx/html/assets/. divan-patch/src/ >/dev/null'
scp -q "$HERE/patch_logo.py" "$HOST:plane/divan-patch/patch_logo.py"
CHUNK=$(ssh "$HOST" 'cd ~/plane/divan-patch && rm -f assets/*.js && python3 patch_logo.py src assets && rm -rf src')
scp -q "$HOME"/.divan/project-icons/*.png "$HOST:plane/divan-patch/logos/"
ssh "$HOST" "cd ~/plane && cat > docker-compose.override.yml <<YML
# Written by divan/ops/plane/apply.sh — Divan's patches to Plane's web app.
services:
  web:
    volumes:
      - ./divan-patch/assets/$CHUNK:/usr/share/nginx/html/assets/$CHUNK:ro
      - ./divan-patch/logos:/usr/share/nginx/html/divan-logos:ro
YML
docker compose -p plane --env-file plane.env up -d web >/dev/null 2>&1"
echo "patched $CHUNK; logos at /divan-logos/<slug>.png"
