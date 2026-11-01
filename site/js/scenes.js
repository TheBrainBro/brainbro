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
  const chatHead = memory.querySelector('.chat-head');
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
        `<li class="mini trip enter">
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
      await run.type(day3.querySelector('.typed'), 'Day 3: Belém and pastéis');
      yourCaret.remove();
      const yours = addRev('you', '1 minute ago, on the web');
      setBy('you', 'Edited by you');
      await run.wait(1200);

      // ChatGPT changes another.
      const place = noteLines.querySelector('.place');
      const gptCaret = caret('ChatGPT', '#10a37f');
      place.after(gptCaret);
      await run.wait(600);
      place.classList.add('selected');
      await run.wait(700);
      place.classList.remove('selected');
      place.textContent = '';
      await run.type(place, 'Cascais beach', 60);
      gptCaret.remove();
      addRev('chatgpt', 'Just now, through MCP');
      setBy('chatgpt', 'Edited by ChatGPT');
      await run.wait(1300);

      // You go back to your version.
      await run.point(pointer, yours);
      await run.click(pointer);
      yours.classList.add('now');
      yours.insertAdjacentHTML('beforeend', `<span class="restore">${icon('undo')}Restore</span>`);
      const restore = yours.querySelector('.restore');
      await run.wait(500);
      await run.point(pointer, restore);
      await run.click(pointer);
      restore.remove();
      yours.classList.remove('now');
      place.textContent = 'Sintra';
      replay(noteLines.querySelector('.day2'), 'back');
      addRev('you', 'Restored your version');
      setBy('you', 'Restored by you');
      await run.wait(900);
      pointer.style.opacity = '0';
    },
    pause: 3000,
  });

  // --- Feature tiles ------------------------------------------------------

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
})();
