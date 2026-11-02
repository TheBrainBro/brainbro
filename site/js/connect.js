// Connecting an assistant: tabs per app, and the visitor's BrainBro address
// filled into the prompts, the MCP URL and the Claude Code command.
(() => {
  const DOCS = 'https://github.com/CarlosLugones/brain/blob/main/docs/mcp.md';
  const EXAMPLE = 'https://brainbro.example.com';
  const STORAGE_KEY = 'brainbro-address';

  const input = document.getElementById('brainbro-address');
  const promptText = document.getElementById('prompt-text');
  const codeCommand = document.getElementById('code-command');
  const grokBotPrompt = document.getElementById('grokbot-prompt');

  function normalize(value) {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  function prompt(address) {
    const where = address
      ? `My BrainBro is at ${address}, so its MCP server is ${address}/api/mcp.`
      : "Ask me for my BrainBro's address (like https://brainbro.example.com). Its MCP server is that address plus /api/mcp.";
    return `I use BrainBro, a self-hosted second brain, as shared memory across my AI assistants. Help me connect you to it.

1. Read how BrainBro works with assistants: ${DOCS}
2. ${where}
3. Walk me through adding it as a custom connector in the app we are using now, one step at a time. I sign in to BrainBro to allow it.
4. Once connected, list my inbox to check it works.

From then on: search BrainBro before answering about my notes or plans, save what I ask you to remember, and read a note before editing it.`;
  }

  function fill() {
    const address = normalize(input.value);
    const mcp = `${address || EXAMPLE}/api/mcp`;
    promptText.textContent = prompt(address);
    codeCommand.textContent = `claude mcp add --transport http brainbro ${mcp}`;
    grokBotPrompt.textContent = `Add an MCP server by URL: ${mcp}. It's my BrainBro, a self-hosted second brain. Once it's connected, list my inbox to check it works.`;
    document.querySelectorAll('[data-mcp-url]').forEach((code) => (code.textContent = mcp));
    try {
      localStorage.setItem(STORAGE_KEY, input.value);
    } catch {
      // Storage blocked: the address just isn't remembered.
    }
  }

  try {
    input.value = localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    // As above.
  }
  input.addEventListener('input', fill);
  fill();

  // Tabs, with arrow keys between them.
  const tabs = [...document.querySelectorAll('#connect [role="tab"]')];
  function select(tab) {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
    }
  }
  tabs.forEach((tab, index) => {
    tab.tabIndex = index === 0 ? 0 : -1;
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = tabs[(index + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });

  // Copy buttons: data-copy names the element to copy; data-copy-mcp copies
  // the MCP URL next to it.
  async function copy(button, source) {
    const label = button.querySelector('.label') ?? button;
    const original = label.textContent;
    try {
      await navigator.clipboard.writeText(source.textContent);
      label.textContent = 'Copied';
    } catch {
      // No clipboard (plain http, old browsers): select it to copy by hand.
      const range = document.createRange();
      range.selectNodeContents(source);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      label.textContent = 'Selected';
    }
    button.classList.add('done');
    setTimeout(() => {
      label.textContent = original;
      button.classList.remove('done');
    }, 2000);
  }

  document.querySelectorAll('[data-copy]').forEach((button) =>
    button.addEventListener('click', () => copy(button, document.getElementById(button.dataset.copy))),
  );
  document.querySelectorAll('[data-copy-mcp]').forEach((button) =>
    button.addEventListener('click', () => copy(button, button.parentElement.querySelector('[data-mcp-url]'))),
  );
})();
