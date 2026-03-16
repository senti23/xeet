#!/usr/bin/env bash
set -euo pipefail

PORT=3001
BRANCH="claude/web3-data-pipeline-ISzWb"

echo "=== 1. Merging $BRANCH into master ==="
git checkout master
git merge "$BRANCH" --no-edit
echo ""

echo "=== 2. Pulling latest from origin/main ==="
git pull origin main --no-edit || echo "(no remote changes to pull)"
echo ""

echo "=== 3. Starting server ==="
cd server
npx tsx src/index.ts &
SERVER_PID=$!
cd ..

# Wait for server to be healthy
echo -n "Waiting for server"
for i in $(seq 1 60); do
  if curl -sf http://localhost:$PORT/api/health >/dev/null 2>&1; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 2
done

if ! curl -sf http://localhost:$PORT/api/health >/dev/null 2>&1; then
  echo " FAILED to start after 120s"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi
echo ""

# Give the first pipeline cycle a moment to persist sales
echo "Waiting for first pipeline cycle to complete..."
sleep 15
echo ""

echo "============================================"
echo "  TOP 20 CARDS BY XEET VOLUME"
echo "============================================"
curl -sf "http://localhost:$PORT/api/sales/top?limit=20&sort=xeet_volume" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log('#   Creator              Rarity     Xeet Vol   Xeet Sales  OS Vol(ETH)  OS Sales');
    console.log('-'.repeat(90));
    d.data.forEach((r,i) => {
      const num = String(i+1).padStart(2);
      const name = (r.displayName || r.creator_handle).padEnd(20).slice(0,20);
      const rar = r.rarity.padEnd(10);
      const xv = String(r.xeet_volume ?? 0).padStart(10);
      const xs = String(r.xeet_sales ?? 0).padStart(10);
      const ov = String(r.os_volume ?? 0).padStart(11);
      const os = String(r.os_sales ?? 0).padStart(9);
      console.log(num + '  ' + name + ' ' + rar + ' ' + xv + ' ' + xs + ' ' + ov + ' ' + os);
    });
  "

echo ""
echo "============================================"
echo "  TOP 20 CARDS BY OPENSEA VOLUME (ETH)"
echo "============================================"
curl -sf "http://localhost:$PORT/api/sales/top?limit=20&sort=os_volume" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log('#   Creator              Rarity     OS Vol(ETH)  OS Sales  Xeet Vol   Xeet Sales');
    console.log('-'.repeat(90));
    d.data.forEach((r,i) => {
      const num = String(i+1).padStart(2);
      const name = (r.displayName || r.creator_handle).padEnd(20).slice(0,20);
      const rar = r.rarity.padEnd(10);
      const ov = String(r.os_volume ?? 0).padStart(11);
      const os = String(r.os_sales ?? 0).padStart(9);
      const xv = String(r.xeet_volume ?? 0).padStart(10);
      const xs = String(r.xeet_sales ?? 0).padStart(10);
      console.log(num + '  ' + name + ' ' + rar + ' ' + ov + ' ' + os + ' ' + xv + ' ' + xs);
    });
  "

echo ""
echo "=== Done! Server running on PID $SERVER_PID (port $PORT) ==="
echo "    Stop with: kill $SERVER_PID"
