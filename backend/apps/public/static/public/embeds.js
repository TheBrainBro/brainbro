// A post embedded in a note takes the height its page reports
// (public/embed-height.js): only from the frame it came from, and only a number.
(() => {
  const MAX_HEIGHT = 4000;
  addEventListener("message", (event) => {
    const { data } = event;
    if (data?.type !== "brainbro:embed-height" || !Number.isFinite(data.height)) return;
    for (const frame of document.querySelectorAll(".link-embed-post iframe")) {
      if (frame.contentWindow !== event.source) continue;
      if (new URL(frame.src).origin !== event.origin) return;
      frame.style.height = `${Math.min(Math.max(data.height, 0), MAX_HEIGHT)}px`;
      return;
    }
  });
})();
