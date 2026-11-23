/* ============================================================
   Spacecraft OS Failure Simulator
   Case study: onboard computer failure investigation (Team 6, CS10)

   Implements the scheduling model from the report:
     FCFS | Priority (non-preemptive) | Priority (preemptive) | Round Robin
   plus utilisation / rate-monotonic analysis and an incident replay.
   ============================================================ */

'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- default data (report values) ---------------- */

const reportWorkload = () => [
  { id: 'storage', name: 'P_storage', arrival: 0, burst: 40, priority: 4, deadline: null },
  { id: 'comm', name: 'P_comm', arrival: 0, burst: 20, priority: 3, deadline: null },
  { id: 'nav', name: 'P_nav', arrival: 5, burst: 30, priority: 1, deadline: 45 }
];

const reportUtil = [
  { name: 'P_sensor (ISR)', C: 1, T: 10 },
  { name: 'P_nav', C: 30, T: 100 },
  { name: 'P_comm', C: 20, T: 100 },
  { name: 'P_storage', C: 34, T: 100 },
  { name: 'P_watchdog', C: 2, T: 50 }
];

/* ---------------- state ---------------- */

let workload = reportWorkload();
let algo = 'fcfs';
let quantum = 10;

/* ============================================================
   Scheduling engine
   ============================================================ */

function bestReadyIndex(ready, tasks) {
  let best = -1;
  for (let i = 0; i < ready.length; i++) {
    const idx = ready[i];
    if (best < 0) { best = i; continue; }
    const a = tasks[idx];
    const b = tasks[ready[best]];
    if (a.priority < b.priority) best = i;
    else if (a.priority === b.priority) {
      if (a.arrival < b.arrival) best = i;
      else if (a.arrival === b.arrival && idx < ready[best]) best = i;
    }
  }
  return best;
}

/**
 * Discrete 1 ms tick simulation.
 * Lower priority number = higher priority.
 * @returns {{segments:Array, tasks:Array, total:number, idle:number, switches:number, avgWT:number, avgTAT:number}}
 */
function simulate(tasks, algorithm, q) {
  const n = tasks.length;
  const rem = tasks.map(t => Math.max(0, Math.round(t.burst)));
  const finish = new Array(n).fill(null);
  const ready = [];
  const segments = [];
  let current = null;
  let slice = 0;

  const order = tasks.map((t, i) => i)
    .sort((a, b) => tasks[a].arrival - tasks[b].arrival || a - b);
  let nextArrival = 0;
  let idle = 0;

  const horizon = tasks.reduce((s, t) => s + t.arrival + Math.max(0, t.burst), 0) + 2;

  for (let t = 0; t < horizon; t++) {
    // 1. arrivals become ready
    while (nextArrival < n && tasks[order[nextArrival]].arrival <= t) {
      ready.push(order[nextArrival]);
      nextArrival++;
    }

    // 2. preemption check (preemptive priority only)
    if (algorithm === 'prioP' && current !== null && rem[current] > 0) {
      const bi = bestReadyIndex(ready, tasks);
      if (bi >= 0 && tasks[ready[bi]].priority < tasks[current].priority) {
        ready.push(current);
        current = null;
        slice = 0;
      }
    }

    // 3. dispatch if the CPU is free
    if (current === null && ready.length > 0) {
      if (algorithm === 'fcfs' || algorithm === 'rr') {
        current = ready.shift();
      } else {
        const bi = bestReadyIndex(ready, tasks);
        current = ready.splice(bi, 1)[0];
      }
      slice = 0;
    }

    // 4. run one tick
    if (current === null) { idle++; continue; }

    rem[current]--;
    const last = segments[segments.length - 1];
    if (last && last.task === current && last.end === t) last.end = t + 1;
    else segments.push({ task: current, start: t, end: t + 1 });
    slice++;

    if (rem[current] === 0) {
      finish[current] = t + 1;
      current = null;
      slice = 0;
    } else if (algorithm === 'rr' && slice >= q) {
      ready.push(current);
      current = null;
      slice = 0;
    }
  }

  // tasks with a zero burst never run
  tasks.forEach((t, i) => { if (finish[i] === null && t.burst === 0) finish[i] = t.arrival; });

  const rows = tasks.map((t, i) => {
    const done = finish[i];
    const tat = done === null ? null : done - t.arrival;
    const wt = tat === null ? null : tat - t.burst;
    return { ...t, index: i, completion: done, turnaround: tat, waiting: wt };
  });

  const done = rows.filter(r => r.completion !== null);
  const avgWT = done.length ? done.reduce((s, r) => s + r.waiting, 0) / done.length : 0;
  const avgTAT = done.length ? done.reduce((s, r) => s + r.turnaround, 0) / done.length : 0;

  let switches = 0;
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].task !== segments[i - 1]?.task) switches++;
  }

  const total = segments.length ? segments[segments.length - 1].end : 0;

  return { segments, rows, total, idle, switches, avgWT, avgTAT };
}

