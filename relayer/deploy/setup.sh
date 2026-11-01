#!/usr/bin/env bash
# Sevu VPS setup: installs the relayer, creates its wallet, deploys SevuLock to Polygon and serves the relayer over HTTPS.
#
# Run as root on Debian or Ubuntu:
#   curl -fsSL https://raw.githubusercontent.com/mystiquemide/sevu/main/relayer/deploy/setup.sh -o setup.sh
#   sudo bash setup.sh
#
# Inputs (prompted when unset; secrets are read without echo):
#   SEVU_RPC_URL      Primary Polygon RPC, e.g. your Alchemy URL. Secret.
#   SEVU_DOMAIN       Domain that points at this server, e.g. relayer.example.com. Empty skips HTTPS.
#   SEVU_APP_ORIGINS  Comma-separated app origins allowed by CORS, e.g. https://sevu.vercel.app
#   SEVU_MIN_POL      POL the relayer wallet must hold before deploying. Default 1.
#   SEVU_FUND_WAIT    Seconds to wait for funding. Default 3600.
#   SEVU_REF          Git ref to deploy. Default main.
#
# The relayer private key is generated on this machine, written only to /etc/sevu/relayer.env (mode 640, root:sevu)
# and never printed. Safe to re-run: existing keys, deployments and config are kept.
set -euo pipefail

REPO_URL="${SEVU_REPO_URL:-https://github.com/mystiquemide/sevu}"
REF="${SEVU_REF:-main}"
APP_DIR="${SEVU_APP_DIR:-/opt/sevu}"
ENV_DIR="${SEVU_ENV_DIR:-/etc/sevu}"
ENV_FILE="$ENV_DIR/relayer.env"
USDT0=0xc2132D05D31c914a87C6611C10748AEb04B58e8F
FALLBACK_RPC=https://polygon-bor-rpc.publicnode.com
MIN_POL="${SEVU_MIN_POL:-1}"
FUND_WAIT="${SEVU_FUND_WAIT:-3600}"
# Test hook: SEVU_SKIP_SYSTEM=1 skips apt, users, systemd and Caddy so the wallet and deploy steps can run against a fork.
SKIP_SYSTEM="${SEVU_SKIP_SYSTEM:-0}"
CHAIN_ID_EXPECTED="${SEVU_CHAIN_ID:-137}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

env_get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
env_set() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp "$ENV_DIR/.relayer.env.XXXXXX")"
  { grep -vE "^$key=" "$ENV_FILE" 2>/dev/null || true; printf '%s=%s\n' "$key" "$val"; } > "$tmp"
  chmod 640 "$tmp"
  [ "$SKIP_SYSTEM" = 1 ] || chown root:sevu "$tmp"
  mv "$tmp" "$ENV_FILE"
}

[ "$(id -u)" -eq 0 ] || [ "$SKIP_SYSTEM" = 1 ] || die "Run as root (sudo bash setup.sh)."

# ---------------------------------------------------------------- inputs
if [ -z "${SEVU_RPC_URL:-}" ]; then
  existing="$(env_get POLYGON_RPC_URLS | cut -d, -f1)"
  if [ -n "$existing" ]; then SEVU_RPC_URL="$existing"
  else read -rsp 'Polygon RPC URL (Alchemy), input hidden: ' SEVU_RPC_URL; echo; fi
fi
[ -n "$SEVU_RPC_URL" ] || die "A Polygon RPC URL is required."
if [ -z "${SEVU_DOMAIN+x}" ]; then read -rp 'Relayer domain pointing at this server (empty to skip HTTPS): ' SEVU_DOMAIN; fi
if [ -z "${SEVU_APP_ORIGINS+x}" ]; then
  SEVU_APP_ORIGINS="$(env_get ALLOWED_ORIGINS)"
  [ -n "$SEVU_APP_ORIGINS" ] || read -rp 'App origin(s) for CORS, comma-separated (can be changed later): ' SEVU_APP_ORIGINS
fi

