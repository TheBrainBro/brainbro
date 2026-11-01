// Scenes: each .stage plays its steps in a loop while it is on screen (see
// the comment above the first scene in index.html).
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setUpStage(stage) {
  const durations = stage.dataset.steps.split(',').map(Number);
  const last = durations.length - 1;
  const timed = [...stage.querySelectorAll('[data-at], [data-until]')];
  const highlighted = [...stage.querySelectorAll('[data-now]')];
  let step = 0;
  let timer = null;

  function show(n) {
    step = n;
    for (const el of timed) {
      const at = Number(el.dataset.at ?? 0);
      const until = el.dataset.until ? Number(el.dataset.until) : Infinity;
      el.hidden = n < at || n >= until;
    }
    for (const el of highlighted) {
      el.classList.toggle('now', el.dataset.now.split(' ').map(Number).includes(n));
    }
  }

  // Keep the page below from jumping: the stage is as tall as its tallest step.
  function reserveHeight() {
    const current = step;
    stage.style.minHeight = '';
    let tallest = 0;
    for (let n = 0; n <= last; n++) {
      show(n);
      tallest = Math.max(tallest, stage.offsetHeight);
    }
    stage.style.minHeight = `${tallest}px`;
    show(current);
  }

  function tick() {
    timer = setTimeout(() => {
      show(step === last ? 0 : step + 1);
      tick();
    }, durations[step]);
  }

  function play() {
    clearTimeout(timer);
    if (reduceMotion.matches) {
      show(last);
      return;
    }
    show(0);
    tick();
  }

  function stop() {
    clearTimeout(timer);
  }

  reserveHeight();
  show(reduceMotion.matches ? last : 0);
  return { stage, play, stop, reserveHeight };
}

const scenes = [...document.querySelectorAll('.stage')].map(setUpStage);

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const scene = scenes.find((s) => s.stage === entry.target);
      if (entry.isIntersecting) scene.play();
      else scene.stop();
    }
  },
  { threshold: 0.35 },
);
for (const scene of scenes) observer.observe(scene.stage);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => scenes.forEach((s) => s.reserveHeight()), 200);
});

// Copy buttons: data-copy names the element whose text goes to the clipboard.
for (const button of document.querySelectorAll('[data-copy]')) {
  const label = button.querySelector('.label');
  const original = label.textContent;
  button.addEventListener('click', async () => {
    const text = document.getElementById(button.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = 'Copied';
    } catch {
      // No clipboard (plain http, old browsers): select it to copy by hand.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(button.dataset.copy));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      label.textContent = 'Selected, copy it';
    }
    button.classList.add('done');
    setTimeout(() => {
      label.textContent = original;
      button.classList.remove('done');
    }, 2000);
  });
}
