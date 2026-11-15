// An embedded post tells the note that frames it how tall it is, each time
// that changes (apps.public.embeds). Only a number leaves this page.
(() => {
  if (window.parent === window) return;
  let last = 0;
  const report = () => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    // nosemgrep: wildcard-postmessage-configuration -- only a height, and the parent may be the app or any blog
    window.parent.postMessage({ type: "brainbro:embed-height", height }, "*");
  };
  new ResizeObserver(report).observe(document.documentElement);
})();
