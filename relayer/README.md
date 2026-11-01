# Sevu relayer

Pays Polygon gas for Sevu deposits and withdrawals. It verifies every request off-chain and simulates it before sending. The contract does not trust the relayer: it cannot change an amount, owner or unlock date, and its key only ever holds POL.

## Run locally

```sh
npm ci
cp .env.example .env   # fill in values
npm run dev
```

## Tests

```sh
npm test                                   # unit tests
POLYGON_RPC=https://... npm run test:fork  # against SevuLock on an anvil Polygon fork
```

## Deploy on a VPS (systemd + Caddy)

```sh
sudo useradd --system --home /opt/sevu sevu
sudo mkdir -p /opt/sevu /etc/sevu
sudo git clone https://github.com/mystiquemide/sevu /opt/sevu
cd /opt/sevu/relayer && sudo npm ci && sudo npm run build
sudo install -m 600 -o sevu .env.example /etc/sevu/relayer.env   # then edit the values
sudo cp deploy/sevu-relayer.service /etc/systemd/system/
sudo systemctl enable --now sevu-relayer
curl -s localhost:8787/v1/health
```

Put `deploy/Caddyfile` (with your domain) in `/etc/caddy/Caddyfile` and reload Caddy to serve it over HTTPS.

## API

| Method | Path | Body |
|---|---|---|
| POST | `/v1/deposits` | `{ intent, intentSig, permit }` |
| POST | `/v1/withdrawals` | `{ lockId }` |
| GET | `/v1/health` | none |

Errors return `{ error: { code, message, data? } }`.
