// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
const COLS = 2, ROWS = 2;
let selectedIndex = 0;
let appMode = 'nav'; // 'nav' | 'pan' | 'timeline'

// 360° pan state (un par caméra)
let yawPerCam   = [-90, -90, -90, -90];
let pitchPerCam = [0, 0, 0, 0];
const PAN_SPEED  = 1.2, PITCH_LIMIT = 75;

// Timeline scrub
const SCRUB_SPEED      = 5;
const SCRUB_DZONE      = 0.20;
const SCRUB_ACCEL      = 1.03;   // facteur d'accélération par frame
const SCRUB_SPEED_MAX  = 60;     // vitesse max (secondes/s équivalent)
let scrubSpeed         = SCRUB_SPEED; // vitesse courante, réinitialisée dès relâchement

// Gamepad
const DEADZONE  = 0.35;
const NAV_DELAY = 280;
let gamepadIndex  = null;
let lastNavTime   = 0;
let lastAxisState = { x: 0, y: 0 };
let lastBtnState  = {};

let btnMap = { pan: 1, timeline: 2, back: 0, zoomIn: 4, zoomOut: 5 };

// Zoom state (FOV par caméra — valeur par défaut A-Frame = 80)
const FOV_DEFAULT   = 80;
const FOV_MIN       = 20;    // zoom max
const FOV_MAX       = 100;   // dézoom max
const ZOOM_SPEED_BASE = 0.4; // degrés FOV / frame au départ
const ZOOM_ACCEL    = 1.04;  // facteur d'accélération par frame
const ZOOM_SPEED_MAX = 6;    // vitesse max
let fovPerCam = [FOV_DEFAULT, FOV_DEFAULT, FOV_DEFAULT, FOV_DEFAULT];

// Timers pour hide de la jauge
let zoomHideTimers = [null, null, null, null];

function getZoomGauge(idx) { return document.getElementById(`zoomGauge-${idx}`); }
function getZoomFill(idx)  { return document.getElementById(`zoomFill-${idx}`); }
function getZoomThumb(idx) { return document.getElementById(`zoomThumb-${idx}`); }
function getZoomPct(idx)   { return document.getElementById(`zoomPct-${idx}`); }

// pct : 0 = FOV_MAX (dézoom max) → 100 = FOV_MIN (zoom max)
function fovToPct(fov) {
    return Math.round((FOV_MAX - fov) / (FOV_MAX - FOV_MIN) * 100);
}

function updateZoomGauge(idx) {
    const pct  = fovToPct(fovPerCam[idx]);
    const fill = getZoomFill(idx);
    const thumb = getZoomThumb(idx);
    const label = getZoomPct(idx);
    if (fill)  fill.style.height  = pct + '%';
    if (thumb) thumb.style.bottom = pct + '%';
    if (label) label.textContent  = pct + '%';
}

function showZoomGauge(idx) {
    clearTimeout(zoomHideTimers[idx]);
    const g = getZoomGauge(idx);
    if (g) g.classList.add('visible');
}

function scheduleHideZoomGauge(idx) {
    clearTimeout(zoomHideTimers[idx]);
    zoomHideTimers[idx] = setTimeout(() => {
        const g = getZoomGauge(idx);
        if (g) g.classList.remove('visible');
    }, 1200);
}

function applyZoom(idx, delta) {
    fovPerCam[idx] = Math.max(FOV_MIN, Math.min(FOV_MAX, fovPerCam[idx] + delta));
    const cam = getCam(idx);
    if (cam) cam.setAttribute('camera', `fov: ${fovPerCam[idx]}`);
    updateZoomGauge(idx);
    showZoomGauge(idx);
}

function resetZoom(idx) {
    fovPerCam[idx] = FOV_DEFAULT;
    const cam = getCam(idx);
    if (cam) cam.setAttribute('camera', `fov: ${FOV_DEFAULT}`);
    updateZoomGauge(idx);
}

// Initialise les jauges au chargement
window.addEventListener('DOMContentLoaded', () => {
    for (let i = 0; i < 4; i++) updateZoomGauge(i);
});

// État hold-to-zoom
let zoomInSpeed  = ZOOM_SPEED_BASE;
let zoomOutSpeed = ZOOM_SPEED_BASE;

