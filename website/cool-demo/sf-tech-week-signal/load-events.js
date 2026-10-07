(async function loadEventCatalog() {
  try {
    const response = await fetch('./data/mcp-events.json');
    if (!response.ok) throw new Error(`Event catalog request failed (${response.status})`);
    window.SF_TECH_WEEK_EVENTS = await response.json();
    const app = document.createElement('script');
    app.type = 'module';
    app.src = './app.js';
    document.body.appendChild(app);
  } catch (error) {
    document.querySelector('#runStatus').textContent = 'Event data unavailable';
    document.querySelector('#modelActivity').textContent = error instanceof Error ? error.message : 'Could not load the event catalog.';
  }
})();