/* ============================================================
   Small helpers
   ============================================================ */

const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);
const fmtInt = v => (v === null || v === undefined) ? '—' : String(v);

function barClass(id) {
  if (id === 'storage') return 's';
  if (id === 'comm') return 'c';
  if (id === 'nav') return 'n';
  return 'other';
}

const barLetter = id => (id === 'storage' ? 'S' : id === 'comm' ? 'C' : id === 'nav' ? 'N' : '?');

/* ============================================================
   Panel 1 — scheduling lab
   ============================================================ */

function renderWorkloadTable() {
  const tbody = $('#workloadTable tbody');
  tbody.innerHTML = workload.map((t, i) => `
    <tr>
      <td><input class="name" data-i="${i}" data-field="name" value="${t.name}"></td>
      <td><input type="number" min="0" step="1" data-i="${i}" data-field="arrival" value="${t.arrival}"></td>
      <td><input type="number" min="1" step="1" data-i="${i}" data-field="burst" value="${t.burst}"></td>
      <td><input type="number" min="1" step="1" data-i="${i}" data-field="priority" value="${t.priority}"></td>
      <td><input type="number" min="0" step="1" data-field="deadline" data-i="${i}"
           value="${t.deadline === null ? '' : t.deadline}" placeholder="—"></td>
      <td>${workload.length > 1 ? `<button class="del" data-del="${i}" title="Remove">✕</button>` : ''}</td>
    </tr>`).join('');
}

function readWorkloadTable() {
  $$('#workloadTable input').forEach(inp => {
    const i = Number(inp.dataset.i);
    const field = inp.dataset.field;
    if (field === 'name') { workload[i].name = inp.value || `P_${i + 1}`; return; }
    if (field === 'deadline') {
      const v = inp.value.trim();
      workload[i].deadline = v === '' ? null : Math.max(0, Number(v));
      return;
    }
    let v = Number(inp.value);
    if (Number.isNaN(v)) v = field === 'burst' ? 1 : 0;
    if (field === 'burst') v = Math.max(1, v);
    if (field === 'arrival') v = Math.max(0, v);
    if (field === 'priority') v = Math.max(1, v);
    workload[i][field] = v;
  });
}

function runLab() {
  const res = simulate(workload, algo, quantum);
  renderGantt(res);
  renderResults(res);
  renderMetrics(res);
}

function renderMetrics(res) {
  const nav = res.rows.find(r => r.deadline !== null) || null;
  const navDone = nav && nav.completion !== null;
  const met = nav && navDone && nav.completion <= nav.deadline;

  const metClass = nav ? (met ? 'ok' : 'bad') : '';
  const navText = nav ? (navDone ? `${nav.completion} ms` : 'never') : '—';

  $('#metricRow').innerHTML = `
    <div class="metric"><span>Avg waiting time</span><strong>${fmt(res.avgWT)} ms</strong></div>
    <div class="metric"><span>Avg turnaround</span><strong>${fmt(res.avgTAT)} ms</strong></div>
    <div class="metric ${metClass}"><span>${nav ? nav.name : 'Real-time task'} finishes</span><strong>${navText}</strong></div>
    <div class="metric ${metClass}"><span>Deadline ${nav ? `(${nav.deadline} ms)` : ''}</span><strong>${nav ? (met ? 'MET' : 'MISSED') : '—'}</strong></div>
    <div class="metric"><span>Context switches</span><strong>${res.switches}</strong></div>`;

  const verdict = $('#labVerdict');
  if (!nav) {
    verdict.className = 'verdict';
    verdict.textContent = 'No deadline is set on this workload, so only average waiting and turnaround times are reported.';
    return;
  }
  if (met) {
    verdict.className = 'verdict ok';
    verdict.textContent = `${nav.name} finishes at ${nav.completion} ms, inside its ${nav.deadline} ms deadline. `
      + `Cost: ${res.switches} context switches and lower-priority tasks waiting longer — acceptable, `
      + `because a missed navigation deadline is far more serious than a slower log write.`;
  } else {
    verdict.className = 'verdict bad';
    verdict.textContent = `${nav.name} finishes at ${navDone ? nav.completion : '—'} ms and misses its `
      + `${nav.deadline} ms deadline by ${navDone ? nav.completion - nav.deadline : '—'} ms. `
      + `The hard real-time task is at the mercy of work that ignores the deadline.`;
  }
}