// ══════════════════════════════════════════════════════
//  HELPERS : accès aux éléments par index caméra
// ══════════════════════════════════════════════════════
function getVideo(idx)    { return document.getElementById(`video360-${idx}`); }
function getCam(idx)      { return document.getElementById(`cam360-${idx}`); }
function getTlFill(idx)   { return document.getElementById(`tlFill-${idx}`); }
function getTlThumb(idx)  { return document.getElementById(`tlThumb-${idx}`); }
function getTlCurrent(idx){ return document.getElementById(`tlCurrent-${idx}`); }
function getTlDuration(idx){ return document.getElementById(`tlDuration-${idx}`); }

// Pause TOUTES les vidéos sauf celle de l'index indiqué (-1 = toutes)
function pauseAllVideosExcept(exceptIdx) {
    for (let i = 0; i < 4; i++) {
        if (i === exceptIdx) continue;
        const v = getVideo(i);
        if (v) v.pause();
    }
}

// ══════════════════════════════════════════════════════
//  TIMELINE
// ══════════════════════════════════════════════════════
function fmtTime(s) {
    if (!isFinite(s)) return '--:--';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

function updateTimelineUI(idx) {
    const vid = getVideo(idx);
    if (!vid || !vid.duration) return;
    const pct = (vid.currentTime / vid.duration) * 100;
    getTlFill(idx).style.width  = pct + '%';
    getTlThumb(idx).style.left  = pct + '%';
    getTlCurrent(idx).textContent  = fmtTime(vid.currentTime);
    getTlDuration(idx).textContent = fmtTime(vid.duration);
}

// Attacher les listeners timeupdate sur chaque vidéo
for (let i = 0; i < 4; i++) {
    (function(idx) {
        window.addEventListener('DOMContentLoaded', () => {
            const v = getVideo(idx);
            if (!v) return;
            v.addEventListener('timeupdate',     () => { if (appMode === 'timeline' && selectedIndex === idx) updateTimelineUI(idx); });
            v.addEventListener('loadedmetadata', () => {
                v.currentTime = 30; // Démarre à 30 secondes
                updateTimelineUI(idx);
            });
        });
    })(i);
}

function scrubVideo(idx, delta) {
    const vid = getVideo(idx);
    if (!vid || !vid.duration) return;
    vid.currentTime = Math.max(0, Math.min(vid.duration, vid.currentTime + delta));
    updateTimelineUI(idx);
}

// ══════════════════════════════════════════════════════
//  TIMESTAMPS
// ══════════════════════════════════════════════════════
function updateTimestamps() {
    const t = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    for (let i = 1; i <= 4; i++) document.getElementById('time' + i).textContent = t;
}
updateTimestamps();
setInterval(updateTimestamps, 1000);

// ══════════════════════════════════════════════════════
//  MODE MANAGEMENT
// ══════════════════════════════════════════════════════
const modeBar     = document.getElementById('modeBar');
const modeLabel   = document.getElementById('modeLabel');
const modeHint    = document.getElementById('modeHint');
const btnNav      = document.getElementById('btnNav');
const btnPan      = document.getElementById('btnPan');
const btnTimeline = document.getElementById('btnTimeline');

function clearModeClasses() {
    document.querySelectorAll('.camera-feed').forEach(f =>
        f.classList.remove('mode-pan', 'mode-timeline', 'scrubbing-left', 'scrubbing-right'));
    modeBar.classList.remove('mode-pan', 'mode-timeline');
    btnNav.className = btnPan.className = btnTimeline.className = 'mode-btn';
}

function setMode(mode) {
    const selFeed = document.querySelector(`.camera-feed[data-index="${selectedIndex}"]`);
    const is360   = selFeed && selFeed.dataset.type === '360';

    if ((mode === 'pan' || mode === 'timeline') && !is360) return;

    clearModeClasses();
    appMode = mode;

    const vid = getVideo(selectedIndex);

    if (mode === 'nav') {
        // Pause UNIQUEMENT la vidéo active
        if (vid) vid.pause();
        btnNav.classList.add('active-nav');
        modeLabel.textContent = 'NAV';
        modeHint.textContent  = 'A = pan · Y = timeline · B = retour';

    } else if (mode === 'pan') {
        btnPan.classList.add('active-pan');
        modeBar.classList.add('mode-pan');
        modeLabel.textContent = 'PAN 360°';
        modeHint.textContent  = 'stick = vue · B = retour';
        selFeed.classList.add('mode-pan');

        // Pause toutes les autres, joue uniquement celle-ci
        pauseAllVideosExcept(selectedIndex);
        if (vid) {
            vid.play().catch(() => {
                document.addEventListener('click', () => vid.play().catch(() => {}), { once: true });
            });
        }

    } else if (mode === 'timeline') {
        btnTimeline.classList.add('active-timeline');
        modeBar.classList.add('mode-timeline');
        modeLabel.textContent = 'TIMELINE';
        modeHint.textContent  = '← → scrub · B = retour';
        selFeed.classList.add('mode-timeline');
        scrubSpeed = SCRUB_SPEED; // reset à l'entrée du mode

        // Pause toutes les vidéos en mode timeline (scrub frame par frame)
        pauseAllVideosExcept(-1);
        updateTimelineUI(selectedIndex);
    }
}

// ══════════════════════════════════════════════════════
//  CAMERA SELECTION
// ══════════════════════════════════════════════════════
const feeds = () => document.querySelectorAll('.camera-feed');

function selectCamera(index) {
    if (appMode !== 'nav') setMode('nav');
    feeds().forEach(f => f.classList.remove('selected'));
    const target = document.querySelector(`.camera-feed[data-index="${index}"]`);
    if (target) { target.classList.add('selected'); selectedIndex = index; }
}

feeds().forEach(f => {
    f.addEventListener('click', () => {
        const idx = parseInt(f.dataset.index);
        if (appMode === 'nav' && idx === selectedIndex) {
            setMode('pan');
        } else {
            selectCamera(idx);
        }
    });
});

// ══════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════
function navigate(dir) {
    if (appMode !== 'nav') return;
    const row = Math.floor(selectedIndex / COLS), col = selectedIndex % COLS;
    let r = row, c = col;
    if (dir === 'up')    r = (row - 1 + ROWS) % ROWS;
    if (dir === 'down')  r = (row + 1) % ROWS;
    if (dir === 'left')  c = (col - 1 + COLS) % COLS;
    if (dir === 'right') c = (col + 1) % COLS;
    selectCamera(r * COLS + c);
}

// ══════════════════════════════════════════════════════
//  KEYBOARD
// ══════════════════════════════════════════════════════
window.addEventListener('keydown', e => {
    const d = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' };
    if (appMode === 'nav' && d[e.key]) { e.preventDefault(); navigate(d[e.key]); }
    if (appMode === 'timeline') {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); scrubVideo(selectedIndex, -2); }
        if (e.key === 'ArrowRight') { e.preventDefault(); scrubVideo(selectedIndex,  2); }
    }
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setMode(appMode === 'nav' ? 'pan' : 'nav');
    }
    if (e.key === 'Escape') setMode('nav');
    if (e.key === '+' || e.key === '=') { applyZoom(selectedIndex, -5); scheduleHideZoomGauge(selectedIndex); }
    if (e.key === '-')                   { applyZoom(selectedIndex, +5); scheduleHideZoomGauge(selectedIndex); }
    if (e.key === 'i' || e.key === 'I')  { e.preventDefault(); captureAndPrint(selectedIndex); }
});

