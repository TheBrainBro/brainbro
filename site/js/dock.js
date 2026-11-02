// The dock floats in once the hero's Install and Connect buttons leave the
// screen, and goes away when they come back.
(() => {
  const dock = document.querySelector('.dock');
  Stage.onScreen(
    document.querySelector('.hero .actions'),
    () => dock.classList.remove('shown'),
    () => dock.classList.add('shown'),
    0,
  );
})();
