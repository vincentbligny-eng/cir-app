const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
const LEGAL_H_DAY = 7;
const LEGAL_H_WEEK = 35;

let state = {
    users: [],
    projects: [],
    currentUser: null,
    weekStart: mondayOf(new Date()).toISOString().slice(0, 10),
    entries: [],
    holidays: {},
    timeUnit: "hours",
    unfilledWeeks: [],
    viewMode: "weekly",  // "weekly" or "monthly"
    currentMonth: new Date().toISOString().slice(0, 7), // "YYYY-MM"
    monthlyWeeks: [], // loaded weeks for monthly view
};

// --- Helpers ---

function mondayOf(d) {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d;
}

function formatDate(dateStr, offset) {
    const d = addDays(dateStr, offset);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function toDisplay(hours) {
    if (state.timeUnit === "days") return +(hours / LEGAL_H_DAY).toFixed(2);
    return +hours.toFixed(2);
}

function fromDisplay(val) {
    if (state.timeUnit === "days") return val * LEGAL_H_DAY;
    return val;
}

function stepVal() {
    return state.timeUnit === "days" ? "0.25" : "0.5";
}

function maxVal() {
    return state.timeUnit === "days" ? "1" : "8";
}

function fillLevel(displayVal) {
    const max = state.timeUnit === "days" ? 1 : 7;
    if (displayVal <= 0) return "empty";
    if (displayVal >= max) return "full";
    return "partial";
}


// --- Tab switching ---

document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active");
        if (btn.dataset.tab === "config") loadConfig();
        if (btn.dataset.tab === "summary") loadSummary();
        if (btn.dataset.tab === "calendar") { initCalendar(); if (calState.userId) loadCalendar(); }
    });
});

// --- Init ---

async function init() {
    state.users = await api("/api/users");
    state.projects = await api("/api/projects");
    populateUserSelect();
    const wp = document.getElementById("week-picker");
    wp.value = state.weekStart;
    document.getElementById("month-picker").value = state.currentMonth;
}

function populateUserSelect() {
    const sel = document.getElementById("user-select");
    sel.innerHTML = '<option value="">-- Choisir --</option>' +
        state.users.map(u => `<option value="${u.id}">${u.name}</option>`).join("");
}

function updateViewMode() {
    const isWeekly = state.viewMode === "weekly";
    document.getElementById("week-nav-group").style.display = isWeekly ? "" : "none";
    document.getElementById("month-nav-group").style.display = isWeekly ? "none" : "";
    document.getElementById("unfilled-nav-group").style.display = isWeekly ? "" : "none";
}

document.getElementById("view-mode").addEventListener("change", (e) => {
    state.viewMode = e.target.value;
    updateViewMode();
    if (state.currentUser) loadTimesheet();
});

document.getElementById("user-select").addEventListener("change", async (e) => {
    const uid = +e.target.value;
    state.currentUser = state.users.find(u => u.id === uid) || null;
    if (state.currentUser) {
        state.timeUnit = state.currentUser.time_unit || "hours";
        document.getElementById("time-unit").value = state.timeUnit;
        await loadTimesheet();
    }
});

document.getElementById("time-unit").addEventListener("change", async (e) => {
    state.timeUnit = e.target.value;
    if (state.currentUser) {
        await api(`/api/users/${state.currentUser.id}/time_unit`, {
            method: "PUT",
            body: { time_unit: state.timeUnit },
        });
        if (state.viewMode === "weekly") renderTimesheet();
        else renderMonthlyTimesheet();
    }
});

// Weekly navigation
document.getElementById("week-picker").addEventListener("change", (e) => {
    state.weekStart = mondayOf(new Date(e.target.value + "T00:00:00")).toISOString().slice(0, 10);
    e.target.value = state.weekStart;
    if (state.currentUser) loadTimesheet();
});

document.getElementById("prev-week").addEventListener("click", () => {
    const d = new Date(state.weekStart + "T00:00:00");
    d.setDate(d.getDate() - 7);
    state.weekStart = d.toISOString().slice(0, 10);
    document.getElementById("week-picker").value = state.weekStart;
    if (state.currentUser) loadTimesheet();
});

document.getElementById("next-week").addEventListener("click", () => {
    const d = new Date(state.weekStart + "T00:00:00");
    d.setDate(d.getDate() + 7);
    state.weekStart = d.toISOString().slice(0, 10);
    document.getElementById("week-picker").value = state.weekStart;
    if (state.currentUser) loadTimesheet();
});