// ══════════════════════════════════════════════════════
//  GAMEPAD
// ══════════════════════════════════════════════════════
const statusEl = document.getElementById('joystickStatus');
const labelEl  = document.getElementById('joystickLabel');
const vizEl    = document.getElementById('joystickViz');
const dotEl    = document.getElementById('joystickDot');
const btnDebug = document.getElementById('btnDebug');
const dbgBtn   = document.getElementById('dbgBtn');
const dbgAll   = document.getElementById('dbgAll');

window.addEventListener('gamepadconnected', e => {
    gamepadIndex = e.gamepad.index;
    statusEl.classList.add('connected');
    labelEl.textContent = e.gamepad.id.substring(0, 28);
    vizEl.classList.add('visible');
    btnDebug.classList.add('visible');
    requestAnimationFrame(gamepadLoop);
});
window.addEventListener('gamepaddisconnected', e => {
    if (e.gamepad.index !== gamepadIndex) return;
    gamepadIndex = null;
    statusEl.classList.remove('connected');
    labelEl.textContent = 'Joystick déconnecté';
    vizEl.classList.remove('visible');
    btnDebug.classList.remove('visible');
});

let dbgFlashTimer = null;

function gamepadLoop() {
    if (gamepadIndex === null) return;
    const gp = navigator.getGamepads()[gamepadIndex];
    if (!gp) { requestAnimationFrame(gamepadLoop); return; }

    const axisX = gp.axes[0] ?? 0;
    const axisY = gp.axes[1] ?? 0;
    const now   = performance.now();

    dotEl.style.transform = `translate(${axisX * 22}px, ${axisY * 22}px)`;

    const rising = {};
    const activeIdxs = [];
    for (let i = 0; i < gp.buttons.length; i++) {
        const pressed = !!(gp.buttons[i]?.pressed);
        const prev    = !!lastBtnState[i];
        rising[i]     = pressed && !prev;
        lastBtnState[i] = pressed;
        if (pressed) activeIdxs.push(i);
        if (rising[i]) {
            dbgBtn.textContent = `#${i}`;
            clearTimeout(dbgFlashTimer);
            dbgFlashTimer = setTimeout(() => { dbgBtn.textContent = '—'; }, 1500);
        }
    }
    if (activeIdxs.length > 0) dbgAll.textContent = activeIdxs.join(', ');

    if (rising[btnMap.pan])      setMode(appMode === 'pan'      ? 'nav' : 'pan');
    if (rising[btnMap.timeline]) setMode(appMode === 'timeline' ? 'nav' : 'timeline');
    if (rising[btnMap.back])     setMode('nav');

    // ── Zoom progressif au maintien ──
    const zoomInHeld  = !!(gp.buttons[btnMap.zoomIn]?.pressed);
    const zoomOutHeld = !!(gp.buttons[btnMap.zoomOut]?.pressed);

    if (zoomInHeld) {
        applyZoom(selectedIndex, -zoomInSpeed);
        zoomInSpeed = Math.min(ZOOM_SPEED_MAX, zoomInSpeed * ZOOM_ACCEL);
    } else {
        if (rising[btnMap.zoomIn] === false && !zoomInHeld) zoomInSpeed = ZOOM_SPEED_BASE;
        zoomInSpeed = ZOOM_SPEED_BASE;
    }
    if (zoomOutHeld) {
        applyZoom(selectedIndex, +zoomOutSpeed);
        zoomOutSpeed = Math.min(ZOOM_SPEED_MAX, zoomOutSpeed * ZOOM_ACCEL);
    } else {
        zoomOutSpeed = ZOOM_SPEED_BASE;
    }
    // Masquer la jauge après relâchement
    if (!zoomInHeld && !zoomOutHeld) scheduleHideZoomGauge(selectedIndex);

    // ── Mode PAN : rotation de la caméra sélectionnée uniquement ──
    if (appMode === 'pan') {
        const cam = getCam(selectedIndex);
        if (cam) {
            if (Math.abs(axisX) > SCRUB_DZONE) yawPerCam[selectedIndex]   -= axisX * PAN_SPEED;
            if (Math.abs(axisY) > SCRUB_DZONE) pitchPerCam[selectedIndex] -= axisY * PAN_SPEED;
            pitchPerCam[selectedIndex] = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchPerCam[selectedIndex]));
            cam.setAttribute('rotation', `${pitchPerCam[selectedIndex]} ${yawPerCam[selectedIndex]} 0`);
        }

    // ── Mode TIMELINE : scrub de la vidéo sélectionnée ──
    } else if (appMode === 'timeline') {
        const selFeed = document.querySelector(`.camera-feed[data-index="${selectedIndex}"]`);
        if (Math.abs(axisX) > SCRUB_DZONE) {
            scrubVideo(selectedIndex, axisX * scrubSpeed * (1 / 60));
            scrubSpeed = Math.min(SCRUB_SPEED_MAX, scrubSpeed * SCRUB_ACCEL);
            if (selFeed) {
                selFeed.classList.toggle('scrubbing-left',  axisX < 0);
                selFeed.classList.toggle('scrubbing-right', axisX > 0);
            }
        } else {
            scrubSpeed = SCRUB_SPEED; // reset dès relâchement
            if (selFeed) selFeed.classList.remove('scrubbing-left', 'scrubbing-right');
        }

    // ── Mode NAV ──
    } else {
        if (now - lastNavTime > NAV_DELAY) {
            if (axisX >  DEADZONE && lastAxisState.x <=  DEADZONE) { navigate('right'); lastNavTime = now; }
            if (axisX < -DEADZONE && lastAxisState.x >= -DEADZONE) { navigate('left');  lastNavTime = now; }
            if (axisY >  DEADZONE && lastAxisState.y <=  DEADZONE) { navigate('down');  lastNavTime = now; }
            if (axisY < -DEADZONE && lastAxisState.y >= -DEADZONE) { navigate('up');    lastNavTime = now; }
        }
        const dX = gp.axes[6] ?? 0, dY = gp.axes[7] ?? 0;
        if (now - lastNavTime > NAV_DELAY) {
            if (dX >  0.5) { navigate('right'); lastNavTime = now; }
            if (dX < -0.5) { navigate('left');  lastNavTime = now; }
            if (dY >  0.5) { navigate('down');  lastNavTime = now; }
            if (dY < -0.5) { navigate('up');    lastNavTime = now; }
        }
        const dpMap = { 12:'up', 13:'down', 14:'left', 15:'right' };
        for (const [idx, dir] of Object.entries(dpMap)) {
            if (gp.buttons[idx]?.pressed && now - lastNavTime > NAV_DELAY) {
                navigate(dir); lastNavTime = now;
            }
        }
    }

    lastAxisState = { x: axisX, y: axisY };
    requestAnimationFrame(gamepadLoop);
}

