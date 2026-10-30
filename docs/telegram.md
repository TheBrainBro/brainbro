# Telegram bot

Send or forward anything to your bot on Telegram and it lands in your inbox,
the same items a paste or a drop would make. The bot answers with a 👍
reaction on each message it saved, or 👎 and a reply saying why it couldn't.

## Setting it up

1. In Telegram, talk to [@BotFather](https://t.me/BotFather), send `/newbot`
   and follow the steps. It gives you the bot's token and username.
2. In Portainer, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` (without
   the `@`) in the stack's environment, and redeploy.
3. In Brain, account menu → *Telegram* → *Connect Telegram*, then *Open
   @your_bot in Telegram* and press *Start*. The dialog shows the chat as
   connected.

When the worker starts it points the bot at
`https://<first APP_HOSTNAMES>/api/telegram/webhook/` (`setWebhook`), so
updates come in through the Cloudflare Tunnel like everything else.
`TELEGRAM_WEBHOOK_URL` overrides that address. If Cloudflare Access ever sits
in front of Brain, bypass it for `/api/telegram/webhook/`: Telegram can't log
in.

## What becomes what

See `apps/telegram/messages.py`.

- **Text**: one URL alone becomes a link (with its preview), anything else a
  note. Words that hide a link on Telegram (`text_link`) become Markdown links.
- **Photos** become images (the largest size Telegram has), with the caption
  as their text. Photos sent together, an album on Telegram, become an album:
  each one arrives as its own message, so `group_media` puts them together a
  few seconds after each, in the order they were sent, with the captions as
  the album's text. One that arrives late joins the album.
- **Files, videos, audio, voice messages, GIFs** become image or file items,
  detected by content like any upload.
- **Can't be kept**: stickers, locations, contacts, polls and the like (👎).
  Files over 20 MB, the most a bot can download through the Bot API (👎).
- Forwarded messages are saved like any other; who sent them first isn't
  kept.

## How it works

- **Connecting**: `POST /api/telegram/connect/` makes a one-time code (valid
  for an hour) and returns `https://t.me/<bot>?start=<code>`. Telegram sends
  the bot `/start <code>`, which links that chat to the account
  (`TelegramLink`). A chat belongs to one account; a new connection replaces
  the previous chat. `GET /api/telegram/` says whether the bot is set up and
  which chat is linked; `DELETE` disconnects.
- **Who can use it**: only the linked private chat. Anyone else writing to the
  bot is ignored, except `/start`, which answers how to connect.
- **Webhook**: `POST /api/telegram/webhook/`, without a session, only with the
  `X-Telegram-Bot-Api-Secret-Token` header Telegram sends. The secret is
  derived from `SECRET_KEY`, so there's nothing to configure. The view queues
  `process_update` and answers 200 at once; downloads happen in the worker.
- **Each message once**: Telegram retries deliveries; a linked chat keeps the
  last `update_id` it handled and skips anything older. The webhook is set
  with `max_connections=1`, so updates arrive in order.
- **Development**: there is no public URL, so run
  `python manage.py telegram_poll` with the token in `backend/.env`. It removes
  the webhook and long-polls instead (`getUpdates`); the production worker sets
  the webhook again the next time it starts.
