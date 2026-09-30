#!/bin/sh
set -eu
# Run on the deployment host after building the selected image.
# Refuse to replace an existing container implicitly; keep rollback deliberate.
image=${1:-uiproof:20260930}
if docker container inspect uiproof >/dev/null 2>&1; then
  echo 'Container uiproof already exists. Stop/rename it deliberately before replacing.' >&2
  exit 1
fi
install -d -o 1000 -g 1000 -m 700 /var/lib/uiproof/workbench
install -d -m 755 /opt/uiproof/bin
install -m 755 "$(dirname "$0")/mcp" /opt/uiproof/bin/mcp
docker run -d --name uiproof --restart unless-stopped --init \
  --network host --user 1000:1000 --read-only \
  --tmpfs /tmp:rw,nosuid,size=256m,uid=1000,gid=1000 \
  --shm-size=256m --memory=768m --memory-swap=1536m --cpus=1 --pids-limit=256 \
  --cap-drop=ALL --security-opt=no-new-privileges \
  -v /var/lib/uiproof:/data "$image"