function renderGantt(res) {
  const total = Math.max(res.total, 1);
  const ticks = [];
  const step = total <= 50 ? 10 : total <= 120 ? 10 : 20;
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(Math.round(t * 100) / 100);

  const rows = workload.map((t, i) => {
    const bars = res.segments
      .filter(s => s.task === i)
      .map(s => {
        const left = (s.start / total) * 100;
        const width = ((s.end - s.start) / total) * 100;
        const label = width > 3.5 ? `${barLetter(t.id)} ${s.end - s.start}` : '';
        return `<div class="g-bar ${barClass(t.id)}" style="left:${left}%;width:${width}%">${label}</div>`;
      }).join('');

    const deadlineLine = t.deadline !== null
      ? `<div class="g-deadline" style="left:${Math.min(100, (t.deadline / total) * 100)}%"
             data-label="deadline ${t.deadline}"></div>`
      : '';

    return `<div class="g-row">
      <div class="g-label">${t.name}</div>
      <div class="g-track">${bars}${deadlineLine}</div>
    </div>`;
  }).join('');

  const axis = ticks.map(t =>
    `<span class="g-tick" style="left:${(t / total) * 100}%">${t}</span>`
  ).join('');

  $('#gantt').innerHTML = `<div class="gantt">${rows}<div class="g-axis">${axis}</div></div>`;
}

function renderResults(res) {
  $('#resultTable tbody').innerHTML = res.rows.map(r => {
    let pill = '<span class="pill na">—</span>';
    if (r.deadline !== null) {
      const met = r.completion !== null && r.completion <= r.deadline;
      pill = `<span class="pill ${met ? 'ok' : 'bad'}">${met ? 'Met' : 'Missed'}</span>`;
    }
    return `<tr>
      <td>${r.name}</td>
      <td>${r.arrival}</td>
      <td>${r.burst}</td>
      <td>${fmtInt(r.completion)}</td>
      <td>${fmtInt(r.turnaround)}</td>
      <td>${fmtInt(r.waiting)}</td>
      <td>${r.deadline === null ? '—' : r.deadline}</td>
      <td>${pill}</td>
    </tr>`;
  }).join('');
}

/* ============================================================
   Panel 2 — utilisation & rate-monotonic
   ============================================================ */

function rmBound(n) { return n * (Math.pow(2, 1 / n) - 1); }

function renderUtil() {
  const rows = reportUtil.map(t => ({ ...t, U: t.C / t.T }));
  const total = rows.reduce((s, r) => s + r.U, 0);
  const bound = rmBound(rows.length);

  $('#utilBars').innerHTML = rows.map(r => `
    <div class="b-row">
      <div class="b-name">${r.name}</div>
      <div class="b-track">
        <div class="b-fill" style="width:${(r.U * 100).toFixed(1)}%"></div>
        <div class="b-mark" style="left:${(bound * 100).toFixed(1)}%"></div>
      </div>
      <div class="b-val">${(r.U * 100).toFixed(0)}%</div>
    </div>`).join('') + `
    <div class="b-row">
      <div class="b-name">TOTAL</div>
      <div class="b-track">
        <div class="b-fill total" style="width:${(total * 100).toFixed(1)}%"></div>
        <div class="b-mark" style="left:${(bound * 100).toFixed(1)}%"></div>
      </div>
      <div class="b-val">${(total * 100).toFixed(0)}%</div>
    </div>`;

  $('#utilTotal').textContent = `${(total * 100).toFixed(0)}%`;
  $('#utilBound').textContent = `${(bound * 100).toFixed(1)}%`;
  $('#utilSlack').textContent = `${((total - bound) * 100).toFixed(1)} pts over`;
  $('#utilVerdict').textContent = total <= bound ? 'Guaranteed' : 'Not guaranteed';

  $('#utilNote').textContent =
    `U = ${(total * 100).toFixed(0)}% is above the RM bound of ${(bound * 100).toFixed(1)}%, so rate-monotonic `
    + `scheduling cannot guarantee every deadline. The bound is sufficient but not necessary: this does not `
    + `prove a deadline was missed, only that there is no guarantee. Even EDF (bound 100%) leaves just `
    + `${((1 - total) * 100).toFixed(0)}% slack. Storage alone uses ${(rows[3].U * 100).toFixed(0)}%, more than navigation's `
    + `${(rows[1].U * 100).toFixed(0)}%.`;

  renderRmChart(bound);
}

