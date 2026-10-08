"use strict";

/* ==========================================================
   Twitchkiste Zeiterfassung
   Aufbau: Konstanten -> Hilfsfunktionen -> Store -> Anzeige -> Aktionen -> Start

   Alle Daten liegen im localStorage des Browsers. Für gemeinsame Daten
   zwischen mehreren Geräten muss nur das Objekt "Store" durch eine Version
   ersetzt werden, die ein Backend anspricht (gleiche Methoden, alle liefern Promises).
   ========================================================== */

/* ---------- Konstanten ---------- */
const TASKS = [
    "Clips schneiden",
    "Twitch Streams sichten",
    "TikTok hochladen",
    "Titel und Thumbnails",
    "Meeting im Discord",
    "Auf Inspiration warten",
    "Strategisch aus dem Fenster schauen",
    "Arbeitszeitbetrug"
];

const WRONG_PASSWORD = [
    "Falsches Passwort. Das war's. Fristlose Kündigung.",
    "Falsches Passwort. Die Personalabteilung wurde informiert (also du).",
    "Falsches Passwort. Bitte kurz über deine Lebensentscheidungen nachdenken.",
    "Falsches Passwort. Dein Chef weiß Bescheid."
];

const AWAY_TEXTS = [
    "Vermutlich Twitch schauen",
    "Schneidet gerade im Kopf",
    "Wartet auf den Algorithmus",
    "Meeting mit dem Sofa",
    "Sucht den perfekten Clip-Titel",
    "Ist am Goonen",
    "Macht Arbeitszeitbetrug"
];

const DATA_KEY = "twitchkiste-data";
const SESSION_KEY = "twitchkiste-session";
const MAX_WORK_MS = 8 * 60 * 60 * 1000;   // nach 8 Stunden Arbeitszeit wird ausgestempelt
const BOSS_KEY = "leo";
const TAB_KEY = "twitchkiste-tab";
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
    "August", "September", "Oktober", "November", "Dezember"];

/* Wer den Casino-Tab sieht. Eintrag = ID des Namens (kleingeschrieben, ohne Umlaute, Leerzeichen -> "-"). */
const SLOT_USERS = ["lip","leo"];
const SLOT_START = 100;        // Startguthaben in Coins
const COINS_PER_MIN = 1;       // Coins pro gearbeiteter Minute
const SLOT_BETS = [5, 10, 25, 50, 67, 100];

/* weight = Häufigkeit, pay = Gewinn-Multiplikator bei drei gleichen Symbolen */
const SLOT_SYMBOLS = [
    { sym: "🎬", weight: 40, pay: 5 },
    { sym: "📱", weight: 30, pay: 8 },
    { sym: "🎮", weight: 16, pay: 12 },
    { sym: "⭐", weight: 6, pay: 20 },
    { sym: "💎", weight: 4, pay: 50 },
    { sym: "7️⃣", weight: 4, pay: 100 }
];
const JACKPOT_SYM = "7️⃣";

const JACKPOT_PRIZES = [
    "Einen Tag lang bestimmt Lip, welche Clips geschnitten werden",
    "Der Chef holt Kaffee",
    "Ein Meeting nach Wahl darf abgesagt werden",
    "Eine Stunde Arbeitszeitbetrug ohne Konsequenzen",
    "Der nächste Clip-Titel wird von Lip diktiert"
];

const LOSE_TEXTS = [
    "Leider nichts. Das Haus gewinnt immer.",
    "Knapp daneben ist auch vorbei.",
    "Nichts. Aber der nächste Dreh ist bestimmt der Richtige.",
    "Die Walzen schweigen."
];

const SIXSEVEN_TEXTS = [
    "6 7! 🤷",
    "Sixxx Sevennn.",
    "67. Mehr muss man dazu nicht sagen.",
    "Der Chef versteht den Witz nicht. Perfekt.",
    "Arbeitszeitbetrug, aber mit Stil: 67.",
    "6… 7… ja, das war's."
];

/* ---------- Zustand ---------- */
const state = {
    employees: {},
    shifts: [],
    vacations: [],
    meetings: [],
    chat: [],
    meKey: null,
    meName: "",
    busy: false,
    tab: "home",
    cal: { y: new Date().getFullYear(), m: new Date().getMonth() }
};

/* Hier tragen sich die neuen Bereiche selbst ein (siehe spätere Schritte) */
const extraRenderers = [];
const tabHooks = {};
function renderExtras() { extraRenderers.forEach((fn) => fn()); }

/* ---------- Hilfsfunktionen ---------- */
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignorieren */ } }
function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignorieren */ } }

/* Macht aus einem Namen eine sichere ID, z. B. "Jörg K." -> "jorg-k" */
function slug(name) {
    const s = name
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return s || "user";
}

async function hashPin(key, pin) {
    try {
        const bytes = new TextEncoder().encode("twitchkiste:" + key + ":" + pin);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
        return "p:" + pin; // z. B. wenn die Seite ohne https geöffnet wird
    }
}

const pad = (n) => String(n).padStart(2, "0");

function fmtDur(ms) {
    const s = Math.floor(Math.max(ms, 0) / 1000);
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
}

function fmtHM(ms) {
    const m = Math.floor(Math.max(ms, 0) / 60000);
    return Math.floor(m / 60) + " Std " + pad(m % 60) + " Min";
}

function dayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function weekStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Montag
    return d.getTime();
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (ts) => new Date(ts).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" });

/* Summe der Arbeitszeit einer Person ab einem Zeitpunkt (laufende Schicht zählt mit) */
/* Reine Arbeitszeit einer Schicht, ohne Pausen */
function workMs(shift, now = Date.now()) {
    const end = shift.end || now;
    const runningPause = shift.pauseStart ? Math.max(0, end - shift.pauseStart) : 0;
    return Math.max(0, end - shift.start - (shift.pauseMs || 0) - runningPause);
}

