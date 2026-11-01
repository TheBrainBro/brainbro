// Shared by the scenes: a script that plays while its stage is on screen,
// dashed lines between nodes, and a pointer that moves and clicks.
window.Stage = (() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class Stopped extends Error {}

  // Runs `whenVisible()` when `el` comes on screen and `whenHidden()` when it
  // leaves.
  function onScreen(el, whenVisible, whenHidden, threshold = 0.3) {
    new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? whenVisible() : whenHidden?.()),
      { threshold },
    ).observe(el);
  }

  // Plays `script(run)` in a loop while `el` is on screen, calling `reset()`
  // before each pass. Leaving the screen stops the script at its next await.
  // With reduced motion the script runs once, instantly, to its last frame.
  function loop(el, { reset, script, pause = 2600 }) {
    let current = 0;

    function makeRun(id) {
      const instant = reduceMotion;
      const check = () => {
        if (id !== current) throw new Stopped();
      };
      const run = {
        instant,
        async wait(ms) {
          if (!instant) await new Promise((resolve) => setTimeout(resolve, ms));
          check();
        },
        // Types `text` at the end of `target`, a character at a time.
        async type(target, text, speed = 45) {
          if (instant) {
            target.textContent += text;
            return check();
          }
          for (const char of text) {
            target.textContent += char;
            await run.wait(speed + Math.random() * speed * 0.8);
          }
        },
        async send(path, options) {
          if (!instant) await travel(path, options);
          check();
        },
        async point(pointer, target) {
          movePointer(pointer, target, instant);
          await run.wait(750);
        },
        async click(pointer) {
          pointer.classList.add('clicking');
          await run.wait(220);
          pointer.classList.remove('clicking');
        },
      };
      return run;
    }

    async function start() {
      const id = ++current;
      const run = makeRun(id);
      try {
        do {
          reset();
          await script(run);
          await run.wait(pause);
        } while (!run.instant);
      } catch (error) {
        if (!(error instanceof Stopped)) throw error;
      }
    }

    reset();
    if (reduceMotion) {
      start();
      return;
    }
    onScreen(el, start, () => current++);
  }

  // Draws each `path[data-from][data-to]` of the stage's svg.links as a curve
  // between the `[data-node]` elements it names: vertical when one is above
  // the other, horizontal otherwise, arriving across from where it left (as
  // far as the target's edge allows). Redraws when the stage changes size.
  function links(stage) {
    const svg = stage.querySelector('svg.links');
    const paths = [...svg.querySelectorAll('path')];
    const node = (name) => stage.querySelector(`[data-node="${name}"]`);
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    function draw() {
      const box = svg.getBoundingClientRect();
      for (const path of paths) {
        const a = node(path.dataset.from).getBoundingClientRect();
        const b = node(path.dataset.to).getBoundingClientRect();
        const ax = a.left + a.width / 2 - box.left;
        const ay = a.top + a.height / 2 - box.top;
        let d;
        if (a.bottom <= b.top || b.bottom <= a.top) {
          const down = a.bottom <= b.top;
          const y1 = (down ? a.bottom : a.top) - box.top;
          const y2 = (down ? b.top : b.bottom) - box.top;
          const x2 = clamp(ax, b.left - box.left + 24, b.right - box.left - 24);
          const mid = (y1 + y2) / 2;
          d = `M${ax} ${y1} C${ax} ${mid} ${x2} ${mid} ${x2} ${y2}`;
        } else {
          const right = a.left < b.left;
          const x1 = (right ? a.right : a.left) - box.left;
          const x2 = (right ? b.left : b.right) - box.left;
          const y2 = clamp(ay, b.top - box.top + 24, b.bottom - box.top - 24);
          const mid = (x1 + x2) / 2;
          d = `M${x1} ${ay} C${mid} ${ay} ${mid} ${y2} ${x2} ${y2}`;
        }
        path.setAttribute('d', d);
      }
    }

    new ResizeObserver(draw).observe(stage);
    draw();
    return (from, to = null) =>
      paths.find((p) => p.dataset.from === from && (!to || p.dataset.to === to));
  }

  // A dot running along `path` (backwards with reverse), while the path's
  // dashes flow.
  function travel(path, { reverse = false, duration = 750 } = {}) {
    const svg = path.ownerSVGElement;
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '5');
    dot.setAttribute('class', 'packet');
    svg.append(dot);
    path.classList.add('active', ...(reverse ? ['reverse'] : []));
    const length = path.getTotalLength();
    const started = performance.now();
    return new Promise((resolve) => {
      function frame(now) {
        const t = Math.min((now - started) / duration, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const point = path.getPointAtLength(length * (reverse ? 1 - eased : eased));
        dot.setAttribute('cx', point.x);
        dot.setAttribute('cy', point.y);
        if (t < 1) return requestAnimationFrame(frame);
        dot.remove();
        path.classList.remove('active', 'reverse');
        resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  // Moves the pointer (absolutely placed in its stage, its parent) so its tip sits on
  // the middle of `target`.
  function movePointer(pointer, target, instant) {
    const stage = pointer.parentElement.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const x = box.left + box.width / 2 - stage.left - 4;
    const y = box.top + box.height / 2 - stage.top - 2;
    pointer.style.transition = instant ? 'none' : '';
    pointer.style.opacity = '1';
    pointer.style.transform = `translate(${x}px, ${y}px)`;
  }

  return { reduceMotion, onScreen, loop, links, travel };
})();
