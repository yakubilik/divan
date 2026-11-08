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
# The site straight out of the image, never out of the running container: that
# one already wears the last patch.
ssh "$HOST" 'set -e; cd ~/plane; rm -rf divan-patch/src; mkdir -p divan-patch/src
  REL=$(sed -n "s/^APP_RELEASE=//p" plane.env); REL=${REL:-v1.4.3}
  docker run --rm --entrypoint tar "makeplane/plane-frontend:$REL" -C /usr/share/nginx/html -cf - . | tar -C divan-patch/src -xf -'
scp -q "$HERE/patch_logo.py" "$HOST:plane/divan-patch/patch_logo.py"
FOLDER=$(ssh "$HOST" 'cd ~/plane/divan-patch && python3 patch_logo.py src html.new && rm -rf src')
ssh "$HOST" 'cd ~/plane/divan-patch && mkdir -p html.new/divan-logos && rm -rf html.old && { [ -d html ] && mv html html.old || true; } && mv html.new html && rm -rf html.old assets logos'
scp -q "$HOME"/.divan/project-icons/*.png "$HOST:plane/divan-patch/html/divan-logos/"
ssh "$HOST" 'mkdir -p ~/plane/divan-patch/html/divan-logos/covers'
scp -q "$HERE"/covers/*.jpg "$HOST:plane/divan-patch/html/divan-logos/covers/"
ssh "$HOST" "cd ~/plane && cat > docker-compose.override.yml <<YML
# Written by divan/ops/plane/apply.sh — Divan's patches to Plane's web app:
# the whole built site, with the logo patch, under a fresh asset folder.
services:
  web:
    volumes:
      - ./divan-patch/html:/usr/share/nginx/html:ro
YML
docker compose -p plane --env-file plane.env up -d web >/dev/null 2>&1"
echo "patched into /$FOLDER; logos at /divan-logos/<slug>.png"
