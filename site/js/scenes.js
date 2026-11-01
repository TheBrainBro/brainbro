(() => {
  const { reduceMotion, onScreen, loop, links, travel } = Stage;

  const icon = (name) => `<svg><use href="#i-${name}" /></svg>`;
  const logo = (name) => `<svg class="logo"><use href="#l-${name}" /></svg>`;

  // Plays an element's entrance animation again.
  function replay(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  // --- 1. Drop anything ---------------------------------------------------

  const drop = document.querySelector('.drop-stage');
  const dropLink = links(drop);
  const cards = drop.querySelector('.cards');
  const count = drop.querySelector('.count');
  const ORDER = ['phone', 'browser', 'assistant', 'telegram'];
  const WAVE = [5, 9, 14, 8, 17, 11, 6, 13, 18, 10, 7, 12, 15, 8, 5];
  const ITEMS = {
    phone: [
      { kind: 'link', title: 'Sintra day trip guide', via: 'Shared from your phone' },
      { kind: 'image', title: 'tram-28.jpg', via: 'Photo from your phone' },
    ],
    browser: [
      { kind: 'file', title: 'Lisbon flights.pdf', via: 'Dropped in the browser' },
      { kind: 'link', title: 'Time Out Market, Lisbon', via: 'Pasted in the browser' },
    ],
    assistant: [
      { kind: 'note', title: 'Packing list for Lisbon', via: 'Written by your assistant', bot: true },
      { kind: 'note', title: 'Lisbon: 3 days, 3 areas', via: 'Written by your assistant', bot: true },
    ],
    telegram: [
      { kind: 'audio', title: 'Voice message, 0:42', via: 'Sent on Telegram' },
      { kind: 'link', title: 'Pastéis de Belém', via: 'Forwarded on Telegram' },
    ],
  };
  const KIND_ICON = { link: 'link', image: 'image', file: 'file', note: 'note', audio: 'mic' };
  const sent = Object.fromEntries(ORDER.map((source) => [source, 0]));
  let total = 0;
  let turn = 0;
  let timer = null;

  function card(item) {
    const li = document.createElement('li');
    li.className = 'card';
    let extra = '';
    if (item.kind === 'image') extra = '<span class="thumb"></span>';
    if (item.kind === 'audio') extra = `<span class="wave">${WAVE.map((h) => `<i style="height:${h}px"></i>`).join('')}</span>`;
    if (item.bot) extra = `<span class="bot-mark" title="Made by an assistant">${icon('bot')}</span>`;
    li.innerHTML = `<span class="kind">${icon(KIND_ICON[item.kind])}</span><span class="card-text"><b>${item.title}</b><small>${item.via}</small></span>${extra}`;
    return li;
  }

  function addCard(li) {
    cards.querySelector('.empty')?.remove();
    cards.prepend(li);
    count.textContent = ++total;
    if (!reduceMotion) {
      // In from the top, pushing the others down.
      li.animate(
        [
          { height: '0px', marginBottom: '-8px', opacity: 0, transform: 'translateY(-16px)' },
          { height: `${li.offsetHeight}px`, marginBottom: '0px', opacity: 1, transform: 'none' },
        ],
        { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
    // The ones pushed out of the window go.
    [...cards.children].slice(6).forEach((old) => old.remove());
  }

  async function dropFrom(source) {
    const items = ITEMS[source];
    const item = items[sent[source]++ % items.length];
    const device = drop.querySelector(`[data-source="${source}"]`);
    device.classList.add('now');
    if (!reduceMotion) await travel(dropLink(source));
    device.classList.remove('now');
    addCard(card(item));
  }

  function autoplay(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      dropFrom(ORDER[turn++ % ORDER.length]);
      autoplay(2200);
    }, delay);
  }

  for (const device of drop.querySelectorAll('[data-source]')) {
    device.addEventListener('click', () => {
      dropFrom(device.dataset.source);
      if (!reduceMotion) autoplay(5000);
    });
  }

  if (reduceMotion) ORDER.forEach((source) => addCard(card(ITEMS[source][0])));
  else onScreen(drop, () => autoplay(600), () => clearTimeout(timer));

  // --- 2. Shared memory for every assistant -------------------------------

  const memory = document.querySelector('.memory-stage');
  const memoryLink = links(memory);
  const items = memory.querySelector('.items');
  const chatHead = memory.querySelector('.chat .chat-head');
  const messages = memory.querySelector('.messages');
  const ASSISTANTS = {
    claude: { name: 'Claude', logo: 'claude' },
    chatgpt: { name: 'ChatGPT', logo: 'openai' },
    grok: { name: 'Grok', logo: 'grok' },
  };

  function talkTo(who) {
    const { name, logo: mark } = ASSISTANTS[who];
    chatHead.innerHTML = `<span class="logo-badge small">${logo(mark)}</span>${name}`;
    messages.innerHTML = '';
    memory.querySelectorAll('.assistant').forEach((a) => a.classList.toggle('now', a.dataset.node === who));
  }

  function message(html, className) {
    const p = document.createElement('p');
    p.className = className;
    p.innerHTML = html;
    messages.append(p);
    return p;
  }

  loop(memory, {
    reset() {
      items.innerHTML = `
        <li class="mini faded"><b>Reading list</b><span>12 links</span></li>
        <li class="mini faded"><b>Kitchen renovation</b><span>Board, 18 cards</span></li>`;
      chatHead.innerHTML = '';
      messages.innerHTML = '';
      memory.querySelectorAll('.assistant').forEach((a) => a.classList.remove('now'));
    },
    async script(run) {
      await run.wait(500);
      talkTo('claude');
      message('Remember our Lisbon plan: Alfama on day 1, Sintra on day 2.', 'bubble me');
      await run.wait(1200);
      message(`${icon('note')}capture`, 'tool');
      await run.send(memoryLink('claude'));
      items.insertAdjacentHTML(
        'afterbegin',
        `<li class="mini trip-note enter">
          <b>Lisbon trip</b>
          <span class="trip-lines"><span>Day 1: Alfama</span><span>Day 2: Sintra</span></span>
          <small class="by">${logo('claude')}Added by Claude</small>
        </li>`,
      );
      const trip = items.firstElementChild;
      await run.wait(600);
      message('Saved to your Brain as <b>Lisbon trip</b>.', 'bubble');
      await run.wait(2000);

      talkTo('grok');
      message('Add a dinner spot for day 1.', 'bubble me');
      await run.wait(1100);
      message(`${icon('note')}edit_note`, 'tool');
      await run.send(memoryLink('grok'));
      trip.querySelector('.trip-lines').insertAdjacentHTML('beforeend', '<span class="new">Dinner: Taberna do Largo</span>');
      trip.querySelector('.by').innerHTML = `${logo('grok')}Edited by Grok`;
      await run.wait(600);
      message('Added Taberna do Largo to day 1 in <b>Lisbon trip</b>.', 'bubble');
      await run.wait(2000);

      talkTo('chatgpt');
      message('Two weeks later', 'later');
      message('Where are we having dinner on day 1?', 'bubble me');
      await run.wait(1200);
      message(`${icon('search')}search_items`, 'tool');
      trip.classList.add('now');
      await run.send(memoryLink('chatgpt'), { reverse: true });
      await run.wait(300);
      message('At Taberna do Largo. It’s in your note <b>Lisbon trip</b>, added by Grok.', 'bubble');
    },
    pause: 3200,
  });

  // --- 3. Who wrote what, and going back ----------------------------------

  const restoreStage = document.querySelector('.history-stage');
  const noteLines = restoreStage.querySelector('.lines');
  const noteBy = restoreStage.querySelector('.note-by');
  const revs = restoreStage.querySelector('.revs');
  const pointer = restoreStage.querySelector('.pointer');
  const WHO = {
    you: { mark: icon('user'), name: 'You' },
    claude: { mark: logo('claude'), name: 'Claude' },
    chatgpt: { mark: logo('openai'), name: 'ChatGPT' },
  };

  function addRev(who, when) {
    revs.insertAdjacentHTML(
      'afterbegin',
      `<li class="rev enter">${WHO[who].mark}<span><b>${WHO[who].name}</b><small>${when}</small></span></li>`,
    );
    return revs.firstElementChild;
  }

  function setBy(who, text) {
    noteBy.innerHTML = `${WHO[who].mark}${text}`;
  }

  function caret(name, color) {
    const span = document.createElement('span');
    span.className = 'caret';
    span.dataset.who = name;
    span.style.setProperty('--who', color);
    return span;
  }

  loop(restoreStage, {
    reset() {
      noteLines.innerHTML = `
        <li>Day 1: Alfama and the castle</li>
        <li class="day2">Day 2: <span class="place">Sintra</span></li>
        <li class="day3" hidden><span class="typed"></span></li>`;
      revs.innerHTML = '';
      addRev('claude', '2 weeks ago, through MCP').classList.remove('enter');
      setBy('claude', 'Added by Claude');
      pointer.style.transition = 'none';
      pointer.style.opacity = '0';
      pointer.style.transform = `translate(${restoreStage.clientWidth - 40}px, ${restoreStage.clientHeight - 20}px)`;
    },
    async script(run) {
      await run.wait(900);

      // You write a line.
      const day3 = noteLines.querySelector('.day3');
      day3.hidden = false;
      const yourCaret = caret('You', 'var(--accent)');
      day3.append(yourCaret);
      await run.type(day3.querySelector('.typed'), 'Day 3: Belém and pastéis', 60);
      yourCaret.remove();
      const yours = addRev('you', '1 minute ago, on the web');
      setBy('you', 'Edited by you');
      await run.wait(1500);

      // ChatGPT changes another.
      const place = noteLines.querySelector('.place');
      const gptCaret = caret('ChatGPT', '#10a37f');
      place.after(gptCaret);
      await run.wait(700);
      place.classList.add('selected');
      await run.wait(900);
      place.classList.remove('selected');
      place.textContent = '';
      await run.type(place, 'Cascais beach', 75);
      gptCaret.remove();
      addRev('chatgpt', 'Just now, through MCP');
      setBy('chatgpt', 'Edited by ChatGPT');
      await run.wait(1800);

      // You go back to your version: pick it, then Restore.
      await run.point(pointer, yours.querySelector('b'));
      await run.click(pointer, yours);
      yours.classList.add('now');
      yours.insertAdjacentHTML('beforeend', `<span class="restore">${icon('undo')}Restore</span>`);
      const restore = yours.querySelector('.restore');
      await run.wait(900);
      await run.point(pointer, restore);
      await run.click(pointer, restore);
      restore.remove();
      yours.classList.remove('now');
      place.textContent = 'Sintra';
      replay(noteLines.querySelector('.day2'), 'back');
      addRev('you', 'Restored your version');
      setBy('you', 'Restored by you');
      await run.wait(1200);
      pointer.style.opacity = '0';
    },
    pause: 3200,
  });

  // --- Feature tiles ------------------------------------------------------

  // Boards: a frame and cards dropped in, a connection drawn between two
  // cards, then a pencil circling the sticky note and ticking it.
  const board = document.querySelector('.art-board');
  const ink = board.querySelector('.b-ink');
  const connect = board.querySelector('.b-connect');
  const strokes = [...board.querySelectorAll('.b-pen')];
  const pencil = board.querySelector('.b-pencil');
  const boardParts = [...board.querySelectorAll('[data-step]')];

  // Draws `path` over `duration` ms, with the pencil on its tip if `pen`.
  function draw(run, path, duration, pen) {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    if (run.instant) {
      path.style.strokeDashoffset = '0';
      return run.wait(0);
    }
    const box = ink.getBoundingClientRect();
    const canvas = ink.parentElement.getBoundingClientRect();
    const { width, height } = ink.viewBox.baseVal;
    const started = performance.now();
    return new Promise((resolve) => {
      function frame(now) {
        const t = Math.min((now - started) / duration, 1);
        path.style.strokeDashoffset = `${length * (1 - t)}`;
        if (pen) {
          const point = path.getPointAtLength(length * t);
          const x = box.left - canvas.left + (point.x / width) * box.width;
          const y = box.top - canvas.top + (point.y / height) * box.height;
          pencil.style.transform = `translate(${x}px, ${y - 20}px)`;
        }
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    }).then(() => run.wait(0));
  }

  loop(board, {
    reset() {
      boardParts.forEach((part) => part.classList.remove('on'));
      for (const path of [connect, ...strokes]) {
        path.style.strokeDasharray = '10000';
        path.style.strokeDashoffset = '10000';
      }
      connect.classList.remove('on');
      pencil.classList.remove('on');
    },
    async script(run) {
      for (const part of boardParts) {
        await run.wait(500);
        part.classList.add('on');
      }
      await run.wait(500);
      connect.classList.add('on');
      await draw(run, connect, 700);
      await run.wait(500);
      pencil.classList.add('on');
      for (const stroke of strokes) {
        await draw(run, stroke, stroke === strokes[0] ? 1300 : 450, true);
        await run.wait(200);
      }
      await run.wait(400);
      pencil.classList.remove('on');
    },
    pause: 2800,
  });

  // Graph: all there at once, as in the app, drifting a little like a live
  // layout, with sparks running along the links.
  const graph = document.querySelector('.art-graph');
  const graphLines = graph.querySelector('.g-lines');
  const graphDots = graph.querySelector('.g-dots');
  const NODES = [
    [120, 72, 9], [60, 40, 6], [190, 46, 6], [84, 118, 6], [168, 112, 6], [30, 86, 4], [214, 98, 4], [140, 24, 4],
  ];
  const EDGES = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [2, 6], [3, 4], [4, 6], [0, 7], [2, 7]];
  const SVG = 'http://www.w3.org/2000/svg';
  const dots = NODES.map(([cx, cy, r], index) => {
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('r', r);
    if (index === 0) dot.setAttribute('class', 'hub');
    graphDots.append(dot);
    return { dot, cx, cy, phase: index * 1.7 };
  });
  const edges = EDGES.map(([a, b]) => {
    const path = document.createElementNS(SVG, 'path');
    path.dataset.dot = '3';
    graphLines.append(path);
    return { path, a, b };
  });

  function layout(seconds) {
    const at = dots.map(({ dot, cx, cy, phase }) => {
      const x = cx + Math.sin(seconds * 0.8 + phase) * 3;
      const y = cy + Math.cos(seconds * 0.6 + phase * 1.3) * 3;
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      return [x, y];
    });
    for (const { path, a, b } of edges) path.setAttribute('d', `M${at[a][0]} ${at[a][1]} L${at[b][0]} ${at[b][1]}`);
  }

  layout(0);
  if (!reduceMotion) {
    let drifting = false;
    let sparks = null;
    const started = performance.now();
    const frame = (now) => {
      layout((now - started) / 1000);
      if (drifting) requestAnimationFrame(frame);
    };
    onScreen(
      graph,
      () => {
        drifting = true;
        requestAnimationFrame(frame);
        sparks = setInterval(() => {
          const { path } = edges[Math.floor(Math.random() * edges.length)];
          travel(path, { reverse: Math.random() < 0.5, duration: 900 });
        }, 700);
      },
      () => {
        drifting = false;
        clearInterval(sparks);
      },
    );
  }

  // Markdown: typed on the left, rendered on the right as each line ends;
  // then a box ticked in the preview changes the source too.
  const markdown = document.querySelector('.art-md');
  const mdSource = markdown.querySelector('.md-src');
  const mdOutput = markdown.querySelector('.md-out');
  const mark = (text) => `<span class="md-mark">${text}</span>`;
  const MD_LINES = [
    { text: '# Lisbon trip', source: `${mark('#')} Lisbon trip`, output: '<b class="md-h">Lisbon trip</b>' },
    { text: '- [x] Book tram 28', source: `${mark('- [x]')} Book tram 28`, output: '<span class="md-task"><i class="box done"></i>Book tram 28</span>' },
    { text: '- [ ] Pastéis de Belém', source: `${mark('- [ ]')} Pastéis de Belém`, output: '<span class="md-task"><i class="box"></i>Pastéis de Belém</span>' },
    { text: '**Day 2**: Sintra', source: `${mark('**')}Day 2${mark('**')}: Sintra`, output: '<span><strong>Day 2</strong>: Sintra</span>' },
    { text: '> Take the 8:10 train', source: `${mark('&gt;')} Take the 8:10 train`, output: '<span class="md-quote">Take the 8:10 train</span>' },
  ];
  loop(markdown, {
    reset() {
      mdSource.innerHTML = '';
      mdOutput.innerHTML = '';
    },
    async script(run) {
      const lines = [];
      for (const line of MD_LINES) {
        const div = document.createElement('div');
        const typed = document.createElement('span');
        div.append(typed, caret('', 'var(--accent)'));
        mdSource.append(div);
        await run.type(typed, line.text, 32);
        div.innerHTML = line.source;
        mdOutput.insertAdjacentHTML('beforeend', line.output);
        mdOutput.lastElementChild.classList.add('enter');
        lines.push(div);
        await run.wait(250);
      }
      await run.wait(900);
      mdOutput.querySelectorAll('.box')[1].classList.add('done');
      lines[2].innerHTML = `${mark('- [x]')} Pastéis de Belém`;
      replay(lines[2], 'back');
    },
    pause: 3200,
  });

  // Obsidian: a vault's folders and notes cross into Brain, then everything
  // goes back out as a vault, boards included.
  const vault = document.querySelector('.art-vault');
  const vaultLink = links(vault);
  const vaultList = vault.querySelector('[data-node="vault"] .v-list');
  const brainList = vault.querySelector('[data-node="brain"] .v-list');
  const vaultLabel = vault.querySelector('.v-label');
  const VAULT = [
    { from: `${icon('folder')}Travel/`, to: `${icon('folder')}Travel` },
    { from: `${icon('folder')}Recipes/`, to: `${icon('folder')}Recipes` },
    { from: `${icon('note')}Ideas.md`, to: `${icon('inbox')}Ideas` },
  ];
  loop(vault, {
    reset() {
      vaultList.innerHTML = VAULT.map((item) => `<li>${item.from}</li>`).join('');
      brainList.innerHTML = '';
      vaultLabel.textContent = '';
    },
    async script(run) {
      await run.wait(600);
      vaultLabel.textContent = 'Import';
      replay(vaultLabel, 'enter');
      const rows = [...vaultList.children];
      for (const [index, item] of VAULT.entries()) {
        rows[index].classList.add('now');
        await run.send(vaultLink('vault'), { duration: 650 });
        rows[index].classList.remove('now');
        brainList.insertAdjacentHTML('beforeend', `<li class="enter">${item.to}</li>`);
        await run.wait(250);
      }
      await run.wait(1100);
      vaultLabel.textContent = 'Export';
      replay(vaultLabel, 'enter');
      brainList.querySelectorAll('li').forEach((li) => li.classList.add('now'));
      await run.send(vaultLink('vault'), { reverse: true, duration: 800 });
      brainList.querySelectorAll('li').forEach((li) => li.classList.remove('now'));
      vaultList.insertAdjacentHTML('beforeend', `<li class="enter new">${icon('board')}Lisbon.canvas</li>`);
    },
    pause: 3000,
  });

  const search = document.querySelector('.art-search');
  const query = search.querySelector('.s-query');
  loop(search, {
    reset() {
      query.textContent = '';
      search.classList.remove('found');
    },
    async script(run) {
      await run.wait(600);
      await run.type(query, 'beach day near Lisbon', 70);
      await run.wait(400);
      search.classList.add('found');
    },
    pause: 3500,
  });

  const published = document.querySelector('.art-public');
  loop(published, {
    reset() {
      published.classList.remove('on');
    },
    async script(run) {
      await run.wait(1400);
      published.classList.add('on');
    },
    pause: 3500,
  });

  // The search shortcut as the visitor's keyboard has it.
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform ?? navigator.platform);
  document.querySelectorAll('[data-shortcut]').forEach((el) => (el.textContent = mac ? '⌘K' : 'Ctrl+K'));

  // --- Sections reached -----------------------------------------------------

  // Connect and Install light up their title when they come into view (from
  // the hero's buttons or by scrolling).
  for (const section of document.querySelectorAll('#connect, #install')) {
    const title = section.querySelector('h2');
    onScreen(section, () => replay(title, 'glow'), null, 0.5);
  }
})();