# ---------------------------------------------------------------- system packages
if [ "$SKIP_SYSTEM" != 1 ]; then
  say "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
    say "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi

  if ! command -v forge >/dev/null; then
    say "Installing Foundry (stable release binaries)"
    arch="$(uname -m)"; case "$arch" in x86_64) farch=amd64 ;; aarch64|arm64) farch=arm64 ;; *) die "Unsupported CPU $arch" ;; esac
    tmpd="$(mktemp -d)"
    curl -fsSL "https://github.com/foundry-rs/foundry/releases/download/stable/foundry_stable_linux_${farch}.tar.gz" -o "$tmpd/foundry.tgz"
    tar -xzf "$tmpd/foundry.tgz" -C /usr/local/bin forge cast anvil
    rm -r "$tmpd"
  fi

  if [ -n "$SEVU_DOMAIN" ] && ! command -v caddy >/dev/null; then
    say "Installing Caddy"
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi

  id sevu >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin sevu
  mkdir -p "$APP_DIR" "$ENV_DIR"
  chown sevu:sevu "$APP_DIR"
  chown root:sevu "$ENV_DIR"; chmod 750 "$ENV_DIR"
  [ -f "$ENV_FILE" ] || { install -m 640 -o root -g sevu /dev/null "$ENV_FILE"; }
else
  mkdir -p "$ENV_DIR"; [ -f "$ENV_FILE" ] || install -m 640 /dev/null "$ENV_FILE"
fi

as_sevu() { if [ "$SKIP_SYSTEM" = 1 ]; then bash -c "$1"; else runuser -u sevu -- bash -c "$1"; fi; }

# ---------------------------------------------------------------- code
if [ "$SKIP_SYSTEM" != 1 ]; then
  say "Fetching Sevu ($REF)"
  if [ -d "$APP_DIR/.git" ]; then
    as_sevu "cd $APP_DIR && git fetch -q origin $REF && git checkout -q $REF && git reset -q --hard origin/$REF && git submodule update -q --init --recursive"
  else
    as_sevu "git clone -q --recursive --branch $REF $REPO_URL $APP_DIR"
  fi
fi

say "Building and testing the contract"
as_sevu "cd $APP_DIR/contracts && forge build -q && forge test -q >/dev/null" || die "Contract tests failed."

say "Building and testing the relayer"
as_sevu "cd $APP_DIR/relayer && npm ci --silent && npm run -s build && npx vitest run --silent >/dev/null" || die "Relayer tests failed."

# ---------------------------------------------------------------- chain check
chain_id="$(cast chain-id --rpc-url "$SEVU_RPC_URL" 2>/dev/null)" || die "The RPC URL did not answer."
[ "$chain_id" = "$CHAIN_ID_EXPECTED" ] || die "The RPC URL is on chain $chain_id, expected $CHAIN_ID_EXPECTED (Polygon)."

# ---------------------------------------------------------------- relayer wallet
if [ -z "$(env_get RELAYER_PRIVATE_KEY)" ]; then
  say "Creating the relayer wallet (key stays in $ENV_FILE)"
  key="$(cast wallet new --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d)[0].private_key))')"
  env_set RELAYER_PRIVATE_KEY "$key"
  unset key
fi
# Derive the address in-process so the key never appears in a command line.
relayer_address="$(cd "$APP_DIR/relayer" && SEVU_KEY="$(env_get RELAYER_PRIVATE_KEY)" node --input-type=module -e \
  'import { privateKeyToAccount } from "viem/accounts"; process.stdout.write(privateKeyToAccount(process.env.SEVU_KEY).address)')"
echo "Relayer address: $relayer_address"

# ---------------------------------------------------------------- funding
min_wei="$(cast to-wei "$MIN_POL")"
balance() { cast balance "$relayer_address" --rpc-url "$SEVU_RPC_URL"; }
funded() { node -e "process.exit(BigInt('$(balance)') >= BigInt('$min_wei') ? 0 : 1)"; }
if ! funded; then
  say "Send at least $MIN_POL POL (Polygon) to $relayer_address. Waiting up to $FUND_WAIT s"
  waited=0
  until funded; do
    [ "$waited" -lt "$FUND_WAIT" ] || die "Not funded yet. Re-run this script after sending POL to $relayer_address."
    sleep 15; waited=$((waited + 15))
  done
fi
echo "Relayer balance: $(cast from-wei "$(balance)") POL"

# ---------------------------------------------------------------- contract
lock="$(env_get SEVU_LOCK_ADDRESS)"
if [ -z "$lock" ]; then
  say "Deploying SevuLock"
  as_sevu "cd $APP_DIR/contracts && DEPLOYER_PRIVATE_KEY=\"\$(grep -E '^RELAYER_PRIVATE_KEY=' $ENV_FILE | cut -d= -f2-)\" \
    forge script script/Deploy.s.sol --rpc-url \"$SEVU_RPC_URL\" --broadcast --slow -q" >/dev/null \
    || die "Deployment failed. Nothing was written; check the relayer balance and re-run."
  lock="$(node -e "const r=require('$APP_DIR/contracts/broadcast/Deploy.s.sol/$CHAIN_ID_EXPECTED/run-latest.json');const t=r.transactions.find(x=>x.contractName==='SevuLock');process.stdout.write(t.contractAddress)")"
  [ -n "$lock" ] || die "Could not read the deployed address."
  env_set SEVU_LOCK_ADDRESS "$(cast to-check-sum-address "$lock")"
  lock="$(env_get SEVU_LOCK_ADDRESS)"
