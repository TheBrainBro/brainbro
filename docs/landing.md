# Landing page

The public page that explains Brain: `site/`. Plain HTML, CSS and JavaScript,
with no build step and no dependencies, so any static host can serve the
folder as is. Open `site/index.html` in a browser to see it.

- `index.html`: the content. Three animated scenes (drop anything into the
  inbox; Claude writes and ChatGPT reads it later; who wrote what, and
  restoring a version), the prompt that connects an assistant, and install
  links.
- `styles.css`: the app's colors (zinc and the logo's violet), light and dark
  from the system setting, one column on phones.
- `main.js`: plays the scenes and the *Copy prompt* button.

## Scenes

Each scene is a `.stage` that plays a step at a time while it is on screen,
then starts over. `data-steps` on the stage is how long each step lasts, in
milliseconds. Inside it:

- `data-at="n"`: shown from step `n` on (with a short appear animation).
- `data-until="n"`: hidden from step `n` on. With `data-at`, it shows only in
  between, which is how text swaps.
- `data-now="n m"`: highlighted (class `now`) only on those steps.

Step 0 is the starting state. The stage keeps the height of its tallest step,
so the page below doesn't move. With reduced motion, scenes show their last
step and don't play.

## Links

The prompt and the install links point to the docs on GitHub (`main`):
[mcp.md](mcp.md) for connecting assistants and
[deployment.md](deployment.md) for installing.