function renderRmChart(bound) {
  const W = 680, H = 260, padL = 46, padR = 18, padT = 18, padB = 34;
  const ns = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const x = n => padL + ((n - 1) / 9) * (W - padL - padR);
  const y = u => padT + (1 - u) / (1 - 0.6) * (H - padT - padB);

  const pts = ns.map(n => `${x(n).toFixed(1)},${y(rmBound(n)).toFixed(1)}`).join(' ');
  const grid = [0.6, 0.7, 0.8, 0.9, 1.0].map(u =>
    `<line x1="${padL}" y1="${y(u)}" x2="${W - padR}" y2="${y(u)}" stroke="#1d2d4a" stroke-width="1"/>
     <text x="${padL - 8}" y="${y(u) + 4}" fill="#7f93b3" font-size="10" text-anchor="end">${(u * 100).toFixed(0)}%</text>`
  ).join('');

  const xticks = ns.map(n =>
    `<text x="${x(n)}" y="${H - padB + 18}" fill="#7f93b3" font-size="10" text-anchor="middle">${n}</text>`
  ).join('');

  const modelU = 0.98;
  $('#rmChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
      aria-label="Rate-monotonic utilisation bound against task count">
      ${grid}
      <polyline points="${pts}" fill="none" stroke="#38e1ff" stroke-width="2"/>
      <circle cx="${x(5)}" cy="${y(bound)}" r="4.5" fill="#38e1ff"/>
      <line x1="${x(5)}" y1="${y(bound)}" x2="${x(5)}" y2="${y(modelU)}" stroke="#ff5470" stroke-dasharray="4 4" stroke-width="1.5"/>
      <circle cx="${x(5)}" cy="${y(modelU)}" r="5" fill="#ff5470"/>
      <text x="${x(5) + 12}" y="${y(modelU) + 4}" fill="#ff5470" font-size="11" font-family="monospace">this workload: 98%</text>
      <text x="${W - padR}" y="${y(bound) - 8}" fill="#38e1ff" font-size="11" text-anchor="end" font-family="monospace">bound n=5: ${(bound * 100).toFixed(1)}%</text>
      ${xticks}
      <text x="${(padL + W - padR) / 2}" y="${H - 4}" fill="#7f93b3" font-size="10" text-anchor="middle">number of tasks (n)</text>
    </svg>`;
}

/* ============================================================
   Panel 3 — incident replay
   ============================================================ */

const REPLAY = {
  baseline: [
    {
      clock: '10:00:01', event: 'Temperature sensor interrupt', cpu: 12,
      states: { sensor: 'Running (ISR)', nav: 'Ready', comm: 'Ready', storage: 'Ready' },
      note: 'The ISR preempts the running task for a moment, then returns the CPU.',
      log: 'ISR entry/exit — running task context saved', sev: ''
    },
    {
      clock: '10:00:02', event: 'Communication request initiated', cpu: 38,
      states: { sensor: 'Idle', nav: 'Ready', comm: 'Running → Waiting', storage: 'Ready' },
      note: 'P_comm blocks on transceiver I/O; the ~3 s timeout timer is armed.',
      log: 'P_comm blocked on transceiver I/O; timeout armed', sev: ''
    },
    {
      clock: '10:00:02', event: 'Navigation task started', cpu: 52,
      states: { sensor: 'Idle', nav: 'Running', comm: 'Waiting', storage: 'Ready' },
      note: 'P_nav is dispatched to the CPU. It must finish within 40 ms.',
      log: 'P_nav dispatched (priority 1)', sev: ''
    },
    {
      clock: '10:00:03', event: 'Storage write initiated', cpu: 70,
      states: { sensor: 'Idle', nav: 'Running', comm: 'Waiting', storage: 'Running → Waiting' },
      note: 'A long, heavyweight write competes for the CPU; the DMA chunk is large.',
      log: 'P_storage heavy write queued (no cap)', sev: ''
    },
    {
      clock: '10:00:03', event: 'CPU utilisation reaches 98%', cpu: 98,
      states: { sensor: 'Idle', nav: 'Ready (starved)', comm: 'Waiting', storage: 'Waiting' },
      note: 'Ready queue crowded — almost no idle CPU is left for anyone.',
      log: 'Ready queue saturated: 98% busy', sev: 'crit'
    },
    {
      clock: '10:00:04', event: 'Navigation task delayed', cpu: 98,
      states: { sensor: 'Idle', nav: 'Ready (no CPU)', comm: 'Waiting', storage: 'Waiting' },
      note: 'P_nav cannot finish before its deadline: it is Ready, but not running.',
      log: 'P_nav deadline at risk — no CPU available', sev: 'crit'
    },
    {
      clock: '10:00:05', event: 'Communication timeout', cpu: 98,
      states: { sensor: 'Idle', nav: 'Delayed', comm: 'Timeout', storage: 'Waiting' },
      note: 'Timer interrupt fires: P_comm was not served within about 3 s.',
      log: 'P_comm timeout — timer interrupt fired', sev: 'crit'
    },
    {
      clock: '10:00:06', event: 'System recovery initiated', cpu: 30,
      states: { sensor: 'Idle', nav: 'Restarted', comm: 'Restarted', storage: 'Restarted' },
      note: 'The watchdog resets the tasks — navigation is lost along with everything else.',
      log: 'Watchdog fired — all tasks restarted', sev: 'crit'
    }
  ],
  fixed: [
    {
      clock: '10:00:01', event: 'Temperature sensor interrupt', cpu: 12,
      states: { sensor: 'Running (ISR)', nav: 'Ready', comm: 'Ready', storage: 'Ready' },
      note: 'Short ISR only does the minimum and defers the rest to a task.',
      log: 'Short ISR; deferred work posted to a task', sev: ''
    },
    {
      clock: '10:00:02', event: 'Communication request initiated', cpu: 36,
      states: { sensor: 'Idle', nav: 'Ready', comm: 'Running → Waiting', storage: 'Ready' },
      note: 'The driver blocks with a timeout and retry; the CPU is released while waiting.',
      log: 'P_comm waiting on I/O with timeout + retry', sev: ''
    },
    {
      clock: '10:00:02', event: 'Navigation task started', cpu: 50,
      states: { sensor: 'Idle', nav: 'Running', comm: 'Waiting', storage: 'Ready' },
      note: 'P_nav runs at the highest task priority and preempts lower-priority work on arrival.',
      log: 'P_nav dispatched; preemption enabled', sev: ''
    },
    {
      clock: '10:00:03', event: 'Storage write initiated', cpu: 66,
      states: { sensor: 'Idle', nav: 'Running', comm: 'Waiting', storage: 'Waiting (DMA)' },
      note: 'Capped DMA chunks: the device moves data while the CPU stays available.',
      log: 'P_storage using capped DMA chunks; load capped', sev: ''
    },
    {
      clock: '10:00:03', event: 'Load peaks at the RM bound', cpu: 74,
      states: { sensor: 'Idle', nav: 'Running', comm: 'Waiting', storage: 'Waiting (DMA)' },
      note: 'Total load is held at 74%, at the rate-monotonic bound instead of above it.',
      log: 'Utilisation held at 74% (cap + DMA)', sev: ''
    },
    {
      clock: '10:00:04', event: 'Navigation task completes', cpu: 60,
      states: { sensor: 'Idle', nav: 'Terminated at 35 ms', comm: 'Waiting', storage: 'Waiting (DMA)' },
      note: 'P_nav finishes at 35 ms against a 45 ms deadline — the deadline is met.',
      log: 'P_nav completed at 35 ms (deadline 45 ms)', sev: 'ok'
    },
    {
      clock: '10:00:05', event: 'Communication retry served', cpu: 44,
      states: { sensor: 'Idle', nav: 'Terminated', comm: 'Running (retry)', storage: 'Waiting (DMA)' },
      note: 'Only P_comm was affected by the slow transceiver; nothing else was delayed.',
      log: 'P_comm served on retry — no timeout', sev: 'ok'
    },
    {
      clock: '10:00:06', event: 'Watchdog check — all healthy', cpu: 24,
      states: { sensor: 'Idle', nav: 'Terminated', comm: 'Running', storage: 'Waiting (DMA)' },
      note: 'Every healthy task refreshed the watchdog, so no restart is needed.',
      log: 'Watchdog refreshed — no recovery required', sev: 'ok'
    }
  ]
};

let replayMode = 'baseline';
let replayStep = 0;
let replayTimer = null;

function stateClass(state) {
  const s = state.toLowerCase();
  if (s.includes('run') || s.includes('isr')) return 'run';
  if (s.includes('ready')) return 'ready';
  if (s.includes('wait') || s.includes('dma')) return 'wait';
  if (s.includes('timeout') || s.includes('restart') || s.includes('delayed')) return 'bad';
  return 'idle';
}

function renderReplayRows() {
  const steps = REPLAY[replayMode];
  $('#stateTable tbody').innerHTML = steps.map((s, i) => {
    const cells = ['sensor', 'nav', 'comm', 'storage'].map(k =>
      `<td><span class="st ${stateClass(s.states[k])}">${s.states[k]}</span></td>`).join('');
    return `<tr data-step="${i}"><td>${s.clock}</td><td>${s.event}</td>${cells}</tr>`;
  }).join('');
  updateReplayVisuals();
}

function updateReplayVisuals() {
  const steps = REPLAY[replayMode];
  $$('#stateTable tbody tr').forEach((tr, i) => {
    tr.classList.toggle('revealed', i < replayStep);
    tr.classList.toggle('current', i === replayStep - 1);
  });

  const last = steps[Math.max(0, replayStep - 1)];
  $('#replayClock').textContent = replayStep === 0 ? '10:00:01' : last.clock;
  $('#cpuValue').textContent = `${replayStep === 0 ? 0 : last.cpu}%`;
  $('#cpuFill').style.width = `${replayStep === 0 ? 0 : last.cpu}%`;

  $('#replayNote').textContent = replayStep === 0
    ? 'Press play to step through the incident at the logged one-second intervals.'
    : last.note;

  $('#eventLog').innerHTML = steps.slice(0, replayStep).map(s =>
    `<li class="${s.sev}"><b>${s.clock}</b> — ${s.log}</li>`).join('')
    || '<li>Waiting for the first event…</li>';
}

function replayTick() {
  const steps = REPLAY[replayMode];
  if (replayStep >= steps.length) { stopReplay(); return; }
  replayStep++;
  updateReplayVisuals();
  if (replayStep >= steps.length) {
    stopReplay();
    $('#playReplay').textContent = '▶ Replay';
    return;
  }
  replayTimer = setTimeout(replayTick, 1100);
}

function startReplay() {
  stopReplay();
  if (replayStep >= REPLAY[replayMode].length) replayStep = 0;
  $('#playReplay').textContent = '❚❚ Pause';
  replayTimer = setTimeout(replayTick, 250);
}

function stopReplay() {
  if (replayTimer) clearTimeout(replayTimer);
  replayTimer = null;
}

function resetReplay() {
  stopReplay();
  replayStep = 0;
  $('#playReplay').textContent = '▶ Play';
  renderReplayRows();
}

/* ============================================================
   Panel 4 — report check
   ============================================================ */

const REPORT_EXPECTED = [
  { key: 'fcfs', label: 'FCFS', wt: 31.67, tat: 61.67, nav: 90 },
  { key: 'prioNP', label: 'Priority — non-preemptive', wt: 21.67, tat: 51.67, nav: 50 },
  { key: 'prioP', label: 'Priority — preemptive', wt: 26.67, tat: 56.67, nav: 35 },
  { key: 'rr', label: 'Round Robin (q = 10)', wt: 41.67, tat: 71.67, nav: 80 }
];

function renderVerify() {
  const base = reportWorkload();
  let allMatch = true;

  const rows = REPORT_EXPECTED.map(exp => {
    const res = simulate(base, exp.key, 10);
    const nav = res.rows.find(r => r.deadline !== null);
    const navFinish = nav ? nav.completion : null;
    const ok = Math.abs(res.avgWT - exp.wt) < 0.02
      && Math.abs(res.avgTAT - exp.tat) < 0.02
      && navFinish === exp.nav;
    if (!ok) allMatch = false;
    return `<tr>
      <td>${exp.label}</td>
      <td>${fmt(res.avgWT)}</td><td class="dim">${exp.wt.toFixed(2)}</td>
      <td>${fmt(res.avgTAT)}</td><td class="dim">${exp.tat.toFixed(2)}</td>
      <td>${fmtInt(navFinish)}</td><td class="dim">${exp.nav}</td>
      <td><span class="pill ${ok ? 'ok' : 'bad'}">${ok ? 'match' : 'differs'}</span></td>
    </tr>`;
  }).join('');

  const totalU = reportUtil.reduce((s, t) => s + t.C / t.T, 0);
  const bound = rmBound(reportUtil.length);
  if (Math.abs(totalU - 0.98) > 1e-9) allMatch = false;

  $('#verifyTable tbody').innerHTML = rows + `<tr>
      <td><b>All four algorithms</b></td>
      <td colspan="6" class="dim">Recomputed from the default workload above; report values shown greyed.</td>
      <td><span class="pill ${allMatch ? 'ok' : 'bad'}">${allMatch ? 'consistent' : 'review'}</span></td>
    </tr>`;

  $('#vUtil').textContent = `${(totalU * 100).toFixed(0)}%`;
  $('#vBound').textContent = `${(bound * 100).toFixed(1)}%`;
}

/* ============================================================
   Wiring
   ============================================================ */

function switchPanel(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name !== 'replay') stopReplay();
}

$$('.tab').forEach(t => t.addEventListener('click', () => switchPanel(t.dataset.panel)));

$('#workloadTable').addEventListener('input', () => {
  readWorkloadTable();
  runLab();
});

$('#workloadTable').addEventListener('click', e => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  const i = Number(btn.dataset.del);
  if (workload.length <= 1) return;
  workload.splice(i, 1);
  renderWorkloadTable();
  runLab();
});

$('#addTask').addEventListener('click', () => {
  const used = new Set(workload.map(t => t.id));
  const id = ['nav', 'comm', 'storage'].find(k => !used.has(k)) || 'extra';
  workload.push({
    id,
    name: id === 'extra' ? `P_task${workload.length + 1}` : { nav: 'P_nav', comm: 'P_comm', storage: 'P_storage' }[id],
    arrival: 0, burst: 10, priority: workload.length + 1, deadline: null
  });
  renderWorkloadTable();
  runLab();
});

$('#resetWorkload').addEventListener('click', () => {
  workload = reportWorkload();
  renderWorkloadTable();
  runLab();
});

$('#algoSwitch').addEventListener('click', e => {
  const btn = e.target.closest('[data-algo]');
  if (!btn) return;
  algo = btn.dataset.algo;
  $$('#algoSwitch .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  $('#quantumWrap').classList.toggle('show', algo === 'rr');
  runLab();
});

$('#quantum').addEventListener('input', e => {
  quantum = Math.max(1, Number(e.target.value) || 1);
  if (algo === 'rr') runLab();
});

$('#modeSwitch').addEventListener('click', e => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  replayMode = btn.dataset.mode;
  $$('#modeSwitch .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  resetReplay();
});

$('#playReplay').addEventListener('click', () => {
  if (replayTimer) { stopReplay(); $('#playReplay').textContent = '▶ Play'; return; }
  startReplay();
});

$('#resetReplay').addEventListener('click', resetReplay);

/* ---------------- init ---------------- */

renderWorkloadTable();
$('#quantumWrap').classList.remove('show');
runLab();
renderUtil();
renderReplayRows();
renderVerify();
