// A blog's index: the top bar shows once the header scrolls away.
(() => {
  const bar = document.getElementById("site-topbar");
  const header = document.getElementById("site-header");
  if (!bar || !header || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([entry]) => {
    const shown = !entry.isIntersecting;
    bar.toggleAttribute("data-shown", shown);
    bar.inert = !shown;
  }).observe(header);
})();