// Monthly navigation
document.getElementById("month-picker").addEventListener("change", (e) => {
    state.currentMonth = e.target.value;
    if (state.currentUser) loadTimesheet();
});

document.getElementById("prev-month").addEventListener("click", () => {
    const [y, m] = state.currentMonth.split("-").map(Number);
    const nd = new Date(y, m - 2, 1);
    state.currentMonth = nd.toISOString().slice(0, 7);
    document.getElementById("month-picker").value = state.currentMonth;
    if (state.currentUser) loadTimesheet();
});

document.getElementById("next-month").addEventListener("click", () => {
    const [y, m] = state.currentMonth.split("-").map(Number);
    const nd = new Date(y, m, 1);
    state.currentMonth = nd.toISOString().slice(0, 7);
    document.getElementById("month-picker").value = state.currentMonth;
    if (state.currentUser) loadTimesheet();
});

// --- Unfilled weeks ---

async function loadUnfilledWeeks() {
    if (!state.currentUser) return;
    const data = await api(`/api/unfilled_weeks?user_id=${state.currentUser.id}`);
    state.unfilledWeeks = data.unfilled || [];
    updateUnfilledUI();
}

function updateUnfilledUI() {
    const countEl = document.getElementById("unfilled-count");
    const prevBtn = document.getElementById("prev-unfilled");
    const nextBtn = document.getElementById("next-unfilled");
    const n = state.unfilledWeeks.length;

    if (n === 0) {
        countEl.textContent = "0 restante";
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    // Find current position relative to unfilled list
    const currentIdx = state.unfilledWeeks.indexOf(state.weekStart);
    const before = state.unfilledWeeks.filter(w => w < state.weekStart).length;
    const after = state.unfilledWeeks.filter(w => w > state.weekStart).length;

    countEl.textContent = `${n} restante${n > 1 ? "s" : ""}`;
    prevBtn.disabled = before === 0;
    nextBtn.disabled = after === 0;
}

document.getElementById("prev-unfilled").addEventListener("click", () => {
    const prev = state.unfilledWeeks.filter(w => w < state.weekStart);
    if (prev.length === 0) return;
    state.weekStart = prev[prev.length - 1];
    document.getElementById("week-picker").value = state.weekStart;
    loadTimesheet();
});

document.getElementById("next-unfilled").addEventListener("click", () => {
    const next = state.unfilledWeeks.filter(w => w > state.weekStart);
    if (next.length === 0) return;
    state.weekStart = next[0];
    document.getElementById("week-picker").value = state.weekStart;
    loadTimesheet();
});

// --- Timesheet ---

async function loadTimesheet() {
    if (state.viewMode === "monthly") {
        await loadMonthlyTimesheet();
        return;
    }
    const data = await api(`/api/entries?user_id=${state.currentUser.id}&week_start=${state.weekStart}`);
    state.entries = data.entries;
    state.holidays = data.holidays;
    state.projects = await api("/api/projects");
    renderTimesheet();
    loadUnfilledWeeks();
}

async function loadMonthlyTimesheet() {
    const [y, m] = state.currentMonth.split("-").map(Number);
    const data = await api(`/api/monthly_entries?user_id=${state.currentUser.id}&year=${y}&month=${m}`);
    state.monthlyWeeks = data.weeks;
    state.projects = await api("/api/projects");
    renderMonthlyTimesheet();
    loadUnfilledWeeks();
}

function renderTimesheet() {
    const container = document.getElementById("timesheet-container");
    const activeProjects = state.projects.filter(p => p.active);
    // Include a "Congé / Absence" virtual row
    const holidayProject = { id: "__holiday__", name: "Congé / Absence" };

    if (activeProjects.length === 0) {
        container.innerHTML = '<p class="placeholder">Aucun projet actif. Configurez des projets dans l\'onglet Configuration.</p>';
        document.getElementById("timesheet-footer").classList.add("hidden");
        return;
    }

    let html = '<table class="timesheet-table"><thead><tr><th>Projet</th>';
    DAYS.forEach((day, i) => {
        const isHoliday = state.holidays[day];
        const cls = isHoliday ? ' class="holiday-col"' : '';
        const label = DAY_LABELS[i] + " " + formatDate(state.weekStart, i);
        const holidayLabel = isHoliday ? `<br><small>(${state.holidays[day]})</small>` : "";
        html += `<th${cls}>${label}${holidayLabel}</th>`;
    });
    html += '<th>Total</th></tr></thead><tbody>';

    // Project rows
    const allRows = [...activeProjects, holidayProject];
    for (const proj of allRows) {
        const isHolidayRow = proj.id === "__holiday__";
        const entry = state.entries.find(e => e.project_id === proj.id) || {};
        html += `<tr data-project="${proj.id}"><td>${proj.name}</td>`;
        DAYS.forEach(day => {
            const isHolidayDay = !!state.holidays[day];
            const rawVal = entry[day] || 0;
            // For holiday days on the holiday row, auto-fill legal hours
            let val;
            if (isHolidayDay && isHolidayRow) {
                val = LEGAL_H_DAY;
            } else if (isHolidayDay && !isHolidayRow) {
                val = 0;
            } else {
                val = rawVal;
            }
            const displayVal = toDisplay(val);
            const disabled = isHolidayDay ? "disabled" : "";
            const cls = isHolidayDay ? 'class="holiday-input"' : '';
            const level = isHolidayDay ? (isHolidayRow ? "holiday-full" : "holiday-zero") : fillLevel(displayVal);
            html += `<td class="time-cell ${level}" data-day="${day}" data-project="${proj.id}" ${isHolidayDay ? 'data-holiday="true"' : ''}>`;
            if (isHolidayDay) {
                html += `<span class="cell-value">${displayVal}</span>`;
            } else {
                html += `<input type="number" class="cell-input" data-day="${day}" data-project="${proj.id}" value="${displayVal}" min="0" max="${maxVal()}" step="${stepVal()}">`;
            }
            html += `</td>`;
        });
        html += '<td class="row-total">0</td></tr>';
    }

    // Totals row
    html += '<tr class="totals-row"><td><strong>Total</strong></td>';
    DAYS.forEach(day => {
        html += `<td class="col-total" data-day="${day}">0</td>`;
    });
    html += '<td id="grand-total">0</td></tr>';
    html += '</tbody></table>';

    container.innerHTML = html;
    document.getElementById("timesheet-footer").classList.remove("hidden");

    // Single click on cell = toggle 0 ↔ full day. Click on number to type custom.
    container.querySelectorAll(".time-cell:not([data-holiday])").forEach(cell => {
        const inp = cell.querySelector(".cell-input");
        const fullDay = state.timeUnit === "days" ? 1 : 7;
        cell.addEventListener("click", (e) => {
            if (e.target === inp) return;
            const cur = parseFloat(inp.value) || 0;
            const next = cur < fullDay ? fullDay : 0;
            inp.value = next;
            updateCellColor(cell, next);
            updateTotals();
        });
        inp.addEventListener("input", () => {
            updateCellColor(cell, parseFloat(inp.value) || 0);
            updateTotals();
        });
    });
    updateTotals();
}

function renderMonthlyTimesheet() {
    const container = document.getElementById("timesheet-container");
    const activeProjects = state.projects.filter(p => p.active);
    const holidayProject = { id: "__holiday__", name: "Congé / Absence" };

    if (activeProjects.length === 0) {
        container.innerHTML = '<p class="placeholder">Aucun projet actif. Configurez des projets dans l\'onglet Configuration.</p>';
        document.getElementById("timesheet-footer").classList.add("hidden");
        return;
    }

    const allRows = [...activeProjects, holidayProject];
    const weeks = state.monthlyWeeks;
    const mNames = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
    const [curY, curM] = state.currentMonth.split("-").map(Number);

    let html = `<div class="month-weeks-stack">`;

    for (const w of weeks) {
        const ws = new Date(w.week_start + "T00:00:00");
        const weekNum = getISOWeekNum(ws);
        const numHol = Object.keys(w.holidays).length;
        const expected = LEGAL_H_WEEK - numHol * LEGAL_H_DAY;

        html += `<div class="week-block" data-week="${w.week_start}">`;
        html += `<div class="week-block-header"><span class="week-label">S${weekNum}</span><span class="week-status" data-week="${w.week_start}"></span></div>`;
        html += '<table class="timesheet-table compact-table"><thead><tr><th>Projet</th>';
        DAYS.forEach((day, i) => {
            const d = new Date(ws);
            d.setDate(d.getDate() + i);
            const isHol = !!w.holidays[day];
            const cls = isHol ? ' class="holiday-col"' : '';
            html += `<th${cls}>${DAY_LABELS[i]} ${d.getDate()}</th>`;
        });
        html += '<th>Tot.</th></tr></thead><tbody>';

        for (const proj of allRows) {
            const isHolidayRow = proj.id === "__holiday__";
            const entry = w.entries.find(e => e.project_id === proj.id) || {};
            html += `<tr><td class="proj-name">${proj.name}</td>`;
            DAYS.forEach(day => {
                const isHolidayDay = !!w.holidays[day];
                let val;
                if (isHolidayDay && isHolidayRow) val = LEGAL_H_DAY;
                else if (isHolidayDay) val = 0;
                else val = entry[day] || 0;
                const displayVal = toDisplay(val);
                const level = isHolidayDay ? (isHolidayRow ? "holiday-full" : "holiday-zero") : fillLevel(displayVal);
                html += `<td class="time-cell ${level}" data-week="${w.week_start}" data-day="${day}" data-project="${proj.id}" ${isHolidayDay ? 'data-holiday="true"' : ''}>`;
                if (isHolidayDay) {
                    html += `<span class="cell-value">${displayVal}</span>`;
                } else {
                    html += `<input type="number" class="cell-input" data-week="${w.week_start}" data-day="${day}" data-project="${proj.id}" value="${displayVal}" min="0" max="${maxVal()}" step="${stepVal()}">`;
                }
                html += '</td>';
            });
            html += '<td class="row-total" data-week="' + w.week_start + '">0</td></tr>';
        }

        // Week totals row
        html += '<tr class="totals-row"><td><strong>Total</strong></td>';
        DAYS.forEach(day => {
            html += `<td class="col-total" data-week="${w.week_start}" data-day="${day}">0</td>`;
        });
        html += `<td class="week-grand" data-week="${w.week_start}">0</td></tr>`;
        html += '</tbody></table></div>';
    }

    html += '</div>';
    container.innerHTML = html;
    document.getElementById("timesheet-footer").classList.remove("hidden");

    // Click-to-toggle
    container.querySelectorAll(".time-cell:not([data-holiday])").forEach(cell => {
        const inp = cell.querySelector(".cell-input");
        const fullDay = state.timeUnit === "days" ? 1 : 7;
        cell.addEventListener("click", (e) => {
            if (e.target === inp) return;
            const cur = parseFloat(inp.value) || 0;
            inp.value = cur < fullDay ? fullDay : 0;
            updateCellColor(cell, parseFloat(inp.value));
            updateMonthlyTotals();
        });
        inp.addEventListener("input", () => {
            updateCellColor(cell, parseFloat(inp.value) || 0);
            updateMonthlyTotals();
        });
    });
    updateMonthlyTotals();
}

function updateMonthlyTotals() {
    const container = document.getElementById("timesheet-container");
    const unit = state.timeUnit === "days" ? "j" : "h";
    let grandTotal = 0;
    let totalExpected = 0;
    let allComplete = true;

    for (const w of state.monthlyWeeks) {
        const block = container.querySelector(`.week-block[data-week="${w.week_start}"]`);
        if (!block) continue;

        const numHol = Object.keys(w.holidays).length;
        const expected = LEGAL_H_WEEK - numHol * LEGAL_H_DAY;
        totalExpected += expected;
        let weekTotal = 0;

        // Row totals within this week block
        block.querySelectorAll("tbody tr:not(.totals-row)").forEach(row => {
            let rowT = 0;
            row.querySelectorAll(".cell-input").forEach(inp => { rowT += fromDisplay(parseFloat(inp.value) || 0); });
            row.querySelectorAll(".cell-value").forEach(sp => { rowT += fromDisplay(parseFloat(sp.textContent) || 0); });
            const rt = row.querySelector(".row-total");
            if (rt) rt.textContent = toDisplay(rowT) + unit;
        });

        // Column totals
        DAYS.forEach(day => {
            let colT = 0;
            block.querySelectorAll(`.cell-input[data-day="${day}"]`).forEach(inp => { colT += fromDisplay(parseFloat(inp.value) || 0); });
            block.querySelectorAll(`.time-cell[data-day="${day}"] .cell-value`).forEach(sp => { colT += fromDisplay(parseFloat(sp.textContent) || 0); });
            const ct = block.querySelector(`.col-total[data-day="${day}"]`);
            if (ct) ct.textContent = toDisplay(colT) + unit;
            weekTotal += colT;
        });

        const wg = block.querySelector(".week-grand");
        if (wg) wg.textContent = toDisplay(weekTotal) + unit;

        // Week status badge
        const badge = block.querySelector(".week-status");
        const weekOk = expected <= 0 || Math.abs(weekTotal - expected) < 0.01;
        if (badge) {
            if (weekOk) {
                badge.textContent = toDisplay(weekTotal) + unit;
                badge.className = "week-status week-status-ok";
            } else {
                const diff = weekTotal - expected;
                badge.textContent = `${toDisplay(weekTotal)}${unit} / ${toDisplay(expected)}${unit}`;
                badge.className = "week-status week-status-incomplete";
            }
        }
        if (!weekOk) allComplete = false;
        grandTotal += weekTotal;
    }

    const totalsEl = document.getElementById("period-totals");
    const msgEl = document.getElementById("validation-msg");
    const saveBtn = document.getElementById("save-btn");
    totalsEl.textContent = `Total mois: ${toDisplay(grandTotal)}${unit} / ${toDisplay(totalExpected)}${unit}`;
    if (allComplete) {
        msgEl.textContent = "Mois complet";
        msgEl.className = "valid";
        saveBtn.disabled = false;
    } else {
        const diff = grandTotal - totalExpected;
        msgEl.textContent = diff > 0
            ? `+${toDisplay(Math.abs(diff))}${unit} en trop`
            : `${toDisplay(Math.abs(diff))}${unit} manquantes`;
        msgEl.className = "invalid";
        saveBtn.disabled = true;
    }
}

function updateCellColor(cell, displayVal) {
    cell.classList.remove("empty", "partial", "full");
    cell.classList.add(fillLevel(displayVal));
}

function updateTotals() {
    const container = document.getElementById("timesheet-container");
    const unit = state.timeUnit === "days" ? "j" : "h";
    let grandTotal = 0;

    // Row totals
    container.querySelectorAll("tbody tr:not(.totals-row)").forEach(row => {
        let rowTotal = 0;
        row.querySelectorAll(".cell-input").forEach(inp => {
            rowTotal += fromDisplay(parseFloat(inp.value) || 0);
        });
        // Also count holiday display values
        row.querySelectorAll(".cell-value").forEach(span => {
            rowTotal += fromDisplay(parseFloat(span.textContent) || 0);
        });
        const cell = row.querySelector(".row-total");
        if (cell) cell.textContent = toDisplay(rowTotal) + unit;
        grandTotal += rowTotal;
    });

    // Column totals
    DAYS.forEach(day => {
        let colTotal = 0;
        container.querySelectorAll(`.cell-input[data-day="${day}"]`).forEach(inp => {
            colTotal += fromDisplay(parseFloat(inp.value) || 0);
        });
        container.querySelectorAll(`.time-cell[data-day="${day}"] .cell-value`).forEach(span => {
            colTotal += fromDisplay(parseFloat(span.textContent) || 0);
        });
        const cell = container.querySelector(`.col-total[data-day="${day}"]`);
        if (cell) cell.textContent = toDisplay(colTotal) + unit;
    });

    const gt = document.getElementById("grand-total");
    if (gt) gt.textContent = toDisplay(grandTotal) + unit;

    // Validation
    const numHolidays = Object.keys(state.holidays).length;
    const expected = LEGAL_H_WEEK - numHolidays * LEGAL_H_DAY;
    const totalsEl = document.getElementById("period-totals");
    const msgEl = document.getElementById("validation-msg");
    totalsEl.textContent = `Total: ${toDisplay(grandTotal)}${unit} / ${toDisplay(expected)}${unit} attendues`;
    const saveBtn = document.getElementById("save-btn");
    if (Math.abs(grandTotal - expected) < 0.01) {
        msgEl.textContent = "Semaine complète";
        msgEl.className = "valid";
        saveBtn.disabled = false;
    } else {
        const diff = grandTotal - expected;
        msgEl.textContent = diff > 0
            ? `+${toDisplay(diff)}${unit} en trop`
            : `${toDisplay(Math.abs(diff))}${unit} manquantes`;
        msgEl.className = "invalid";
        saveBtn.disabled = true;
    }
}

// --- Save ---

document.getElementById("save-btn").addEventListener("click", async () => {
    const container = document.getElementById("timesheet-container");
    const activeProjects = state.projects.filter(p => p.active);

    if (state.viewMode === "monthly") {
        // Save each week separately
        for (const w of state.monthlyWeeks) {
            const entries = [];
            for (const proj of activeProjects) {
                const row = { project_id: proj.id };
                DAYS.forEach(day => {
                    const inp = container.querySelector(`.cell-input[data-week="${w.week_start}"][data-project="${proj.id}"][data-day="${day}"]`);
                    row[day] = fromDisplay(parseFloat(inp?.value) || 0);
                });
                entries.push(row);
            }
            await api("/api/entries", { method: "POST", body: {
                user_id: state.currentUser.id,
                week_start: w.week_start,
                entries,
            }});
        }
    } else {
        const entries = [];
        for (const proj of activeProjects) {
            const row = { project_id: proj.id };
            DAYS.forEach(day => {
                const inp = container.querySelector(`.cell-input[data-project="${proj.id}"][data-day="${day}"]`);
                row[day] = fromDisplay(parseFloat(inp?.value) || 0);
            });
            entries.push(row);
        }
        await api("/api/entries", { method: "POST", body: {
            user_id: state.currentUser.id,
            week_start: state.weekStart,
            entries,
        }});
    }

    loadUnfilledWeeks();

    const btn = document.getElementById("save-btn");
    const orig = btn.textContent;
    btn.textContent = "Enregistré !";
    btn.style.background = "#16a34a";
    setTimeout(() => { btn.textContent = orig; btn.style.background = ""; }, 1500);
});

// --- Summary (year overview) ---

let sumYear = 2026;

document.getElementById("sum-prev-year").addEventListener("click", () => {
    sumYear--;
    document.getElementById("sum-year-label").textContent = sumYear;
    loadSummary();
});

document.getElementById("sum-next-year").addEventListener("click", () => {
    sumYear++;
    document.getElementById("sum-year-label").textContent = sumYear;
    loadSummary();
});

async function loadSummary() {
    const data = await api(`/api/year_summary?year=${sumYear}`);
    const container = document.getElementById("summary-container");

    if (!data.users || data.users.length === 0) {
        container.innerHTML = '<p class="placeholder">Aucun employé configuré.</p>';
        return;
    }

    const weeks = data.weeks;
    if (weeks.length === 0) {
        container.innerHTML = '<p class="placeholder">Aucune semaine passée cette année.</p>';
        return;
    }

    // Group weeks by month for header labels
    const monthSpans = [];
    let curMonth = -1;
    for (let i = 0; i < weeks.length; i++) {
        const m = new Date(weeks[i] + "T00:00:00").getMonth();
        if (m !== curMonth) {
            monthSpans.push({ month: m, start: i, count: 1 });
            curMonth = m;
        } else {
            monthSpans[monthSpans.length - 1].count++;
        }
    }

    const mNames = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

    let html = '<div class="sum-grid-wrapper"><table class="sum-grid-table">';

    // Month header row
    html += '<thead><tr><th class="sum-name-col"></th>';
    for (const ms of monthSpans) {
        html += `<th colspan="${ms.count}" class="sum-month-header">${mNames[ms.month]}</th>`;
    }
    html += '<th class="sum-stat-col">Complet</th></tr>';

    // Week number row
    html += '<tr><th class="sum-name-col">Employé</th>';
    for (let i = 0; i < weeks.length; i++) {
        const d = new Date(weeks[i] + "T00:00:00");
        const weekNum = getISOWeekNum(d);
        html += `<th class="sum-week-header" title="Semaine du ${weeks[i]}">S${weekNum}</th>`;
    }
    html += '<th class="sum-stat-col"></th></tr></thead><tbody>';

    // One row per user
    for (const u of data.users) {
        html += `<tr><td class="sum-name-col">${u.user.name}</td>`;
        for (const ws of weeks) {
            const w = u.weeks[ws];
            if (!w) {
                html += '<td class="sum-cell sum-na"></td>';
                continue;
            }
            let cls = "sum-cell";
            let title = `S. ${ws}: ${w.total}h / ${w.expected}h`;
            if (w.expected <= 0) {
                cls += " sum-skip";
                title += " (férié)";
            } else if (w.complete) {
                cls += " sum-ok";
            } else if (w.total > 0) {
                cls += " sum-partial";
                title += " — incomplet";
            } else {
                cls += " sum-empty";
                title += " — non rempli";
            }
            html += `<td class="${cls}" title="${title}"></td>`;
        }
        const pct = u.total_weeks > 0 ? Math.round(u.complete_count / u.total_weeks * 100) : 0;
        const pctCls = pct === 100 ? "sum-pct-ok" : pct >= 50 ? "sum-pct-warn" : "sum-pct-bad";
        html += `<td class="sum-stat-col ${pctCls}">${u.complete_count}/${u.total_weeks} (${pct}%)</td>`;
        html += '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function getISOWeekNum(d) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
}

// --- Config ---

async function loadConfig() {
    state.users = await api("/api/users");
    state.projects = await api("/api/projects");
    const holidays = await api("/api/holidays");
    renderProjectList();
    renderUserList();
    renderHolidayList(holidays);
}

function renderProjectList() {
    const el = document.getElementById("project-list");
    if (state.projects.length === 0) {
        el.innerHTML = '<p class="placeholder">Aucun projet.</p>';
        return;
    }
    el.innerHTML = state.projects.map(p => `
        <div class="config-item">
            <span class="name">${p.name}</span>
            <span class="desc">${p.description || ""}</span>
            <span class="badge ${p.active ? 'badge-active' : 'badge-inactive'}">${p.active ? 'Actif' : 'Inactif'}</span>
            <button class="danger-btn" onclick="toggleProject(${p.id}, ${p.active ? 0 : 1})">${p.active ? 'Désactiver' : 'Activer'}</button>
            <button class="danger-btn" onclick="deleteProject(${p.id})">Supprimer</button>
        </div>
    `).join("");
}

function renderUserList() {
    const el = document.getElementById("user-list");
    if (state.users.length === 0) {
        el.innerHTML = '<p class="placeholder">Aucun employé.</p>';
        return;
    }
    el.innerHTML = state.users.map(u => `
        <div class="config-item">
            <span class="name">${u.name}</span>
            <button class="danger-btn" onclick="deleteUser(${u.id})">Supprimer</button>
        </div>
    `).join("");
}

function renderHolidayList(holidays) {
    const el = document.getElementById("holiday-list");
    if (holidays.length === 0) {
        el.innerHTML = '<p class="hint">Aucun congé personnalisé.</p>';
        return;
    }
    el.innerHTML = holidays.map(h => `
        <div class="config-item">
            <span class="name">${h.date}</span>
            <span class="desc">${h.label}</span>
            <button class="danger-btn" onclick="deleteHoliday(${h.id})">Supprimer</button>
        </div>
    `).join("");
}

document.getElementById("add-project").addEventListener("click", async () => {
    const name = document.getElementById("new-project-name").value.trim();
    const desc = document.getElementById("new-project-desc").value.trim();
    if (!name) return;
    await api("/api/projects", { method: "POST", body: { name, description: desc } });
    document.getElementById("new-project-name").value = "";
    document.getElementById("new-project-desc").value = "";
    loadConfig();
});

document.getElementById("add-user").addEventListener("click", async () => {
    const name = document.getElementById("new-user-name").value.trim();
    if (!name) return;
    await api("/api/users", { method: "POST", body: { name } });
    document.getElementById("new-user-name").value = "";
    await loadConfig();
    populateUserSelect();
});

document.getElementById("add-holiday").addEventListener("click", async () => {
    const d = document.getElementById("new-holiday-date").value;
    const label = document.getElementById("new-holiday-label").value.trim();
    if (!d) return;
    await api("/api/holidays", { method: "POST", body: { date: d, label: label || "Congé" } });
    document.getElementById("new-holiday-date").value = "";
    loadConfig();
});

window.toggleProject = async (id, active) => {
    const proj = state.projects.find(p => p.id === id);
    await api(`/api/projects/${id}`, { method: "PUT", body: { ...proj, active } });
    loadConfig();
};

window.deleteProject = async (id) => {
    if (!confirm("Supprimer ce projet et toutes ses entrées de temps ?")) return;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    loadConfig();
};

window.deleteUser = async (id) => {
    if (!confirm("Supprimer cet employé et toutes ses entrées de temps ?")) return;
    await api(`/api/users/${id}`, { method: "DELETE" });
    await loadConfig();
    populateUserSelect();
};

window.deleteHoliday = async (id) => {
    await api(`/api/holidays/${id}`, { method: "DELETE" });
    loadConfig();
};

// --- Import ---

document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById("import-status");
    statusEl.textContent = "Import en cours...";
    statusEl.style.color = "var(--muted)";
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await api("/api/import", { method: "POST", body: data });
        if (res.ok) {
            statusEl.textContent = `Import OK (${res.imported.users} employés, ${res.imported.projects} projets, ${res.imported.time_entries} entrées)`;
            statusEl.style.color = "var(--success)";
            loadConfig();
            state.users = await api("/api/users");
            state.projects = await api("/api/projects");
            populateUserSelect();
        } else {
            statusEl.textContent = "Erreur: " + (res.error || "inconnu");
            statusEl.style.color = "var(--danger)";
        }
    } catch (err) {
        statusEl.textContent = "Erreur: " + err.message;
        statusEl.style.color = "var(--danger)";
    }
    e.target.value = "";
});

