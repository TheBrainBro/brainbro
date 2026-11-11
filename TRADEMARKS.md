# Trademarks

The BrainBro code is free software under the [GNU AGPL v3](LICENSE). The BrainBro name,
logo and mascot are not: they identify the official project, and the AGPL does not give
any right to use them. This policy says what you can do with them without asking.

## What the brand covers

- The name "BrainBro" and the wordmark.
- The logo and app icon.
- The mascot (the Blob), in any form: drawing, 3D model or animation.

## Brand files

These files are not covered by the AGPL. Copyright Carlos Lugones, all rights reserved,
except for the permissions below.

- `frontend/public/favicon.ico`, `frontend/public/favicon.svg`
- `frontend/public/icons/`
- `frontend/src/assets/brainbro-mascot.glb`
- The `Logo` and `Wordmark` artwork in `frontend/src/layout/Logo.tsx` (the rest of the
  file is code, under the AGPL)
- `site/brand/`
- `site/models/`
- `site/favicon.ico`, `site/favicon.svg`, `site/apple-touch-icon.png`, `site/og.png`,
  `site/video-poster.jpg`
- `docs/assets/readme-header-dark.png`, `docs/assets/readme-header-light.png`

You may keep these files in copies and forks of this repository, unmodified, and use them
as this policy allows.

## Allowed without asking

- **Running your own server.** Install BrainBro for yourself, your family, your team or
  your company, with the name and logo as they come. A subdomain such as
  `brainbro.example.com` is fine.
- **Redistributing the official version.** Share unmodified releases, images or packages
  under the BrainBro name, for example in an app store for self-hosted servers.
- **Referring to BrainBro.** Say in words that your project or service is "for BrainBro",
  "compatible with BrainBro" or "based on BrainBro", as long as it is true. Use the name,
  not the logo.
- **Talking about BrainBro.** Articles, reviews, tutorials, videos and talks can use the
  name and logo to refer to the project.

## Needs written permission

- Using the name or logo for a modified version (a fork), or in its name or branding.
- Offering BrainBro to others as a hosted service, free or paid, under the BrainBro name
  or with the logo. Hosting the software under your own brand is fine.
- Using "brainbro", or anything similar, in a domain you control (other than a subdomain
  for your own server), or in the name of a company, product or service.
- Registering BrainBro, or a similar name or logo, as a trademark, domain or account name.
- Selling merchandise with the name, logo or mascot.
- Anything that suggests your project, service or company is official or endorsed by
  BrainBro.

To ask for permission, email contact@carloslugones.com.

## Rebranding a fork

A modified version has to use its own name and artwork. To rebrand:

1. Replace the brand files listed above with your own, at the same paths.
2. Replace the artwork in `frontend/src/layout/Logo.tsx`. Both components are used across
   the app, so this one file changes the logo everywhere.
3. Change the name in the app strings (`frontend/src/i18n/`), the PWA manifest in
   `frontend/vite.config.ts` and the page title in `frontend/index.html`.
4. If you replace the mascot model, its idle animation must be named `BlinkIdle`, or
   remove that animation from `frontend/src/onboarding/MascotStage.tsx` and
   `site/js/mascot.js`.

When you say your fork is based on BrainBro, also say, just as visibly, that it is not
affiliated with or endorsed by BrainBro.

## Other trademarks

Names and logos of other products shown in BrainBro, such as Claude, ChatGPT, Grok,
Cursor, Obsidian, Telegram, Docker and Umbrel, belong to their owners. They appear only
to identify those products.
