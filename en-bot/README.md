# Predictbet Telegram bot (English)

English replica of the French bot, aimed at Nigeria and other English-speaking African markets. Payments go through **Paystack** (NGN), not Tchin.

## What is different

- Entire bot + admin UI in English (no language switcher)
- Paystack checkout (`POST /transaction/initialize`) and webhook `POST /webhooks/paystack`
- Plans in **NGN** (kobo): weekly ₦5,000 · monthly ₦18,000 · yearly ₦180,000
- Admin / HTTP port **8789** (French bot stays on 8788)
- Timezone `Africa/Lagos`
- **Needs its own Telegram bot token** from BotFather — never reuse the French bot token

The match API (`PREDICTBET_API_URL`) stays the same: `http://187.77.101.57:59180`.

## Run locally

```bash
cd en-bot
cp .env.example .env
# fill TELEGRAM_BOT_TOKEN + Paystack keys
npm install
npm start
```

Admin: `http://127.0.0.1:8789/admin`

## Docker

```bash
cd en-bot
cp .env.example .env
docker compose up -d --build
```

## Paystack dashboard

1. Create a Paystack account (Nigeria or another supported country).
2. Copy test or live keys into `.env`.
3. Set webhook URL to `https://<your-domain>/webhooks/paystack`.
4. Set `PUBLIC_URL` to that same HTTPS origin.
5. Switch `PAYSTACK_ENV=live` only after live keys are in place.

Paystack signs webhooks with HMAC-SHA512 (`x-paystack-signature`). Test events are ignored when `PAYSTACK_ENV=live`.
