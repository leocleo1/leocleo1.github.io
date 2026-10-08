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
    "Twitch-VODs sichten",
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

/* ---------- Zustand ---------- */
const state = {
    employees: {},
    shifts: [],
    meKey: null,
    meName: "",
    busy: false
};

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
function sumMs(key, from) {
    const now = Date.now();
    let total = 0;
    for (const s of state.shifts) {
        if (s.emp !== key) continue;
        const end = s.end || now;
        const start = Math.max(s.start, from);
        if (end > start) total += end - start;
    }
    return total;
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
    data: { employees: {}, shifts: [] },
    listeners: [],

    /* Startet die Live-Verbindung. Das Promise ist fertig, sobald beide Listen einmal geladen sind. */
    start() {
        return new Promise((resolve) => {
            let gotEmployees = false;
            let gotShifts = false;
            const check = () => { if (gotEmployees && gotShifts) resolve(); };

            db.ref("employees").on("value", (snap) => {
                this.data.employees = snap.val() || {};
                gotEmployees = true;
                this.emit();
                check();
            });

            db.ref("shifts").on("value", (snap) => {
                this.data.shifts = Object.values(snap.val() || {});
                gotShifts = true;
                this.emit();
                check();
            });
        });
    },

    emit() {
        const shifts = [...this.data.shifts].sort((a, b) => b.start - a.start);
        this.listeners.forEach((fn) => fn(this.data.employees, shifts));
    },

    getEmployee(key) {
        return db.ref("employees/" + key).get().then((snap) => snap.val());
    },

    createEmployee(key, employee) {
        return db.ref("employees/" + key).set(employee);
    },

    startShift(shift) {
        return db.ref("shifts/" + shift.id).set(shift);
    },

    endShift(id) {
        return db.ref("shifts/" + id + "/end").set(Date.now());
    },

    deleteShift(id) {
        return db.ref("shifts/" + id).remove();
    }
};

/* ---------- Anzeige ---------- */
function render() {
    if (!state.meKey) return;

    const active = activeShift(state.meKey);
    const hour = new Date().getHours();
    const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";

    $("hello").textContent = greeting + ", " + state.meName;
    $("dateLine").textContent = new Date().toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
    $("userName").textContent = state.meName;
    $("userAvatar").textContent = state.meName.charAt(0).toUpperCase();

    const chip = $("statusChip");
    chip.textContent = active ? "Im Dienst" : "Nicht eingestempelt";
    chip.className = "chip" + (active ? " on" : "");

    $("status").textContent = active
        ? "Seit " + fmtTime(active.start) + " im Dienst: " + active.task
        : "Gerade nicht eingestempelt.";

    const button = $("stampBtn");
    button.textContent = active ? "Ausstempeln" : "Einstempeln";
    button.className = "stamp-btn" + (active ? " out" : "");

    const select = $("taskSel");
    select.disabled = !!active;
    if (active) select.value = active.task;

    renderTeam();
    renderRows();
    updateTimes();
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
        if (active) online++;

        const li = el("li", "member");
        li.append(el("span", "avatar", name.charAt(0).toUpperCase()));

        const info = el("div");
        info.append(el("div", "member-name", name + (key === state.meKey ? " (du)" : "")));

        const sub = el("div", "member-sub");
        if (active) {
            sub.append(document.createTextNode(active.task + " · seit " + fmtTime(active.start) + " · "));
            const since = el("span", "mono");
            since.dataset.since = String(active.start);
            sub.append(since);
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

        li.append(info, el("span", "pill" + (active ? " on" : ""), active ? "Im Büro" : "Nicht erreichbar"));
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

        const duration = el("td", "", fmtDur((shift.end || Date.now()) - shift.start));
        if (!shift.end) duration.dataset.since = String(shift.start);
        tr.append(duration, el("td", "task", shift.task || ""));

        const action = el("td");
        action.append(deleteButton(shift.id));
        tr.append(action);
        body.append(tr);
    }
}

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

    document.querySelectorAll("[data-since]").forEach((n) => {
        n.textContent = fmtDur(now - Number(n.dataset.since));
    });
    document.querySelectorAll("[data-wk]").forEach((n) => {
        n.textContent = fmtHM(sumMs(n.dataset.wk, ws));
    });

    if (!state.meKey) return;
    const active = activeShift(state.meKey);
    const weekText = fmtHM(sumMs(state.meKey, ws));

    $("timer").textContent = active ? fmtDur(now - active.start) : "00:00:00";
    $("today").textContent = fmtHM(sumMs(state.meKey, dayStart()));
    $("week").textContent = weekText;
    $("payWeek").textContent = weekText;
}

/* ---------- Aktionen ---------- */
function showApp(key, name) {
    state.meKey = key;
    state.meName = name;
    lsSet(SESSION_KEY, key);
    $("loginView").hidden = true;
    $("appView").hidden = false;
    $("userBox").hidden = false;
    render();
}

function logout() {
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
        error.textContent = "Anmeldung fehlgeschlagen. Bitte noch einmal versuchen.";
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
            await Store.endShift(active.id);
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

    Store.listeners.push((employees, shifts) => {
        state.employees = employees;
        state.shifts = shifts;
        render();
    });

    setInterval(updateTimes, 1000);

    /* Auf die ersten Daten warten, dann automatisch anmelden */
    await Store.start();

    const saved = lsGet(SESSION_KEY);
    if (saved && Store.data.employees[saved]) {
        showApp(saved, Store.data.employees[saved].name || saved);
    }
}

init();