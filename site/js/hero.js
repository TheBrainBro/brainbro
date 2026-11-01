// The hero: liquid violet marble behind (a WebGL shader) and a brain made of
// connected notes turning in front (canvas 2D). Both stop off screen, and
// draw a single frame with reduced motion.
(() => {
  const hero = document.querySelector('.hero');
  const { reduceMotion, onScreen } = Stage;
  let visible = true;

  // --- Marble -------------------------------------------------------------

  const FRAGMENT = `
    precision mediump float;
    uniform vec2 size;
    uniform float time;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / size.y;
      float t = time * 0.025;
      vec2 p = uv * 1.4;
      // Warping noise with noise gives the swirls of poured paint.
      vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
      vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.7),
                    fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.5));
      float f = fbm(p + 2.5 * r);
      // Streams running diagonally, bent by the swirls.
      float flow = (uv.x * 0.9 - uv.y * 1.6) + 2.2 * f;
      float band = 0.5 + 0.5 * sin(flow * 5.0);

      vec3 deep = vec3(0.30, 0.13, 0.58);
      vec3 violet = vec3(0.55, 0.36, 0.85);
      vec3 lavender = vec3(0.78, 0.68, 0.96);
      vec3 pink = vec3(0.92, 0.60, 0.86);
      vec3 milk = vec3(0.96, 0.93, 1.0);
      vec3 gold = vec3(0.88, 0.70, 0.38);

      vec3 color = mix(deep, violet, smoothstep(0.1, 0.7, band));
      color = mix(color, lavender, smoothstep(0.45, 0.95, band * f * 1.6));
      color = mix(color, pink, 0.45 * smoothstep(0.55, 0.9, r.x));
      color = mix(color, milk, 0.35 * smoothstep(0.8, 1.0, band) * smoothstep(0.4, 0.7, f));

      // Gold veins along some streams, with glitter around them.
      float line = abs(sin(flow * 2.5 + 1.3));
      float vein = smoothstep(0.07, 0.0, line) * smoothstep(0.35, 0.6, r.y);
      color = mix(color, gold, vein * 0.9);
      vec2 cell = floor(gl_FragCoord.xy / 2.0);
      float sparkle = step(0.985, hash(cell)) * smoothstep(0.35, 0.0, line)
        * (0.5 + 0.5 * sin(time * 2.0 + hash(cell) * 30.0));
      color = mix(color, vec3(1.0, 0.9, 0.6), sparkle * 0.8);

      gl_FragColor = vec4(color, 1.0);
    }`;

  function marble(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return null; // The CSS gradient behind stays.

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const size = gl.getUniformLocation(program, 'size');
    const time = gl.getUniformLocation(program, 'time');

    // Half resolution: the marble is soft, and it saves a lot of work.
    function resize() {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * 0.5));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * 0.5));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    new ResizeObserver(resize).observe(canvas);
    canvas.classList.add('ready');

    return (seconds) => {
      gl.uniform2f(size, canvas.width, canvas.height);
      gl.uniform1f(time, seconds + 40);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  // --- Brain --------------------------------------------------------------

  // Points on two half-ellipsoids with folds, linked to their nearest
  // neighbours, like notes linked to notes.
  function brainShape(count) {
    const points = [];
    while (points.length < count) {
      const side = points.length % 2 ? 1 : -1;
      const u = Math.random() * 2 - 1;
      const angle = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      let x = s * Math.cos(angle);
      const y = u;
      const z = s * Math.sin(angle);
      if (x * side < -0.35) continue; // The flat inner faces.
      const fold = 1 + 0.07 * Math.sin(9 * Math.atan2(z, y) + side) * Math.cos(7 * y);
      x = side * 0.34 + x * 0.42 * fold;
      if (x * side < 0.04) x = side * 0.04;
      points.push({
        x,
        y: y * 0.5 * fold * (y < -0.3 ? 0.85 : 1),
        z: z * 0.78 * fold,
        gold: Math.random() < 0.12,
      });
    }
    const edges = [];
    points.forEach((p, i) => {
      points
        .map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) }))
        .filter(({ j, d }) => j > i && d < 0.26)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .forEach(({ j }) => edges.push([i, j]));
    });
    return { points, edges };
  }

  function brain(canvas) {
    const ctx = canvas.getContext('2d');
    const { points, edges } = brainShape(window.innerWidth < 640 ? 170 : 240);
    const pulses = [];
    let tilt = { x: 0, y: 0 };
    let target = { x: 0, y: 0 };
    let lastPulse = 0;

    hero.addEventListener('pointermove', (event) => {
      const box = hero.getBoundingClientRect();
      target = {
        x: ((event.clientY - box.top) / box.height - 0.5) * 0.5,
        y: ((event.clientX - box.left) / box.width - 0.5) * 0.8,
      };
    });

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
    }
    resize();
    new ResizeObserver(resize).observe(canvas);

    return (seconds) => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      tilt.x += (target.x - tilt.x) * 0.05;
      tilt.y += (target.y - tilt.y) * 0.05;
      const turn = seconds * 0.25 + tilt.y;
      const lean = 0.25 + tilt.x;
      const [cosT, sinT, cosL, sinL] = [Math.cos(turn), Math.sin(turn), Math.cos(lean), Math.sin(lean)];
      const scale = Math.min(width, height) * 0.62;

      const projected = points.map((p) => {
        const x = p.x * cosT + p.z * sinT;
        const z0 = -p.x * sinT + p.z * cosT;
        const y = p.y * cosL - z0 * sinL;
        const z = p.y * sinL + z0 * cosL;
        const perspective = 2.6 / (2.6 + z);
        return {
          x: width / 2 + x * scale * perspective,
          y: height / 2 + y * scale * perspective,
          depth: (1 - z) / 2, // 0 at the back, 1 at the front.
          gold: p.gold,
        };
      });

      ctx.lineWidth = Math.max(1, width / 600);
      for (const [i, j] of edges) {
        const a = projected[i];
        const b = projected[j];
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 + 0.3 * Math.min(a.depth, b.depth)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const p of projected) {
        ctx.fillStyle = p.gold
          ? `rgba(250, 214, 140, ${0.4 + 0.6 * p.depth})`
          : `rgba(255, 255, 255, ${0.25 + 0.7 * p.depth})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (1 + 1.8 * p.depth) * (width / 500), 0, Math.PI * 2);
        ctx.fill();
      }

      // Thoughts: sparks running along the links.
      if (!reduceMotion && seconds - lastPulse > 0.12) {
        lastPulse = seconds;
        pulses.push({ edge: edges[Math.floor(Math.random() * edges.length)], start: seconds });
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let k = pulses.length - 1; k >= 0; k--) {
        const t = (seconds - pulses[k].start) / 0.7;
        if (t >= 1) {
          pulses.splice(k, 1);
          continue;
        }
        const a = projected[pulses[k].edge[0]];
        const b = projected[pulses[k].edge[1]];
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const radius = (width / 500) * 6;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, 'rgba(253, 224, 160, 0.9)');
        glow.addColorStop(1, 'rgba(253, 224, 160, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };
  }

  // --- Loop ---------------------------------------------------------------

  const draws = [marble(hero.querySelector('.marble')), brain(hero.querySelector('.brain-3d'))].filter(Boolean);
  const started = performance.now();

  function frame(now) {
    const seconds = (now - started) / 1000;
    draws.forEach((draw) => draw(seconds));
    if (visible && !reduceMotion) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  if (!reduceMotion) {
    onScreen(
      hero,
      () => {
        if (!visible) {
          visible = true;
          requestAnimationFrame(frame);
        }
      },
      () => (visible = false),
      0,
    );
  }
})();
