# Security policy

## Supported versions

BrainBro is in its 0.x series. Only the latest release receives security fixes. Fixes
ship in a new release, not as patches to older versions, so the way to get one is to
upgrade to the latest release.

| Version        | Security fixes |
| -------------- | -------------- |
| Latest release | Yes            |
| Older releases | No             |

The latest release is listed on the
[releases page](https://github.com/TheBrainBro/brainbro/releases/latest).

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues, pull requests or
discussions.

Report them privately in one of these ways:

- **GitHub (preferred):** open the
  [Security tab](https://github.com/TheBrainBro/brainbro/security) of this repository
  and click **Report a vulnerability**. The report stays private between you and the
  maintainers, and you can follow and discuss the fix there.
- **Email:** write to [contact@carloslugones.com](mailto:contact@carloslugones.com) if
  you can't use GitHub.

Include as much of this as you can:

- The version of BrainBro, and how it is installed (Umbrel, Docker Compose, behind
  Cloudflare Tunnel or Caddy, local network only).
- What the vulnerability is and what an attacker could do with it.
- Steps to reproduce it, or a proof of concept.
- Any idea you have of how to fix it.

## What happens next

BrainBro is maintained by one person, so there are no guaranteed response times. Every
report is read, and we will reply as soon as we can.

Once a report is confirmed, the fix ships in a new release and is announced in a GitHub
security advisory. If you want, you are credited in the advisory.

Please keep the vulnerability private until the fix is released.