// --- Calendar (full year) ---

const CAL_COLORS = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];
const MONTH_NAMES = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

let calState = { year: 2026, userId: null };

function initCalendar() {
    const sel = document.getElementById("cal-user-select");
    sel.innerHTML = '<option value="">-- Choisir --</option>' +
        state.users.map(u => `<option value="${u.id}">${u.name}</option>`).join("");
    document.getElementById("cal-year-label").textContent = calState.year;
}

document.getElementById("cal-user-select").addEventListener("change", (e) => {
    calState.userId = +e.target.value || null;
    if (calState.userId) loadCalendar();
});

document.getElementById("cal-prev-year").addEventListener("click", () => {
    calState.year--;
    document.getElementById("cal-year-label").textContent = calState.year;
    if (calState.userId) loadCalendar();
});

document.getElementById("cal-next-year").addEventListener("click", () => {
    calState.year++;
    document.getElementById("cal-year-label").textContent = calState.year;
    if (calState.userId) loadCalendar();
});

async function loadCalendar() {
    if (!calState.userId) return;

    const data = await api(`/api/yearly?user_id=${calState.userId}&year=${calState.year}`);
    const projects = await api("/api/projects");

    const colorMap = {};
    projects.forEach((p, i) => { colorMap[p.id] = CAL_COLORS[i % CAL_COLORS.length]; });

    // Legend
    const legendEl = document.getElementById("cal-legend");
    legendEl.innerHTML = '<div class="cal-legend">' +
        projects.filter(p => p.active).map(p =>
            `<span class="cal-legend-item"><span class="cal-dot" style="background:${colorMap[p.id]}"></span>${p.name}</span>`
        ).join("") +
        '<span class="cal-legend-item"><span class="cal-dot" style="background:var(--holiday-bg);border:1px solid #f59e0b"></span>Férié</span>' +
        '<span class="cal-legend-item"><span class="cal-dot" style="background:#fee2e2;border:1px solid #fca5a5"></span>Non rempli</span>' +
        '</div>';

    const dayHeaders = ["L", "M", "M", "J", "V", "S", "D"];
    const today = new Date().toISOString().slice(0, 10);
    let fullHtml = '<div class="cal-year-grid">';

    for (const mInfo of data.months) {
        const m = mInfo.month;
        const mStr = String(m).padStart(2, "0");

        fullHtml += '<div class="cal-month-block">';
        fullHtml += `<div class="cal-month-title">${MONTH_NAMES[m - 1]}</div>`;
        fullHtml += '<div class="cal-mini-grid">';
        dayHeaders.forEach(d => { fullHtml += `<div class="cal-mini-header">${d}</div>`; });

        for (let i = 0; i < mInfo.first_weekday; i++) {
            fullHtml += '<div class="cal-mini-cell cal-empty"></div>';
        }

        for (let d = 1; d <= mInfo.num_days; d++) {
            const ds = `${calState.year}-${mStr}-${String(d).padStart(2, "0")}`;
            const dayOfWeek = (mInfo.first_weekday + d - 1) % 7;
            const isWeekend = dayOfWeek >= 5;
            const isHoliday = !!data.holidays[ds];
            const entries = data.days[ds] || [];
            const totalH = entries.reduce((s, e) => s + e.hours, 0);
            const isToday = ds === today;
            const isPast = ds < today && !isWeekend && !isHoliday;
            const isMissing = isPast && totalH < 7 && !isHoliday && !isWeekend;

            let cls = "cal-mini-cell";
            if (isWeekend) cls += " cal-mini-weekend";
            if (isHoliday) cls += " cal-mini-holiday";
            if (isToday) cls += " cal-mini-today";
            if (isMissing) cls += " cal-mini-missing";

            let title = `${d}/${m}/${calState.year}`;
            if (isHoliday) title += ` - ${data.holidays[ds]}`;
            entries.forEach(e => { title += `\n${e.project_name}: ${e.hours}h`; });
            if (totalH > 0) title += `\nTotal: ${totalH}h`;

            // Cell content: colored segments or day number
            let inner = `<span class="cal-mini-num">${d}</span>`;
            if (!isWeekend && !isHoliday && entries.length > 0) {
                inner += '<span class="cal-mini-bar">';
                entries.forEach(e => {
                    const pct = Math.round((e.hours / 7) * 100);
                    inner += `<span class="cal-mini-seg" style="width:${Math.min(pct,100)}%;background:${colorMap[e.project_id] || '#94a3b8'}"></span>`;
                });
                inner += '</span>';
            }

            fullHtml += `<div class="${cls}" title="${title}">${inner}</div>`;
        }

        fullHtml += '</div></div>';
    }

    fullHtml += '</div>';
    document.getElementById("calendar-container").innerHTML = fullHtml;
}

// --- Boot ---
init();
