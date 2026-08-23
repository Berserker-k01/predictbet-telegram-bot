# Predictbet Telegram Bot

Bot Telegram officiel de **Predictbet** : matchs, prédictions IA, crédits, abonnements et parrainage.

Il se connecte à l’API Predictbet existante (même backend que l’app web / APK).

## Prérequis

- Node.js 18+
- Un bot créé via [BotFather](https://t.me/BotFather)
- L’API Predictbet en ligne (`/api/health` OK)

## Installation

```bash
git clone https://github.com/Berserker-k01/predictbet-telegram-bot.git
cd predictbet-telegram-bot
cp .env.example .env
npm install
```

Édite `.env` :

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_BOT_SECRET=une-longue-chaine-secrete
PREDICTBET_API_URL=http://127.0.0.1:8787
PREDICTBET_WEB_URL=http://187.77.101.57:59180
```

`TELEGRAM_BOT_SECRET` doit être **identique** à celui du `.env` de l’API Predictbet.

```bash
npm start
```

Dans Telegram : ouvre le bot → `/start`.

## Commandes BotFather (`/setcommands`)

```
start - Menu Predictbet
matches - Matchs à venir
predictions - Prédictions IA
profile - Profil et crédits
help - Aide
```

## Docker

```bash
docker build -t predictbet-telegram-bot .
docker run --env-file .env -v predictbet-bot-data:/app/data predictbet-telegram-bot
```

Depuis le repo principal Predictbet :

```bash
docker compose --profile telegram up --build -d
```

## Fonctions

| Action | Détail |
|--------|--------|
| `/start` | Crée / reconnecte le compte Predictbet |
| `/start CODE` | Inscription avec code parrain |
| Matchs | Liste paginée, stade, arbitre, aperçu IA |
| Prédictions | 3 matchs visibles en Starter ; Pro/Enterprise = tout |
| Analyse complète | 1 crédit (même API que l’app) |
| Profil | Plan, crédits, lier un compte email |
| Abonnement | Demande d’upgrade |
| Parrainage | Code + lien `t.me/TonBot?start=CODE` |
| Langue | FR / EN / ES / RU |
| Rappels | Match dans moins de 90 min |
