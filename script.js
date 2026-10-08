"use strict";

const $ = (id) => document.getElementById(id);

$("loginForm"),addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("nameIn").value.trim();
    console.log("Login von: ",name);

    $("hello").textContent = "Gumo, " + name;
    $("loginView").hidden = true;
    $("appView").hidden = false;
})

let shifts = JSON.parse(localStorage.getItem("shifts") || "[]");

function save() {
    localStorage.setItem("shifts", JSON.stringify(shifts));
}

const pad = (n) => String(n).padStart(2, "0");

function fmtDur(ms) {
    const s = Math.floor(ms / 1000);
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (ts) => new Date(ts).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" });

// Die laufende Schicht ist die, die noch kein Ende hat
function activeShift() {
    return shifts.find((s) => !s.end);
}

function render() {
    const active = activeShift();
    $("stampBtn").textContent = active ? "Ausstempeln" : "Einstempeln";
    $("taskSel").disabled = !!active;
    updateTimer();
    renderRows();
}

function updateTimer() {
    const active = activeShift();
    $("timer").textContent = active ? fmtDur(Date.now() - active.start) : "00:00:00";
}

function renderRows() {
    const body = $("rows");
    body.replaceChildren();                       // Tabelle leeren

    for (const s of [...shifts].reverse()) {      // neueste zuerst
        const tr = document.createElement("tr");
        const cells = [
            fmtDay(s.start),
            fmtTime(s.start),
            s.end ? fmtTime(s.end) : "läuft",
            fmtDur((s.end || Date.now()) - s.start),
            s.task
        ];
        for (const text of cells) {
            const td = document.createElement("td");
            td.textContent = text;
            tr.append(td);
        }
        body.append(tr);
    }
}

$("stampBtn").addEventListener("click", () => {
    const active = activeShift();
    if (active) {
        active.end = Date.now();
    } else {
        shifts.push({ start: Date.now(), end: null, task: $("taskSel").value });
    }
    save();
    render();
});

setInterval(updateTimer, 1000);
render();