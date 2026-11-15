/* The TV's own screen: overlay permission, the phone link (QR), and a test. D-pad: up/down moves between buttons. */
(function () {
  'use strict';
  // The TV's WebView ignores the viewport tag and may lay this page out at 960 CSS px: scale it to its 1920-wide design.
  const fit = () => { document.documentElement.style.zoom = String(window.innerWidth / 1920); };
  fit();
  window.addEventListener('resize', fit);
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('k') || '';
  const app = window.SidelineHome;                              // Java bridge (MainActivity); absent in a desktop browser
  const api = (path, opts) => fetch(path + (path.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(token), opts);
  const status = (text, bad) => { $('status').textContent = text; $('status').className = 'foot' + (bad ? ' err' : ''); };

  function drawQr(url) {
    if (!window.qrcode) return;
    const q = window.qrcode(0, 'M');
    q.addData(url);
    q.make();
    $('qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });   // library output, built from our own URL
  }

  async function refresh() {
    const allowed = app ? app.canDrawOverlays() : false;
    $('s1').className = allowed ? 'done' : 'todo';
    $('s1text').textContent = allowed ? 'Done. Sideline can sit over your games.'
      : 'Turn on "Display over other apps" for Sideline. It only draws its own box; it can\'t see or record what you watch.';
    $('allow').textContent = allowed ? 'Open the setting again' : 'Allow display over other apps';
    try {
      const info = await (await api('/api/info')).json();
      $('url').textContent = info.lanUrl ? info.lanUrl.replace(/^http:\/\//, '') : 'Connect the TV to Wi-Fi';
      if (info.lanUrl) drawQr(info.lanUrl);
      $('s2').className = info.configured ? 'done' : 'todo';
      status(info.configured ? `Set up with ${info.configured}. Change anything from your phone.` : 'Waiting for your phone…');
    } catch (e) { status('The Sideline service is not answering. Close and reopen the app.', true); }
  }

  $('allow').addEventListener('click', () => app && app.openOverlaySettings());
  $('newcode').addEventListener('click', () => { if (app && app.newCode) app.newCode(); });   // the page reloads with the new code
  $('test').addEventListener('click', async () => {
    try {
      const r = await (await api('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'test', kind: 'td' }) })).json();
      status(r.ok ? 'Sent. Press Home and the touchdown plays over whatever is on.' : (r.error || 'The box is not running yet: do step 1 first.'), !r.ok);
    } catch (e) { status(e.message, true); }
  });

  // D-pad: the WebView does not move focus between buttons by itself.
  const navs = () => [...document.querySelectorAll('[data-nav]')];
  document.addEventListener('keydown', (e) => {
    const list = navs();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length] || list[0];
      next.focus();
    }
  });

  window.__home = { refresh };                                  // MainActivity calls this when you come back from Settings
  refresh();
  setTimeout(() => (navs()[0] || document.body).focus(), 300);   // after the WebView has taken focus
  setInterval(refresh, 15000);
})();
