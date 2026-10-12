/* ============================================================
   ONBOARDING TOUR — first-time teacher walkthrough
   ============================================================ */

const KEY = 'qp_tour_v1_completed';

const STEPS = [
  {
    target: null,
    title: 'Welcome to Quiz Platform Champ 👋',
    body: 'A quick 30-second tour. You can skip at any time.',
    placement: 'center',
  },
  {
    target: 'a[href="dashboard.html"]',
    title: '📊 Dashboard',
    body: 'Your home base — jump to anything from here.',
    placement: 'right',
  },
  {
    target: 'a[href="subjects.html"]',
    title: '📚 Subjects',
    body: 'Create subjects (e.g. Math 7), then add periods like "1st Quarter" or "Midterms".',
    placement: 'right',
  },
  {
    target: 'a[href="questions.html"]',
    title: '❓ Question Pool',
    body: 'Add questions here. Group them by topic so quizzes can pull a balanced mix.',
    placement: 'right',
  },
  {
    target: 'a[href="quizzes.html"]',
    title: '📝 Quizzes',
    body: 'Turn questions into shareable quizzes. Each gets a short code and a QR code.',
    placement: 'right',
  },
  {
    target: 'a[href="settings.html"]',
    title: '⚙️ Settings',
    body: 'Manage your account, change password, and see your usage counts.',
    placement: 'right',
  },
  {
    target: null,
    title: 'You\'re all set! 🚀',
    body: 'Ready to build your first quiz. Want to see this again? Open Settings.',
    placement: 'center',
  },
];

let currentStep = 0;
let els = null;

/* ---------- init ---------- */
function init() {
  // only run on admin pages (topbar or sidebar present)
  if (!document.querySelector('.topbar') && !document.querySelector('.sidebar')) return;

  // only once per browser
  try {
    if (localStorage.getItem(KEY) === '1') return;
  } catch (_) { return; }

  // wait a moment for the sidebar to build
  setTimeout(start, 500);
}

/* ---------- start ---------- */
function start() {
  if (els) return; // already running
  buildOverlay();
  currentStep = 0;
  showStep(0);
}

/* ---------- DOM ---------- */
function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'qp-tour-overlay';

  const spot = document.createElement('div');
  spot.className = 'qp-tour-spot';
  spot.style.display = 'none';

  const tip = document.createElement('div');
  tip.className = 'qp-tour-tip';
  tip.innerHTML = `
    <h3 id="qp-tour-title"></h3>
    <p id="qp-tour-body"></p>
    <div class="qp-tour-actions">
      <span id="qp-tour-progress" class="qp-tour-progress"></span>
      <button type="button" class="qp-tour-skip" id="qp-tour-skip">Skip</button>
      <button type="button" class="qp-tour-next" id="qp-tour-next">Next</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(spot);
  document.body.appendChild(tip);

  els = { overlay, spot, tip };

  document.getElementById('qp-tour-skip').addEventListener('click', finish);
  document.getElementById('qp-tour-next').addEventListener('click', () => {
    currentStep++;
    if (currentStep >= STEPS.length) finish();
    else showStep(currentStep);
  });
  overlay.addEventListener('click', finish);

  // Escape key skips
  const esc = (e) => {
    if (e.key === 'Escape') { document.removeEventListener('keydown', esc); finish(); }
  };
  document.addEventListener('keydown', esc);

  // cleanup on resize
  window.addEventListener('resize', () => {
    if (els) showStep(currentStep);
  });
}

/* ---------- show a step ---------- */
function showStep(idx) {
  const step = STEPS[idx];
  if (!step || !els) return;

  const { spot, tip } = els;

  document.getElementById('qp-tour-title').textContent = step.title;
  document.getElementById('qp-tour-body').textContent = step.body;
  document.getElementById('qp-tour-progress').textContent = `${idx + 1} / ${STEPS.length}`;
  document.getElementById('qp-tour-next').textContent =
    (idx === STEPS.length - 1) ? 'Finish' : 'Next';

  // no target → centered modal
  if (!step.target || window.innerWidth < 720) {
    spot.style.display = 'none';
    tip.style.top = '50%';
    tip.style.left = '50%';
    tip.style.transform = 'translate(-50%, -50%)';
    tip.style.width = 'min(340px, calc(100vw - 32px))';
    return;
  }

  const el = document.querySelector(step.target);
  if (!el) {
    // target missing → skip to next
    currentStep++;
    if (currentStep >= STEPS.length) finish();
    else showStep(currentStep);
    return;
  }

  // measure
  const rect = el.getBoundingClientRect();
  const pad = 6;

  spot.style.display = 'block';
  spot.style.top = (rect.top - pad) + 'px';
  spot.style.left = (rect.left - pad) + 'px';
  spot.style.width = (rect.width + pad * 2) + 'px';
  spot.style.height = (rect.height + pad * 2) + 'px';

  // position tooltip
  const tipWidth = 320;
  const gap = 18;
  let tipTop = rect.top;
  let tipLeft = rect.right + gap;

  // if it would overflow, place it below
  if (tipLeft + tipWidth > window.innerWidth - 12) {
    tipLeft = Math.max(12, rect.left);
    tipTop = rect.bottom + gap;
  }

  // clamp
  tipTop = Math.max(12, Math.min(tipTop, window.innerHeight - 220));
  tipLeft = Math.max(12, Math.min(tipLeft, window.innerWidth - tipWidth - 12));

  tip.style.transform = 'none';
  tip.style.top = tipTop + 'px';
  tip.style.left = tipLeft + 'px';
  tip.style.width = tipWidth + 'px';
}

/* ---------- finish ---------- */
function finish() {
  try { localStorage.setItem(KEY, '1'); } catch (_) {}
  if (!els) return;
  els.overlay.remove();
  els.spot.remove();
  els.tip.remove();
  els = null;
}

/* ---------- restart (called from Settings) ---------- */
function restart() {
  try { localStorage.removeItem(KEY); } catch (_) {}
  finish();
  setTimeout(start, 200);
}

// global handler for [data-action="restart-tour"]
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="restart-tour"]');
  if (!el) return;
  e.preventDefault();
  restart();
});

init();