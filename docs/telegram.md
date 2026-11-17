# Telegram bot

Send or forward anything to your bot on Telegram and it lands in your inbox,
the same items a paste or a drop would make. The bot answers with a 👍
reaction on each message it saved, or 👎 and a reply saying why it couldn't.

## Setting it up

1. In Telegram, talk to [@BotFather](https://t.me/BotFather), send `/newbot`
   and follow the steps. It gives you the bot's token.
2. In BrainBro, as an admin, open **Settings, Telegram** and, under **Server
   bot** (only admins see it), paste the token and save. BrainBro checks it with Telegram (`getMe`), which also
   gives the bot's username, so there is nothing else to type.
3. Each person then opens **Settings, Telegram**, *Connect Telegram*, then
   *Open @your_bot in Telegram* and presses *Start*. The dialog shows the chat
   as connected.

Instead of step 2, the server can set `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_BOT_USERNAME` (without the `@`) in `stack.env` (see
[deployment.md](deployment.md#settings)). A bot saved in Settings wins over
them while it exists; **Remove this bot** disconnects it (`deleteWebhook`) and
goes back to the environment's bot, if there is one. The token is stored
encrypted with a key derived from `SECRET_KEY`: if that changes, save the
token again.

### Where Telegram delivers

Updates come by webhook, at `<public address>/api/telegram/webhook/`, the
[public address](deployment.md#public-address) set in Settings, Server,
General, so they come in the same way as every other request. Telegram only
delivers to HTTPS: without an `https://` public address there is no webhook,
and Server bot, in Settings, Telegram, says so. `TELEGRAM_WEBHOOK_URL` overrides the
address; with `APP_HTTPS=true` it defaults to
`https://<first APP_HOSTNAMES>/api/telegram/webhook/`.

BrainBro points the bot there (`setWebhook`) when the worker starts, when the
bot is saved in Settings and when the public address changes. Saving a
different bot first disconnects the one it replaces. If Cloudflare Access ever
sits in front of BrainBro, bypass it for `/api/telegram/webhook/`: Telegram
can't log in.

## What becomes what

See `apps/telegram/messages.py`.

- **Text**: one URL alone becomes a link (with its preview), anything else a
  note. Words that hide a link on Telegram (`text_link`) become Markdown links.
- **Photos** become images (the largest size Telegram has), with the caption
  as their text. Photos sent together, an album on Telegram, become an album:
  each one arrives as its own message, so `group_media` puts them together a
  few seconds after each, in the order they were sent, with the captions as
  the album's text. One that arrives late joins the album.
- **Files, videos, audio, voice messages, GIFs** become image, audio or file
  items, detected by content like any upload. Audio and voice messages get a
  player (see [Audio](audio.md)).
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
  which chat is linked; `DELETE` disconnects. Chats are linked by Telegram's
  chat id, which is the person's own: after switching to another bot, linked
  chats keep landing in the same inbox once their people press *Start* there.
- **Setting it up** (admins): `GET /api/server/telegram/` says which bot is in
  use, where it came from (`database` or `environment`) and the webhook
  address. `PUT {"bot_token"}` checks the token with `getMe` and saves it;
  `DELETE` removes it. The token is never sent back.
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
  `python manage.py telegram_poll`, with the bot saved in Settings or its
  token in `backend/.env`. It removes the webhook and long-polls instead
  (`getUpdates`); the webhook is set again the next time the worker starts or
  the bot is saved.
