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

  // Tiles whose parts show one after another: `[data-step]` elements get
  // `on`, in document order (or the order given).
  function stepThrough(art, { order, gap = 450, after, pause = 3000 }) {
    const steps = order ?? [...art.querySelectorAll('[data-step]')];
    loop(art, {
      reset() {
        steps.forEach((step) => step.classList.remove('on'));
        after?.reset?.();
      },
      async script(run) {
        for (const step of steps) {
          await run.wait(gap);
          step.classList.add('on');
        }
        await after?.script?.(run);
      },
      pause,
    });
  }

  // Boards: a frame, cards dropped in, an arrow and a pen circling a sticky.
  stepThrough(document.querySelector('.art-board'), { gap: 550 });

  // Graph: notes join one by one, a new link forms, and links carry sparks.
  const graph = document.querySelector('.art-graph');
  const dots = [...graph.querySelectorAll('.g-dots circle')];
  const lines = [...graph.querySelectorAll('.g-lines path')];
  const label = graph.querySelector('.g-label');
  lines.forEach((line) => (line.dataset.dot = '3.5'));
  stepThrough(graph, {
    // Each line, then the dot at its far end; the last two lines link dots
    // already there.
    order: [dots[0], lines[0], dots[1], lines[1], dots[2], lines[2], dots[3], lines[3], dots[4], lines[4], dots[5], lines[5], dots[6], lines[6]],
    gap: 260,
    after: {
      reset() {
        label.classList.remove('on');
        lines[7].classList.remove('on');
      },
      async script(run) {
        await run.wait(700);
        lines[7].classList.add('on');
        label.classList.add('on');
        for (const line of [lines[7], lines[0], lines[3], lines[1]]) {
          await run.wait(250);
          await run.send(line, { duration: 600 });
        }
      },
    },
  });

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

  // --- Use cases ----------------------------------------------------------

  const USES = [
    {
      name: 'Plan a trip',
      steps: [
        ['inbox', 'Drop', 'For weeks, every link, photo and voice note about Lisbon goes to the inbox, unsorted.'],
        ['bot', 'Sort', '“Put everything about Lisbon in a collection.” Your assistant does it.'],
        ['board', 'Plan', 'Lay out the days on a board. Claude drafts the itinerary as a note.'],
        ['globe', 'Share', 'Publish the itinerary for your friends. On the road, ask any assistant what’s next.'],
      ],
    },
    {
      name: 'Research a topic',
      steps: [
        ['link', 'Collect', 'Articles, papers and videos about home solar, saved the moment you find them.'],
        ['note', 'Connect', 'Link notes to each other with [[wikilinks]]. The graph shows what ties together.'],
        ['search', 'Find', 'Search by meaning finds the piece about winter output, whatever words you use.'],
        ['bot', 'Summarize', 'Ask Claude to sum up what you saved. It writes the summary back as a note.'],
      ],
    },
    {
      name: 'Renovate a home',
      steps: [
        ['image', 'Drop', 'Photos of the kitchen, quotes as PDFs, a voice note after talking to the builder.'],
        ['folder', 'Sort', 'A Kitchen collection inside Projects, with quotes and ideas nested in it.'],
        ['board', 'Plan', 'A board with the layout, the tiles you like and the budget note side by side.'],
        ['history', 'Track', 'When the budget note changes, its history shows what changed and who changed it.'],
      ],
    },
    {
      name: 'Write and publish',
      steps: [
        ['phone', 'Capture', 'Ideas as they come, from the share sheet on your phone or a message on Telegram.'],
        ['note', 'Draft', 'Write in Markdown. An assistant suggests edits, and you can undo any of them.'],
        ['folder', 'Organize', 'A collection per series, in the order you want to publish.'],
        ['globe', 'Publish', 'Make a note public. Readers get a clean page at its own address.'],
      ],
    },
  ];
  const uses = document.querySelector('.uses');
  const useTabs = uses.querySelector('.use-tabs');
  const steps = uses.querySelector('.steps');
  let useIndex = 0;
  let stepIndex = -1;
  let useTimer = null;
  let rotate = true;

  useTabs.innerHTML = USES.map(
    (use, index) => `<button role="tab" type="button" aria-selected="${index === 0}" data-use="${index}">${use.name}</button>`,
  ).join('');
  const useButtons = [...useTabs.children];

  function showUse(index) {
    useIndex = index;
    stepIndex = -1;
    useButtons.forEach((button, i) => button.setAttribute('aria-selected', String(i === index)));
    steps.innerHTML = USES[index].steps
      .map(([name, title, text]) => `<li><span class="step-icon">${icon(name)}</span><b>${title}</b><p>${text}</p></li>`)
      .join('');
    replay(steps, 'swap');
    if (reduceMotion) steps.querySelectorAll('li').forEach((li) => li.classList.add('done'));
  }

  // Lights the steps one by one; after the last, the next use case, until
  // the visitor picks one.
  function advance() {
    stepIndex++;
    if (stepIndex >= USES[useIndex].steps.length) {
      if (!rotate) return;
      showUse((useIndex + 1) % USES.length);
      stepIndex = 0;
    }
    [...steps.children].forEach((li, i) => {
      li.classList.toggle('now', i === stepIndex);
      li.classList.toggle('done', i < stepIndex);
    });
    useTimer = setTimeout(advance, 2200);
  }

  useButtons.forEach((button) =>
    button.addEventListener('click', () => {
      rotate = false;
      clearTimeout(useTimer);
      showUse(Number(button.dataset.use));
      if (!reduceMotion) useTimer = setTimeout(advance, 300);
    }),
  );
  showUse(0);
  if (!reduceMotion) {
    onScreen(
      uses,
      () => {
        clearTimeout(useTimer);
        useTimer = setTimeout(advance, 400);
      },
      () => clearTimeout(useTimer),
    );
  }

  // --- Sections reached -----------------------------------------------------

  // Connect and Install light up their title when they come into view (from
  // the hero's buttons or by scrolling).
  for (const section of document.querySelectorAll('#connect, #install')) {
    const title = section.querySelector('h2');
    onScreen(section, () => replay(title, 'glow'), null, 0.5);
  }
})();