fi
code="$(cast code "$lock" --rpc-url "$SEVU_RPC_URL")"
[ "${#code}" -gt 4 ] || die "No contract code at $lock."
token="$(cast call "$lock" 'token()(address)' --rpc-url "$SEVU_RPC_URL")"
[ "$(cast to-check-sum-address "$token")" = "$(cast to-check-sum-address "$USDT0")" ] || die "Contract at $lock is not a SevuLock for USDT0."
echo "SevuLock: $lock"

# ---------------------------------------------------------------- relayer config
env_set POLYGON_RPC_URLS "$SEVU_RPC_URL,$FALLBACK_RPC"
env_set USDT0_ADDRESS "$USDT0"
env_set ALLOWED_ORIGINS "$SEVU_APP_ORIGINS"
[ -n "$(env_get MAX_LOCK_AMOUNT)" ] || env_set MAX_LOCK_AMOUNT 10000000
[ -n "$(env_get DAILY_GAS_BUDGET_WEI)" ] || env_set DAILY_GAS_BUDGET_WEI 5000000000000000000
[ -n "$(env_get LOW_BALANCE_WEI)" ] || env_set LOW_BALANCE_WEI 1000000000000000000
[ -n "$(env_get PORT)" ] || env_set PORT 8787
port="$(env_get PORT)"

if [ "$SKIP_SYSTEM" = 1 ]; then
  say "SEVU_SKIP_SYSTEM=1: skipping systemd and Caddy"
  printf '\nSEVU_LOCK_ADDRESS=%s\nRELAYER_ADDRESS=%s\n' "$lock" "$relayer_address"
  exit 0
fi

# ---------------------------------------------------------------- service
say "Starting the relayer service"
install -m 644 "$APP_DIR/relayer/deploy/sevu-relayer.service" /etc/systemd/system/sevu-relayer.service
systemctl daemon-reload
systemctl enable -q sevu-relayer
systemctl restart sevu-relayer
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$port/v1/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$port/v1/health" || die "Relayer did not start. See: journalctl -u sevu-relayer -n 50"
echo

# ---------------------------------------------------------------- https
relayer_url="http://<server-ip>:$port (not exposed; set SEVU_DOMAIN for HTTPS)"
if [ -n "$SEVU_DOMAIN" ]; then
  if ss -ltnp 2>/dev/null | grep -E ':(80|443)\s' | grep -vq caddy; then
    echo "Another web server already uses port 80 or 443. Proxy https://$SEVU_DOMAIN to 127.0.0.1:$port yourself."
  else
    say "Configuring Caddy for https://$SEVU_DOMAIN"
    printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$SEVU_DOMAIN" "$port" > /etc/caddy/sevu.caddy
    grep -qxF 'import /etc/caddy/sevu.caddy' /etc/caddy/Caddyfile 2>/dev/null || {
      [ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
      printf '\nimport /etc/caddy/sevu.caddy\n' >> /etc/caddy/Caddyfile
    }
    caddy validate --config /etc/caddy/Caddyfile >/dev/null || die "Caddy config is invalid; see /etc/caddy/Caddyfile."
    systemctl enable -q caddy && systemctl reload caddy 2>/dev/null || systemctl restart caddy
    for _ in $(seq 1 60); do curl -fsS "https://$SEVU_DOMAIN/v1/health" >/dev/null 2>&1 && break; sleep 2; done
    if curl -fsS "https://$SEVU_DOMAIN/v1/health" >/dev/null 2>&1; then relayer_url="https://$SEVU_DOMAIN"
    else echo "HTTPS not answering yet. Check DNS for $SEVU_DOMAIN and: journalctl -u caddy -n 50"; relayer_url="https://$SEVU_DOMAIN (pending)"; fi
  fi
fi

cat <<EOF

================ Sevu setup complete ================
SEVU_LOCK_ADDRESS=$lock
RELAYER_URL=$relayer_url
RELAYER_ADDRESS=$relayer_address
Polygonscan: https://polygonscan.com/address/$lock
Logs: journalctl -u sevu-relayer -f
=====================================================
EOF