// ══════════════════════════════════════════════════════
//  CAPTURE & PRINT (touche I)
// ══════════════════════════════════════════════════════
let snapshotToastTimer = null;

function captureAndPrint(idx) {
    // Capture la frame vidéo brute via un canvas 2D
    const vid = getVideo(idx);
    let dataUrl = null;

    if (vid && vid.readyState >= 2) {
        const tmp = document.createElement('canvas');
        tmp.width  = vid.videoWidth  || 1280;
        tmp.height = vid.videoHeight || 720;
        const ctx = tmp.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(vid, 0, 0, tmp.width, tmp.height);
        dataUrl = tmp.toDataURL('image/jpeg', 0.92);
    }

    if (!dataUrl) {
        console.warn('Snapshot: vidéo non prête (readyState=' + (vid ? vid.readyState : 'null') + ')');
        return;
    }

    // 2. Flash blanc
    const flash = document.getElementById('snapshotFlash');
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 200);

    // 3. Toast
    const toast = document.getElementById('snapshotToast');
    clearTimeout(snapshotToastTimer);
    toast.classList.add('visible');
    snapshotToastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);

    // 4. Métadonnées
    const feed = document.querySelector(`.camera-feed[data-index="${idx}"]`);
    const loc  = feed ? (feed.querySelector('.location-tag')?.textContent || '') : '';
    const now  = new Date().toLocaleString('fr-FR');
    const meta = `CAM ${String(idx + 1).padStart(2,'0')}  ·  ${loc}  ·  ${now}`;

    // 5. Ouvre une fenêtre popup avec uniquement l'image et lance l'impression
    const pw = window.open('', '_blank', 'width=900,height=700');
    if (!pw) { console.warn('Popup bloqué par le navigateur'); return; }

    const pd = pw.document;

    const style = pd.createElement('style');
    style.textContent = '* { margin:0; padding:0; box-sizing:border-box; } body { text-align:center; font-family:"Courier New",monospace; } img { max-width:100%; } p { font-size:9pt; margin-top:6px; color:#000; }';
    pd.head.appendChild(style);

    const img = pd.createElement('img');
    img.src = dataUrl;
    pd.body.appendChild(img);

    const p = pd.createElement('p');
    p.textContent = meta;
    pd.body.appendChild(p);

    setTimeout(function() {
        pw.print();
        setTimeout(function() { pw.close(); }, 500);
    }, 300);
}
