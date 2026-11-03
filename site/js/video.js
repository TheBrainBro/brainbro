// The video under the hero shows a local poster, and swaps in YouTube's
// player only when pressed, so the page loads nothing from YouTube until then.
(() => {
  const button = document.querySelector('[data-video]');
  button.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${button.dataset.video}?autoplay=1&rel=0`;
    iframe.title = 'BrainBro in 90 seconds';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;

    const frame = document.createElement('div');
    frame.className = 'video';
    frame.append(iframe);
    button.replaceWith(frame);
  }, { once: true });
})();