/* Summe der Arbeitszeit einer Person ab einem Zeitpunkt (laufende Schicht zählt mit) */
function sumMs(key, from) {
    const now = Date.now();
    let total = 0;
    for (const s of state.shifts) {
        if (s.emp !== key) continue;
        const end = s.end || now;
        if (end <= from) continue;
        const gross = end - s.start;
        const share = s.start >= from ? 1 : (end - from) / (gross || 1);
        total += workMs(s, now) * share;
    }
    return total;
}

const isBoss = () => state.meKey === BOSS_KEY;

function dateStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
const todayStr = () => dateStr(new Date());
const fmtDateStr = (ds) => new Date(ds + "T00:00").toLocaleDateString("de-AT",
    { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

function monthStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d.getTime();
}

/* Ist die Person heute im genehmigten Urlaub? */
function onVacation(key) {
    const t = todayStr();
    return state.vacations.some((v) => v.emp === key && v.status === "approved" && v.from <= t && t <= v.to);
}

/* Begrüßung nach Tageszeit, mit eigenen Texten aus dem Profil */
function myGreeting() {
    const me = state.employees[state.meKey] || {};
    const hour = new Date().getHours();
    if (hour < 11) return me.greetMorning || "Guten Morgen";
    if (hour < 18) return me.greetDay || "Guten Tag";
    return me.greetEvening || "Guten Abend";
}

/* Avatar: Emoji statt Buchstabe, eigene Farbe */
function styleAvatar(node, emp, name) {
    node.textContent = (emp && emp.emoji) || name.charAt(0).toUpperCase();
    node.style.background = (emp && emp.color) || "";
    node.style.color = (emp && emp.color) ? "#ffffff" : "";
}

function avatarEl(emp, name) {
    const node = el("span", "avatar");
    styleAvatar(node, emp, name);
    return node;
}

/* Button mit Rückfrage: erster Klick fragt nach, zweiter führt aus */
function armedButton(label, onConfirm) {
    const button = el("button", "btn btn-small", label);
    button.type = "button";
    let armed = false;
    let timer = null;

    button.addEventListener("click", async () => {
        if (!armed) {
            armed = true;
            button.textContent = "Wirklich?";
            timer = setTimeout(() => { armed = false; button.textContent = label; }, 3000);
            return;
        }
        clearTimeout(timer);
        button.disabled = true;
        try {
            await onConfirm();
        } catch (e) {
            button.disabled = false;
            armed = false;
            button.textContent = label;
            toast("Das hat nicht geklappt.", true);
        }
    });
    return button;
}

function activeShift(key) {
    return state.shifts.find((s) => s.emp === key && !s.end) || null;
}

let toastTimer = null;
function toast(message, isError) {
    const t = $("toast");
    t.textContent = message;
    t.className = "toast" + (isError ? " bad" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------- Store (Firebase Realtime Database) ---------- */
const firebaseConfig = {
    apiKey: "AIzaSyD5M5lGi6-yPq-7T6wnIig5x-2dYR9ivwA",
    authDomain: "twitchkiste-bc5f0.firebaseapp.com",
    databaseURL: "https://twitchkiste-bc5f0-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "twitchkiste-bc5f0",
    storageBucket: "twitchkiste-bc5f0.firebasestorage.app",
    messagingSenderId: "304509620982",
    appId: "1:304509620982:web:56b2dcdb97ef7fa77bd2d7"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const Store = {
    data: { employees: {}, shifts: [], vacations: [], meetings: [], chat: [] },
    listeners: [],

    /* Startet alle Live-Verbindungen. Fertig, sobald alles einmal geladen ist. */
    start() {
        return new Promise((resolve) => {
            const waiting = new Set(["employees", "shifts", "vacations", "meetings", "chat"]);
            const got = (name) => {
                waiting.delete(name);
                this.emit();
                if (!waiting.size) resolve();
            };

            db.ref("employees").on("value", (snap) => {
                this.data.employees = snap.val() || {};
                got("employees");
            });
            db.ref("shifts").on("value", (snap) => {
                this.data.shifts = Object.values(snap.val() || {});
                got("shifts");
            });
            db.ref("vacations").on("value", (snap) => {
                this.data.vacations = Object.values(snap.val() || {});
                got("vacations");
            });
            db.ref("meetings").on("value", (snap) => {
                this.data.meetings = Object.values(snap.val() || {});
                got("meetings");
            });
            /* Chat: nur die letzten 100 Nachrichten, die Push-Keys sind zeitlich sortiert */
            db.ref("chat").limitToLast(100).on("value", (snap) => {
                const list = [];
                snap.forEach((child) => { list.push(child.val()); });
                this.data.chat = list;
                got("chat");
            });
        });
    },

    emit() {
        this.listeners.forEach((fn) => fn(this.data));
    },

    /* Mitarbeiter */
    getEmployee(key) { return db.ref("employees/" + key).get().then((snap) => snap.val()); },
    createEmployee(key, employee) { return db.ref("employees/" + key).set(employee); },
    updateEmployee(key, fields) { return db.ref("employees/" + key).update(fields); },
    /* Gewinn oder Verlust sicher draufrechnen (Transaction verhindert Überschreiben) */
    addSlotNet(key, delta) {
        return db.ref("employees/" + key + "/slotNet").transaction((v) => (v || 0) + delta);
    },

    /* Schichten */
    startShift(shift) { return db.ref("shifts/" + shift.id).set(shift); },
    updateShift(id, fields) { return db.ref("shifts/" + id).update(fields); },
    deleteShift(id) { return db.ref("shifts/" + id).remove(); },

    /* Urlaub und Meetings (gleiche Form, deshalb ein gemeinsamer Satz Methoden) */
    saveItem(path, item) { return db.ref(path + "/" + item.id).set(item); },
    updateItem(path, id, fields) { return db.ref(path + "/" + id).update(fields); },
    removeItem(path, id) { return db.ref(path + "/" + id).remove(); },

    /* Chat */
    sendChat(message) { return db.ref("chat").push(message); },
    clearChat() { return db.ref("chat").remove(); }
};

/* ---------- Anzeige ---------- */
function render() {
    if (!state.meKey) return;

    const me = state.employees[state.meKey] || {};
    const active = activeShift(state.meKey);
    const paused = !!(active && active.pauseStart);

    $("hello").textContent = myGreeting() + ", " + state.meName;
    $("dateLine").textContent = new Date().toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
    $("userName").textContent = state.meName;
    styleAvatar($("userAvatar"), me, state.meName);

    const chip = $("statusChip");
    chip.textContent = !active ? "Nicht eingestempelt" : paused ? "In Pause" : "Im Dienst";
    chip.className = "chip" + (active && !paused ? " on" : "");

    $("status").textContent = !active
        ? "Gerade nicht eingestempelt."
        : paused
            ? "In Pause seit " + fmtTime(active.pauseStart) + ". Die Uhr steht."
            : "Seit " + fmtTime(active.start) + " im Dienst: " + active.task;

    const button = $("stampBtn");
    button.textContent = active ? "Ausstempeln" : "Einstempeln";
    button.className = "stamp-btn" + (active ? " out" : "");

    const pauseBtn = $("pauseBtn");
    pauseBtn.hidden = !active;
    pauseBtn.textContent = paused ? "Pause beenden" : "Pause machen";

    const select = $("taskSel");
    select.disabled = !!active;
    if (active) select.value = active.task;

    renderTeam();
    renderRows();
    updateTimes();
    renderExtras();
}

function renderTeam() {
    const list = $("board");
    list.replaceChildren();

    const keys = Object.keys(state.employees).sort((a, b) =>
        String(state.employees[a].name || a).localeCompare(String(state.employees[b].name || b)));

    let online = 0;

    for (const key of keys) {
        const emp = state.employees[key];
        const name = emp.name || key;
        const active = activeShift(key);
        const paused = !!(active && active.pauseStart);
        const vacation = !active && onVacation(key);
        if (active) online++;

        const li = el("li", "member");
        li.append(avatarEl(emp, name));

        const info = el("div");
        info.append(el("div", "member-name", name + (key === state.meKey ? " (du)" : "")));

        const sub = el("div", "member-sub");
        if (active) {
            sub.append(document.createTextNode(active.task + " · seit " + fmtTime(active.start) + " · "));
            const since = el("span", "mono");
            since.dataset.shift = active.id;
            sub.append(since);
        } else if (vacation) {
            sub.textContent = "Im Urlaub 🏖️";
        } else if (emp.motto) {
            sub.textContent = emp.motto;
        } else {
            let h = 0;
            for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
            sub.textContent = AWAY_TEXTS[h % AWAY_TEXTS.length];
        }
        info.append(sub);

        const week = el("div", "member-sub");
        week.append(document.createTextNode("Diese Woche: "));
        const weekValue = el("span", "mono");
        weekValue.dataset.wk = key;
        week.append(weekValue);
        info.append(week);

        const label = active ? (paused ? "In Pause" : "Im Büro") : vacation ? "Im Urlaub" : "Nicht erreichbar";
        li.append(info, el("span", "pill" + (active && !paused ? " on" : ""), label));
        list.append(li);
    }

    $("teamCount").textContent = online + " von " + keys.length;
}

function renderRows() {
    const body = $("rows");
    body.replaceChildren();

    const mine = state.shifts.filter((s) => s.emp === state.meKey).slice(0, 40);
    $("rowsEmpty").hidden = mine.length > 0;

    for (const shift of mine) {
        const tr = el("tr", shift.end ? "" : "live");
        tr.append(el("td", "", fmtDay(shift.start)), el("td", "", fmtTime(shift.start)), el("td", "", shift.end ? fmtTime(shift.end) : "läuft"));

        const duration = el("td", "", fmtDur(workMs(shift)));
        if (!shift.end) duration.dataset.shift = shift.id;
        tr.append(duration, el("td", "task", shift.task || ""));

        const action = el("td");
        action.append(deleteButton(shift.id));
        tr.append(action);
        body.append(tr);
    }
}

function renderRanking() {
    const list = $("rankList");
    const range = $("rankRange").value;
    const from = range === "week" ? weekStart() : range === "month" ? monthStart() : 0;

    const rows = Object.keys(state.employees)
        .map((key) => ({ key: key, emp: state.employees[key], ms: sumMs(key, from) }))
        .sort((a, b) => b.ms - a.ms);

    list.replaceChildren();
    const max = rows.length ? Math.max(rows[0].ms, 1) : 1;
    const medals = ["🥇", "🥈", "🥉"];

    rows.forEach((r, i) => {
        const name = r.emp.name || r.key;
        const li = el("li", "rank-row");
        li.append(el("span", "rank-pos", medals[i] || String(i + 1)), avatarEl(r.emp, name));

        const mid = el("div");
        mid.append(el("div", "member-name", name + (r.key === state.meKey ? " (du)" : "")));
        const bar = el("div", "bar");
        const fill = el("span");
        fill.style.width = Math.round((r.ms / max) * 100) + "%";
        bar.append(fill);
        mid.append(bar);

        li.append(mid, el("span", "rank-time mono", fmtHM(r.ms)));
        list.append(li);
    });

    const note = $("rankNote");
    if (!rows.length || rows[0].ms === 0) {
        note.textContent = "Noch hat niemand gearbeitet. Wie überraschend.";
    } else if (rows.length > 1) {
        const first = rows[0].emp.name || rows[0].key;
        const last = rows[rows.length - 1].emp.name || rows[rows.length - 1].key;
        note.textContent = first + " ist der Streber der Runde. Schlusslicht: " + last + ".";
    } else {
        note.textContent = "";
    }
    renderTaskStats();
}

/* Farbe pro Person: eigene Avatar-Farbe, sonst eine feste Farbe aus der Palette */
const STAT_PALETTE = ["#0b5fd3", "#12805c", "#c62f2f", "#b7791f", "#7b3fc4", "#0e8a9a", "#d2559b", "#5d6b80"];
/* Verteilt Farben so, dass keine doppelt vorkommt */
function colorMap(keys) {
    const sorted = [...keys].sort();
    const map = {};
    const taken = new Set();

    /* Erst eigene Profilfarben, jede nur einmal */
    for (const key of sorted) {
        const c = ((state.employees[key] || {}).color || "").toLowerCase();
        if (c && !taken.has(c)) { map[key] = c; taken.add(c); }
    }
    /* Rest bekommt die nächste freie Farbe aus der Palette, danach generierte Farben */
    let extra = 0;
    for (const key of sorted) {
        if (map[key]) continue;
        let c = STAT_PALETTE.find((p) => !taken.has(p.toLowerCase()));
        if (!c) c = "hsl(" + ((extra++ * 47) % 360) + " 60% 45%)";
        map[key] = c;
        taken.add(c.toLowerCase());
    }
    return map;
}

function renderTaskStats() {
    const range = $("rankRange").value;
    const from = range === "week" ? weekStart() : range === "month" ? monthStart() : 0;
    const mineOnly = $("statScope").value === "me";
    const now = Date.now();

    /* totals[Tätigkeit] = { sum, by: { personKey: ms } } */
    const totals = {};
    for (const t of TASKS) totals[t] = { sum: 0, by: {} };

    for (const s of state.shifts) {
        if (mineOnly && s.emp !== state.meKey) continue;
        const end = s.end || now;
        if (end <= from) continue;
        const share = s.start >= from ? 1 : (end - from) / ((end - s.start) || 1);
        const task = s.task || "Ohne Tätigkeit";
        const ms = workMs(s, now) * share;
        if (!totals[task]) totals[task] = { sum: 0, by: {} };
        totals[task].sum += ms;
        totals[task].by[s.emp] = (totals[task].by[s.emp] || 0) + ms;
    }

    const rows = Object.keys(totals)
        .map((t) => ({ task: t, ms: totals[t].sum, by: totals[t].by }))
        .sort((a, b) => b.ms - a.ms);
    const sum = rows.reduce((a, r) => a + r.ms, 0);
    const max = Math.max(rows[0].ms, 1);

    const box = $("statList");
    box.replaceChildren();

    const usedKeys = new Set();
    const colors = colorMap(Object.keys(state.employees));

    for (const r of rows) {
        const row = el("div", "stat-row");
        row.append(el("span", "stat-label", r.task));

        /* Außen: Länge relativ zur größten Tätigkeit. Innen: Segmente pro Person. */
        const bar = el("div", "bar stacked");
        const inner = el("div", "bar-inner");
        inner.style.width = Math.round((r.ms / max) * 100) + "%";

        const people = Object.keys(r.by).sort((a, b) => r.by[b] - r.by[a]);
        for (const key of people) {
            const ms = r.by[key];
            if (ms <= 0) continue;
            usedKeys.add(key);
            const name = (state.employees[key] && state.employees[key].name) || key;
            const pct = Math.round((ms / r.ms) * 100);

            const seg = el("span", "seg");
            seg.style.width = (ms / r.ms * 100) + "%";
            seg.style.background = colors[key];
            seg.tabIndex = 0;
            seg.dataset.tip = name + ": " + fmtHM(ms) + " (" + pct + " %)";
            seg.setAttribute("aria-label", seg.dataset.tip);
            inner.append(seg);
        }
        bar.append(inner);

        const pct = sum ? Math.round((r.ms / sum) * 100) : 0;
        row.append(bar, el("span", "stat-time mono", fmtHM(r.ms) + " · " + pct + " %"));
        box.append(row);
    }

    /* Legende */
    if (usedKeys.size) {
        const legend = el("div", "legend");
        [...usedKeys]
            .sort((a, b) => String((state.employees[a] || {}).name || a).localeCompare(String((state.employees[b] || {}).name || b)))
            .forEach((key) => {
                const item = el("span", "legend-item");
                const dot = el("span", "legend-dot");
                dot.style.background = colors[key];
                item.append(dot, document.createTextNode((state.employees[key] && state.employees[key].name) || key));
                legend.append(item);
            });
        box.append(legend);
    }

    $("statNote").textContent = sum
        ? "Die meiste Zeit ging für „" + rows[0].task + "“ drauf. Pausen zählen nicht mit. Über einen Abschnitt fahren für Details."
        : "Im gewählten Zeitraum wurde noch nichts gearbeitet.";
}

tabHooks.ranking = renderRanking;
extraRenderers.push(renderRanking);

/* Löschen mit Bestätigung im Button: erster Klick fragt nach, zweiter löscht */
function deleteButton(id) {
    const button = el("button", "btn btn-small", "Löschen");
    button.type = "button";
    let armed = false;
    let timer = null;

    button.addEventListener("click", async () => {
        if (!armed) {
            armed = true;
            button.textContent = "Wirklich?";
            timer = setTimeout(() => { armed = false; button.textContent = "Löschen"; }, 3000);
            return;
        }
        clearTimeout(timer);
        button.disabled = true;
        try {
            await Store.deleteShift(id);
        } catch (e) {
            button.disabled = false;
            armed = false;
            button.textContent = "Löschen";
            toast("Löschen hat nicht geklappt.", true);
        }
    });
    return button;
}

/* Aktualisiert nur Zahlen, läuft jede Sekunde */
function updateTimes() {
    const now = Date.now();
    const ws = weekStart();

    document.querySelectorAll("[data-shift]").forEach((n) => {
        const s = state.shifts.find((x) => x.id === n.dataset.shift);
        if (s) n.textContent = fmtDur(workMs(s, now));
    });
    document.querySelectorAll("[data-wk]").forEach((n) => {
        n.textContent = fmtHM(sumMs(n.dataset.wk, ws));
    });

    if (!state.meKey) return;
    const active = activeShift(state.meKey);
    const weekText = fmtHM(sumMs(state.meKey, ws));

    $("timer").textContent = active ? fmtDur(workMs(active, now)) : "00:00:00";
    $("today").textContent = fmtHM(sumMs(state.meKey, dayStart()));
    $("week").textContent = weekText;
    $("payWeek").textContent = weekText;

    if (state.tab === "ranking") renderRanking();
    if (state.tab === "slots") renderSlots();
}

/* ---------- Aktionen ---------- */
function showTab(name) {
    if (name === "slots" && !canSlot()) name = "home";
    state.tab = name;
    state.tab = name;
    lsSet(TAB_KEY, name);
    document.querySelectorAll("[data-view]").forEach((v) => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    if (tabHooks[name]) tabHooks[name]();
}

function showApp(key, name) {
    state.meKey = key;
    state.meName = name;
    lsSet(SESSION_KEY, key);
    $("loginView").hidden = true;
    $("appView").hidden = false;
    $("userBox").hidden = false;
    render();

    const saved = lsGet(TAB_KEY);
    showTab(document.querySelector('[data-view="' + saved + '"]') ? saved : "home");
}

async function logout() {
    const active = state.meKey ? activeShift(state.meKey) : null;
    if (active) {
        try {
            await Store.updateShift(active.id, { end: active.pauseStart || Date.now(), pauseStart: null });
            toast("Beim Abmelden automatisch ausgestempelt.");
        } catch (e) { /* trotzdem abmelden */ }
    }
    lsDel(SESSION_KEY);
    state.meKey = null;
    state.meName = "";
    $("appView").hidden = true;
    $("userBox").hidden = true;
    $("loginView").hidden = false;
    $("pinIn").value = "";
}

async function handleLogin(event) {
    event.preventDefault();
    if (state.busy) return;

    const name = $("nameIn").value.trim();
    const pin = $("pinIn").value;
    const error = $("loginErr");
    error.hidden = true;
    if (!name || !pin) return;

    state.busy = true;
    $("loginBtn").disabled = true;

    try {
        const key = slug(name);
        const hash = await hashPin(key, pin);
        const existing = await Store.getEmployee(key);

        if (existing) {
            if (existing.pin !== hash) {
                error.textContent = WRONG_PASSWORD[Math.floor(Math.random() * WRONG_PASSWORD.length)];
                error.hidden = false;
                return;
            }
            showApp(key, existing.name || name);
        } else {
            await Store.createEmployee(key, { name: name, pin: hash, created: Date.now() });
            showApp(key, name);
            toast("Willkommen im Team! Dein Vertrag wurde automatisch akzeptiert.");
        }
    } catch (e) {
        console.error("Login-Fehler:", e);
        error.textContent = "Anmeldung fehlgeschlagen. Bitte noch einmal versuchen."+ (e && e.message ? e.message : e);
        error.hidden = false;
    } finally {
        state.busy = false;
        $("loginBtn").disabled = false;
    }
}

async function handleStamp() {
    if (state.busy || !state.meKey) return;
    state.busy = true;
    const button = $("stampBtn");
    button.disabled = true;

    try {
        const active = activeShift(state.meKey);
        if (active) {
            await Store.updateShift(active.id, { end: active.pauseStart || Date.now(), pauseStart: null });
            toast("Ausgestempelt. Gute Arbeit, naja, okay.");
        } else {
            const start = Date.now();
            await Store.startShift({
                id: state.meKey + "_" + start,
                emp: state.meKey,
                name: state.meName,
                task: $("taskSel").value,
                start: start,
                end: null
            });
            toast("Eingestempelt. Die Uhr läuft.");
        }
    } catch (e) {
        toast("Stempeln fehlgeschlagen. Bitte noch einmal versuchen.", true);
    } finally {
        state.busy = false;
        button.disabled = false;
    }
}

async function handlePause() {
    if (state.busy || !state.meKey) return;
    const active = activeShift(state.meKey);
    if (!active) return;

    state.busy = true;
    try {
        if (active.pauseStart) {
            await Store.updateShift(active.id, {
                pauseMs: (active.pauseMs || 0) + (Date.now() - active.pauseStart),
                pauseStart: null
            });
            toast("Pause vorbei. Zurück an die Arbeit.");
        } else {
            await Store.updateShift(active.id, { pauseStart: Date.now() });
            toast("Pause läuft. Die Uhr steht.");
        }
    } catch (e) {
        toast("Pause hat nicht geklappt.", true);
    } finally {
        state.busy = false;
    }
}

function fillProfile() {
    const me = state.employees[state.meKey] || {};
    $("pfEmoji").value = me.emoji || "";
    $("pfColor").value = me.color || "#0b5fd3";
    $("pfMorning").value = me.greetMorning || "";
    $("pfDay").value = me.greetDay || "";
    $("pfEvening").value = me.greetEvening || "";
    $("pfMotto").value = me.motto || "";
}

async function saveProfile(event) {
    event.preventDefault();
    if (!state.meKey) return;
    try {
        await Store.updateEmployee(state.meKey, {
            emoji: $("pfEmoji").value.trim() || null,
            color: $("pfColor").value,
            greetMorning: $("pfMorning").value.trim() || null,
            greetDay: $("pfDay").value.trim() || null,
            greetEvening: $("pfEvening").value.trim() || null,
            motto: $("pfMotto").value.trim() || null
        });
        toast("Profil gespeichert.");
    } catch (e) {
        toast("Speichern hat nicht geklappt.", true);
    }
}

tabHooks.profile = fillProfile;

/* Beendet Schichten, die 8 Stunden Arbeitszeit erreicht haben. Läuft bei jedem offenen Browser
   mit. Das Ende wird exakt berechnet, auch wenn die Seite erst später jemand öffnet. */
const autoStopped = new Set();

function checkAutoStop() {
    const now = Date.now();
    for (const s of state.shifts) {
        if (s.end || s.pauseStart || autoStopped.has(s.id)) continue;
        if (workMs(s, now) < MAX_WORK_MS) continue;

        autoStopped.add(s.id);
        const endTs = s.start + (s.pauseMs || 0) + MAX_WORK_MS;
        Store.updateShift(s.id, { end: endTs, pauseStart: null }).catch(() => autoStopped.delete(s.id));
        if (s.emp === state.meKey) toast("8 Stunden erreicht. Du wurdest automatisch ausgestempelt.");
    }
}

/* CSV mit Semikolon und BOM, damit Excel (de) Umlaute und Spalten richtig öffnet */
function exportCsv() {
    const mine = state.shifts.filter((s) => s.emp === state.meKey);
    if (!mine.length) { toast("Noch nichts zum Exportieren.", true); return; }

    const rows = [["Datum", "Von", "Bis", "Dauer", "Tätigkeit"]];
    for (const s of mine) {
        rows.push([
            new Date(s.start).toLocaleDateString("de-AT"),
            fmtTime(s.start),
            s.end ? fmtTime(s.end) : "läuft",
            fmtDur((s.end || Date.now()) - s.start),
            s.task || ""
        ]);
    }
    const csv = "﻿" + rows
        .map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(";"))
        .join("\r\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "zeiten-" + state.meKey + ".csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const VAC_LABEL = { pending: "Wartet auf den Chef", approved: "Genehmigt", denied: "Abgelehnt" };

async function submitVacation(event) {
    event.preventDefault();
    const from = $("vacFrom").value;
    const to = $("vacTo").value;
    if (!from || !to) return;
    if (to < from) {
        toast("Das Ende liegt vor dem Anfang. Zeitreisen sind nicht genehmigungsfähig.", true);
        return;
    }
    const id = state.meKey + "_" + Date.now();
    try {
        await Store.saveItem("vacations", {
            id: id, emp: state.meKey, name: state.meName,
            from: from, to: to, note: $("vacNote").value.trim(),
            status: "pending", created: Date.now()
        });
        $("vacationForm").reset();
        toast("Antrag eingereicht. Jetzt hilft nur noch Beten.");
    } catch (e) {
        toast("Antrag konnte nicht gesendet werden.", true);
    }
}

function decideVacation(id, status) {
    Store.updateItem("vacations", id, { status: status, decided: Date.now() })
        .then(() => toast(status === "approved" ? "Urlaub genehmigt." : "Urlaub abgelehnt. Hart, aber fair."))
        .catch(() => toast("Das hat nicht geklappt.", true));
}

function renderVacations() {
    const list = $("vacList");
    list.replaceChildren();

    const boss = isBoss();
    const shown = state.vacations
        .filter((v) => boss || v.emp === state.meKey)
        .sort((a, b) => b.created - a.created);

    $("vacTitle").textContent = boss ? "Alle Anträge (Chef-Ansicht)" : "Deine Anträge";
    $("vacEmpty").hidden = shown.length > 0;

    /* Offene Anträge als Zahl am Tab, nur für den Chef */
    const open = boss ? state.vacations.filter((v) => v.status === "pending").length : 0;
    document.querySelector('[data-tab="vacation"]').textContent = "Urlaub" + (open ? " (" + open + ")" : "");

    for (const v of shown) {
        const li = el("li", "item");

        const days = Math.round((new Date(v.to) - new Date(v.from)) / 86400000) + 1;
        const info = el("div");
        info.append(el("div", "member-name", v.name + ": " + fmtDateStr(v.from) + " bis " + fmtDateStr(v.to)));
        info.append(el("div", "member-sub", days + (days === 1 ? " Tag" : " Tage") + (v.note ? " · " + v.note : "")));

        const side = el("div", "item-side");
        const tone = v.status === "approved" ? " on" : v.status === "denied" ? " bad" : "";
        side.append(el("span", "pill" + tone, VAC_LABEL[v.status] || v.status));

        if (boss && v.status === "pending") {
            const yes = el("button", "btn btn-small btn-primary", "Genehmigen");
            yes.type = "button";
            yes.addEventListener("click", () => decideVacation(v.id, "approved"));
            const no = el("button", "btn btn-small", "Ablehnen");
            no.type = "button";
            no.addEventListener("click", () => decideVacation(v.id, "denied"));
            side.append(yes, no);
        }

        if (boss || (v.emp === state.meKey && v.status === "pending")) {
            side.append(armedButton(boss ? "Löschen" : "Zurückziehen", () => Store.removeItem("vacations", v.id)));
        }

        li.append(info, side);
        list.append(li);
    }
}

extraRenderers.push(renderVacations);

const byTime = (a, b) => String(a.time || "").localeCompare(String(b.time || ""));

function renderCalendar() {
    const y = state.cal.y;
    const m = state.cal.m;
    $("calTitle").textContent = MONTHS[m] + " " + y;

    const grid = $("calGrid");
    grid.replaceChildren();
    for (const d of ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]) grid.append(el("div", "cal-dow", d));

    const offset = (new Date(y, m, 1).getDay() + 6) % 7;   // Montag = 0
    const days = new Date(y, m + 1, 0).getDate();
    const today = todayStr();

    for (let i = 0; i < offset; i++) grid.append(el("div", "cal-cell blank"));

    for (let day = 1; day <= days; day++) {
        const ds = y + "-" + pad(m + 1) + "-" + pad(day);
        const cell = el("button", "cal-cell" + (ds === today ? " today" : ""));
        cell.type = "button";
        cell.dataset.date = ds;
        cell.append(el("span", "cal-num", String(day)));

        for (const mt of state.meetings.filter((x) => x.date === ds).sort(byTime)) {
            cell.append(el("span", "cal-ev meet", ((mt.time || "") + " " + mt.title).trim()));
        }
        for (const v of state.vacations) {
            if (v.status === "approved" && v.from <= ds && ds <= v.to) {
                cell.append(el("span", "cal-ev vac", "🏖️ " + v.name));
            }
        }
        grid.append(cell);
    }
}

function renderMeetings() {
    const list = $("meetList");
    list.replaceChildren();

    const today = todayStr();
    const upcoming = state.meetings
        .filter((x) => x.date >= today)
        .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
        .slice(0, 20);

    $("meetEmpty").hidden = upcoming.length > 0;

    for (const mt of upcoming) {
        const li = el("li", "item");
        const info = el("div");
        info.append(el("div", "member-name", mt.title));
        info.append(el("div", "member-sub",
            fmtDateStr(mt.date) + (mt.time ? " · " + mt.time + " Uhr" : "") + " · von " + (mt.name || "?")));

        const side = el("div", "item-side");
        if (isBoss() || mt.emp === state.meKey) {
            side.append(armedButton("Löschen", () => Store.removeItem("meetings", mt.id)));
        }
        li.append(info, side);
        list.append(li);
    }
}

async function submitMeeting(event) {
    event.preventDefault();
    const title = $("mtTitle").value.trim();
    const date = $("mtDate").value;
    if (!title || !date) return;

    const id = state.meKey + "_" + Date.now();
    try {
        await Store.saveItem("meetings", {
            id: id, title: title, date: date, time: $("mtTime").value || "",
            emp: state.meKey, name: state.meName
        });
        $("meetingForm").reset();
        toast("Meeting eingetragen. Alle müssen jetzt hin.");
    } catch (e) {
        toast("Meeting konnte nicht gespeichert werden.", true);
    }
}

function shiftMonth(delta) {
    const d = new Date(state.cal.y, state.cal.m + delta, 1);
    state.cal = { y: d.getFullYear(), m: d.getMonth() };
    renderCalendar();
}

extraRenderers.push(renderCalendar, renderMeetings);

function scrollChat() {
    const list = $("chatList");
    list.scrollTop = list.scrollHeight;
}

function renderChat() {
    const list = $("chatList");
    /* Nur nach unten scrollen, wenn man schon unten war (sonst nervt es beim Nachlesen) */
    const wasAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;

    list.replaceChildren();
    $("chatEmpty").hidden = state.chat.length > 0;
    $("chatClear").hidden = !isBoss();

    const todayText = new Date().toDateString();
    for (const m of state.chat) {
        const sender = state.employees[m.emp] || {};
        const when = new Date(m.ts).toDateString() === todayText
            ? fmtTime(m.ts)
            : fmtDay(m.ts) + " " + fmtTime(m.ts);

        const li = el("li", "msg" + (m.emp === state.meKey ? " mine" : ""));
        li.append(avatarEl(sender, m.name || m.emp));

        const bubble = el("div", "bubble");
        const head = el("div", "msg-head");
        head.append(el("strong", "", m.name || m.emp), document.createTextNode(" · " + when));
        bubble.append(head, el("div", "msg-text", m.text));

        li.append(bubble);
        list.append(li);
    }

    if (wasAtBottom) scrollChat();
}

async function sendChat(event) {
    event.preventDefault();
    const text = $("chatIn").value.trim();
    if (!text || !state.meKey) return;

    $("chatIn").value = "";
    try {
        await Store.sendChat({ emp: state.meKey, name: state.meName, text: text, ts: Date.now() });
        scrollChat();
    } catch (e) {
        $("chatIn").value = text;
        toast("Nachricht konnte nicht gesendet werden.", true);
    }
}

async function clearChat() {
    if (!confirm("Wirklich den gesamten Chat löschen?")) return;
    try { await Store.clearChat(); } catch (e) { toast("Löschen hat nicht geklappt.", true); }
}

tabHooks.chat = scrollChat;
extraRenderers.push(renderChat);

/* ---------- Casino ---------- */
const casino = { bet: 10, spinning: false, log: [] };
let bg67Timer = null;
const SLOT_TOTAL = SLOT_SYMBOLS.reduce((a, s) => a + s.weight, 0);

const canSlot = () => SLOT_USERS.includes(state.meKey);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Kontostand = Start + Arbeitszeit-Coins + Gewinn/Verlust aus der Datenbank */
function slotBalance() {
    const me = state.employees[state.meKey] || {};
    const earned = Math.floor(sumMs(state.meKey, 0) / 60000 * COINS_PER_MIN);
    return SLOT_START + earned + (me.slotNet || 0);
}

function pickSymbol() {
    let r = Math.random() * SLOT_TOTAL;
    for (const s of SLOT_SYMBOLS) {
        r -= s.weight;
        if (r < 0) return s;
    }
    return SLOT_SYMBOLS[0];
}

const randomSym = () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)].sym;

function evalSpin(result, bet) {
    const [a, b, c] = result.map((r) => r.sym);
    if (a === b && b === c) return { win: bet * result[0].pay, kind: "triple", sym: a };
    if (a === b || b === c || a === c) return { win: bet, kind: "pair" };
    return { win: 0, kind: "none" };
}

let sixSevenTimer = null;
function sixSeven() {
    if (casino.spinning) return;
    const reels = document.querySelectorAll("#reels .reel");
    ["6️⃣", "7️⃣", "🤷"].forEach((sym, i) => { reels[i].textContent = sym; });
    $("slotMsg").textContent = SIXSEVEN_TEXTS[Math.floor(Math.random() * SIXSEVEN_TEXTS.length)];

    const box = $("reels");
    box.classList.remove("sixseven");
    void box.offsetWidth;                    // Animation neu starten
    box.classList.add("sixseven");
    clearTimeout(sixSevenTimer);
    sixSevenTimer = setTimeout(() => box.classList.remove("sixseven"), 1800);
}

/* Baut Einsatz-Buttons und Gewinntabelle einmalig auf */
function buildCasinoUi() {
    const box = $("betBox");
    for (const value of SLOT_BETS) {
        const b = el("button", "btn btn-small", String(value));
        b.type = "button";
        b.dataset.bet = String(value);
        b.addEventListener("click", () => {
            if (casino.spinning) return;
            casino.bet = value;
            renderSlots();
            if (value === 67) sixSeven();
        });
        box.append(b);
    }

    const table = $("payTable");
    for (const s of SLOT_SYMBOLS) {
        const row = el("div", "pay-row");
        row.append(el("span", "", s.sym + " " + s.sym + " " + s.sym), el("strong", "mono", "× " + s.pay));
        table.append(row);
    }
    const pair = el("div", "pay-row");
    pair.append(el("span", "", "Zwei gleiche"), el("strong", "", "Einsatz zurück"));
    table.append(pair);
}

function renderSlots() {
    const tab = document.querySelector('[data-tab="slots"]');
    const allowed = canSlot();
    tab.hidden = !allowed;
    if (!allowed || casino.spinning) return;

    const balance = slotBalance();
    $("slotBalance").textContent = balance + " Coins";

    document.querySelectorAll("#betBox button").forEach((b) => {
        const value = Number(b.dataset.bet);
        b.classList.toggle("active", value === casino.bet);
        b.disabled = value > balance;
    });
    $("spinBtn").disabled = balance < casino.bet;

    const log = $("casinoLog");
    log.replaceChildren();
    $("casinoEmpty").hidden = casino.log.length > 0;
    for (const entry of casino.log) {
        const li = el("li", "pay-row");
        const sign = entry.delta > 0 ? "+" : entry.delta < 0 ? "−" : "±";
        li.append(el("span", "", entry.reels), el("strong", "mono", sign + Math.abs(entry.delta)));
        log.append(li);
    }
}

async function spin() {
    if (casino.spinning || !canSlot()) return;

    const bet = casino.bet;
    if (slotBalance() < bet) {
        toast("Nicht genug Coins. Geh arbeiten.", true);
        return;
    }

    /* Ergebnis steht sofort fest und wird sofort verbucht, danach läuft nur noch die Animation.
       So bringt auch Neuladen mitten im Dreh nichts. */
    const result = [pickSymbol(), pickSymbol(), pickSymbol()];
    const outcome = evalSpin(result, bet);
    const delta = outcome.win - bet;
    const slotCard = $("reels").closest(".card");
    clearTimeout(bg67Timer);
    slotCard.classList.toggle("bg67", bet === 67);

    casino.spinning = true;
    $("spinBtn").disabled = true;
    $("slotMsg").textContent = "Die Walzen drehen sich …";

    try {
        await Store.addSlotNet(state.meKey, delta);
    } catch (e) {
        casino.spinning = false;
        if (bet === 67) bg67Timer = setTimeout(() => slotCard.classList.remove("bg67"), 3500);
        renderSlots();
        toast("Dreh hat nicht geklappt.", true);
        return;
    }

    const reels = document.querySelectorAll("#reels .reel");
    const stopped = [false, false, false];
    reels.forEach((r) => r.classList.add("spinning"));
    const timer = setInterval(() => {
        reels.forEach((r, i) => { if (!stopped[i]) r.textContent = randomSym(); });
    }, 80);

    for (let i = 0; i < 3; i++) {
        await sleep(i === 0 ? 900 : 600);
        stopped[i] = true;
        reels[i].textContent = result[i].sym;
        reels[i].classList.remove("spinning");
    }
    clearInterval(timer);

    let message;
    if (outcome.kind === "triple" && outcome.sym === JACKPOT_SYM) {
        const prize = JACKPOT_PRIZES[Math.floor(Math.random() * JACKPOT_PRIZES.length)];
        message = "JACKPOT! +" + outcome.win + " Coins und: " + prize;
        Store.sendChat({
            emp: state.meKey, name: state.meName, ts: Date.now(),
            text: "🎰 JACKPOT! " + state.meName + " hat dreimal die 7 gedreht und gewinnt: " + prize
        }).catch(() => {});
    } else if (outcome.kind === "triple") {
        message = "Dreimal " + outcome.sym + "! +" + outcome.win + " Coins";
    } else if (outcome.kind === "pair") {
        message = "Zwei gleiche. Einsatz zurück.";
    } else {
        message = LOSE_TEXTS[Math.floor(Math.random() * LOSE_TEXTS.length)];
    }

    $("slotMsg").textContent = message;
    casino.log.unshift({ reels: result.map((r) => r.sym).join(" "), delta: delta });
    casino.log = casino.log.slice(0, 8);
    casino.spinning = false;
    renderSlots();
}

extraRenderers.push(renderSlots);

/* ---------- Start ---------- */
async function init() {
    for (const task of TASKS) {
        const option = el("option", "", task);
        option.value = task;
        $("taskSel").append(option);
    }

    $("loginForm").addEventListener("submit", handleLogin);
    $("forgotBtn").addEventListener("click", () => { $("forgotTxt").hidden = !$("forgotTxt").hidden; });
    $("logoutBtn").addEventListener("click", logout);
    $("stampBtn").addEventListener("click", handleStamp);
    $("exportBtn").addEventListener("click", exportCsv);
    $("pauseBtn").addEventListener("click", handlePause);
    $("tabs").addEventListener("click", (e) => {
        const b = e.target.closest("[data-tab]");
        if (b) showTab(b.dataset.tab);
    });
    $("rankRange").addEventListener("change", renderRanking);
    $("profileForm").addEventListener("submit", saveProfile);
    $("vacationForm").addEventListener("submit", submitVacation);
    $("meetingForm").addEventListener("submit", submitMeeting);
    $("calPrev").addEventListener("click", () => shiftMonth(-1));
    $("calNext").addEventListener("click", () => shiftMonth(1));
    $("calToday").addEventListener("click", () => {
        const n = new Date();
        state.cal = { y: n.getFullYear(), m: n.getMonth() };
        renderCalendar();
    });
    $("calGrid").addEventListener("click", (e) => {
        const cell = e.target.closest("[data-date]");
        if (!cell) return;
        $("mtDate").value = cell.dataset.date;
        toast("Datum übernommen: " + fmtDateStr(cell.dataset.date));
    });
    $("chatForm").addEventListener("submit", sendChat);
    $("chatClear").addEventListener("click", clearChat);
    $("statScope").addEventListener("change", renderTaskStats);
    buildCasinoUi();
    $("spinBtn").addEventListener("click", spin);

    Store.listeners.push((d) => {
        state.employees = d.employees;
        state.shifts = [...d.shifts].sort((a, b) => b.start - a.start);
        state.vacations = d.vacations;
        state.meetings = d.meetings;
        state.chat = d.chat;
        render();
    });

    setInterval(() => { updateTimes(); checkAutoStop(); }, 1000);

    /* Auf die ersten Daten warten, dann automatisch anmelden */
    await Store.start();

    const saved = lsGet(SESSION_KEY);
    if (saved && Store.data.employees[saved]) {
        showApp(saved, Store.data.employees[saved].name || saved);
    }
}

init();