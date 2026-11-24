# Spacecraft OS Failure Simulator

An interactive browser simulation of the case-study report **“Spacecraft Operating System Failure
Investigation”** (Team 6, CS10, B.Tech CSE-SE). It replays the logged incident, runs the four
scheduling algorithms from the report on the same workload, and checks the numbers the report
prints.

Everything is in **one self-contained file, `index.html`** — the CSS and JavaScript are inline, with
no build step, no dependencies and no other files to copy. Just open it (double-click) and it runs,
which also makes it work directly on GitHub Pages.

**Repository:** <https://github.com/Ramkrishna-saha/spacecraft>

---

## What it shows

### 1 · Scheduling Lab
The overloaded sample workload from the report:

| Process | Arrival | Burst | Priority | Deadline |
|---|---|---|---|---|
| P_storage | 0 | 40 | 4 | — |
| P_comm | 0 | 20 | 3 | — |
| P_nav | 5 | 30 | 1 | 45 |

The arrival, burst and priority numbers are **assumptions** made by the team, not measurements from
the spacecraft: the log supplies only the order of events and the 98% CPU reading.

Pick an algorithm and the simulator draws its Gantt chart, per-process completion / turnaround /
waiting times, the average values, the number of context switches, and whether `P_nav` meets its
deadline. Every cell of the workload table is editable, so other workloads can be tried.

### 2 · Utilisation & Rate-Monotonic bound
`U = C/T` for the five periodic tasks (`P_sensor` 10%, `P_nav` 30%, `P_comm` 20%, `P_storage` 34%,
`P_watchdog` 4%) — **98% total**, against the Liu & Layland bound `n(2^(1/n) − 1)` of **74.3%** for
n = 5. The second chart plots the bound against the number of tasks and marks this workload.

### 3 · Incident Replay
Steps through the log at its logged one-second intervals, showing each task's state
(Running / Ready / Waiting), a CPU-utilisation gauge with the RM bound marked, and a watchdog log.

Two modes:

* **As logged (overload)** — CPU climbs to 98%, navigation is delayed, communication times out at
  ~3 s, and the watchdog restarts everything.
* **Proposed design** — short ISRs, preemptive priority scheduling, capped DMA storage, priority
  inheritance, timeout + retry and a selective watchdog: navigation completes at 35 ms against a
  45 ms deadline and no system-wide reset happens.

### 4 · Report Check
Recomputes all four algorithms from the default workload and compares the result with the figures
printed in the report (average waiting time, average turnaround time, `P_nav` completion,
utilisation, RM bound). Useful while defending the numbers in a viva.

---

## Results the simulator reproduces

| Algorithm | Avg WT (ms) | Avg TAT (ms) | P_nav finishes | Deadline (45 ms) |
|---|---|---|---|---|
| FCFS | 31.67 | 61.67 | 90 | Missed |
| Priority — non-preemptive | 21.67 | 51.67 | 50 | Missed |
| Priority — preemptive | 26.67 | 56.67 | 35 | **Met** |
| Round Robin (q = 10) | 41.67 | 71.67 | 80 | Missed |

Conclusion carried by the model: only preemptive priority scheduling protects a hard real-time
task, supported by short interrupt handlers, DMA-based capped storage, priority-inheritance mutexes
and a watchdog with selective restart.

---

## Run it

No installation:

Just double-click `index.html` (or run `start index.html` on Windows, `open index.html` on macOS).
It needs no server and no internet connection.

Or serve it locally (any static server works):

```
python -m http.server 8000
# then visit http://localhost:8000
```

## Publish with GitHub Pages

1. Push this folder to a GitHub repository (already done for this one).
2. Repository → **Settings → Pages**.
3. **Source: Deploy from a branch** → branch `main`, folder `/ (root)` → **Save**.
4. The site appears at `https://<user>.github.io/<repo>/` within a minute or two.

Because the entry point is `index.html` at the repository root, no extra configuration is needed.

## File

```
index.html   the whole project: markup, four panels, paper-and-ink styles and the
             scheduling engine (inlined CSS + JavaScript)
```

## Model notes and limitations

* Single shared preemptable CPU, no I/O blocking inside the scheduling model — the workload is
  intentionally the reduced three-process scenario from the report.
* Priority value 1 = highest priority.
* The navigation deadline is absolute (arrival 5 ms + 40 ms = 45 ms).
* The rate-monotonic test is sufficient but **not** necessary: 98% > 74.3% means “no guarantee”,
  not “proof of a miss”.
* Results are model results. The log supports the event order and the 98% reading only.
