// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
const COLS = 3, ROWS = 2;
let selectedIndex = 0;
let appMode = 'nav';

let yawPerCam   = [-90, -90, -90, -90, -90, -90, -90, -90];
let pitchPerCam = [0, 0, 0, 0, 0, 0, 0, 0];
const PAN_SPEED  = 1.2, PITCH_LIMIT = 75;

// Timeline — vitesse réduite
const SCRUB_SPEED     = 5;
const SCRUB_DZONE     = 0.20;
const SCRUB_ACCEL     = 1.03;
const SCRUB_SPEED_MAX = 60;
let scrubSpeed = SCRUB_SPEED;

const DEADZONE  = 0.35;
const NAV_DELAY = 300;
let gamepadIndex  = null;
let lastNavTime   = 0;
let lastAxisState = { x: 0, y: 0 };
let lastBtnState  = {};
let btnMap = { back: 0, pan: 1, timeline: 2, fullscreen: 3, zoomIn: 4, zoomOut: 5 };

const FOV_DEFAULT     = 80;
const FOV_MIN         = 20;
const FOV_MAX         = 100;
const ZOOM_SPEED_BASE = 0.4;
const ZOOM_ACCEL      = 1.04;
const ZOOM_SPEED_MAX  = 6;
let fovPerCam    = [FOV_DEFAULT, FOV_DEFAULT, FOV_DEFAULT, FOV_DEFAULT, FOV_DEFAULT, FOV_DEFAULT, FOV_DEFAULT, FOV_DEFAULT];
let zoomHideTimers = [null, null, null, null, null, null, null, null];
let zoomInSpeed  = ZOOM_SPEED_BASE;
let zoomOutSpeed = ZOOM_SPEED_BASE;

// ── Helpers ──
function getVideo(i)     { return document.getElementById(`video360-${i}`); }
function getCam(i)       { return document.getElementById(`cam360-${i}`); }
function getTlFill(i)    { return document.getElementById(`tlFill-${i}`); }
function getTlThumb(i)   { return document.getElementById(`tlThumb-${i}`); }
function getTlCurrent(i) { return document.getElementById(`tlCurrent-${i}`); }
function getTlDuration(i){ return document.getElementById(`tlDuration-${i}`); }

function pauseAllVideosExcept(ex) {
    for (let i = 0; i < 6; i++) { if (i !== ex) { const v = getVideo(i); if (v) v.pause(); } }
}

// ── Indicateur lecture (mode-playing) ──
function updateCamClock(idx, totalSeconds) {
    const t = fmtClock(totalSeconds);
    const timeEl  = document.getElementById(`time${idx + 1}`);
    const fsmTime = document.getElementById(`fsm-time${idx + 1}`);
    if (timeEl)  timeEl.textContent  = t;
    if (fsmTime) fsmTime.textContent = t;
}

function onVideoTimeUpdate() {
    const vid = getVideo(selectedIndex);
    if (!vid) return;
    updateCamClock(selectedIndex, CAM_START_TIMES[selectedIndex] + vid.currentTime);
}

function onVideoPlay() {
    document.querySelector(`.rf-camera-card[data-index="${selectedIndex}"]`)?.classList.add('mode-playing');
    const btnPlay = document.getElementById('btnPlay');
    const btnPan  = document.getElementById('btnPan');
    if (btnPan)  btnPan.classList.remove('active-pan');
    if (btnPlay) btnPlay.classList.add('active-playing');
    const vid = getVideo(selectedIndex);
    if (vid) vid.addEventListener('timeupdate', onVideoTimeUpdate);
}
function onVideoPause() {
    document.querySelector(`.rf-camera-card[data-index="${selectedIndex}"]`)?.classList.remove('mode-playing');
    const btnPlay = document.getElementById('btnPlay');
    const btnPan  = document.getElementById('btnPan');
    if (btnPlay) btnPlay.classList.remove('active-playing');
    if (btnPan)  btnPan.classList.add('active-pan');
    const vid = getVideo(selectedIndex);
    if (vid) vid.removeEventListener('timeupdate', onVideoTimeUpdate);
}

// ── Zoom ──
function fovToPct(fov) { return Math.round((FOV_MAX - fov) / (FOV_MAX - FOV_MIN) * 100); }

function updateZoomGauge(idx) {
    const pct   = fovToPct(fovPerCam[idx]);
    const fill  = document.getElementById(`zoomFill-${idx}`);
    const thumb = document.getElementById(`zoomThumb-${idx}`);
    const label = document.getElementById(`zoomPct-${idx}`);
    if (fill)  fill.style.height  = pct + '%';
    if (thumb) thumb.style.bottom = pct + '%';
    if (label) label.textContent  = pct + '%';
}
function showZoomGauge(idx) {
    clearTimeout(zoomHideTimers[idx]);
    const g = document.getElementById(`zoomGauge-${idx}`);
    if (g) g.classList.add('visible');
}
function scheduleHideZoomGauge(idx) {
    clearTimeout(zoomHideTimers[idx]);
    zoomHideTimers[idx] = setTimeout(() => {
        const g = document.getElementById(`zoomGauge-${idx}`);
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

window.addEventListener('DOMContentLoaded', () => {
    for (let i = 0; i < 6; i++) {
        updateZoomGauge(i);
        // Initialise l'heure de départ de chaque caméra
        updateCamClock(i, CAM_START_TIMES[i]);

        // Ajoute l'heure dans le bandeau fullscreen
        const bar = document.querySelector(`.rf-camera-card[data-index="${i}"] .rf-fullscreen-mode-bar`);
        if (bar) {
            const fsTime = document.createElement('span');
            fsTime.className = 'rf-fsm-time';
            fsTime.id = `fsm-time${i + 1}`;
            fsTime.textContent = fmtClock(CAM_START_TIMES[i]);
            bar.appendChild(fsTime);
        }
        const v = getVideo(i);
        if (v) {
            v.load();
            v.addEventListener('loadedmetadata', () => {
                scrubPosition[i] = 0;
                updateTimelineUI(i);
            }, { once: true });
        }
    }
});

// ── Timeline ──
function fmtTime(s) {
    if (!isFinite(s)) return '--:--';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}
for (let i = 0; i < 6; i++) {
    (function(idx) {
        window.addEventListener('DOMContentLoaded', () => {
            const v = getVideo(idx);
            if (!v) return;
            v.addEventListener('timeupdate', () => {
                if (appMode === 'timeline' && selectedIndex === idx) updateTimelineUI(idx);
            });
            v.addEventListener('loadedmetadata', () => {
                updateTimelineUI(idx);
            }, { once: true });
        });
    })(i);
}
// Position de scrub virtuelle (indépendante d'A-Frame)
const scrubPosition = [0, 0, 0, 0, 0, 0];
let scrubPauseTimer = null;

function scrubVideo(idx, delta) {
    const vid = getVideo(idx);
    if (!vid || !isFinite(vid.duration) || vid.duration === 0) return;

    scrubPosition[idx] = Math.max(0, Math.min(vid.duration, scrubPosition[idx] + delta));

    // Joue la vidéo pour que la frame se mette à jour visuellement
    vid.play().then(() => {
        vid.currentTime = scrubPosition[idx];
    }).catch(() => {});

    // Met en pause après 150ms d'inactivité joystick
    clearTimeout(scrubPauseTimer);
    scrubPauseTimer = setTimeout(() => {
        vid.pause();
    }, 150);

    updateTimelineUI(idx);
}

// Heures de départ des caméras (en secondes depuis minuit)
const CAM_START_TIMES = [
    14 * 3600 + 22 * 60, // Cam 0 — 14h22
    14 * 3600 + 28 * 60, // Cam 1 — 14h28
    14 * 3600 + 37 * 60, // Cam 2 — 14h37
    14 * 3600 + 45 * 60, // Cam 3 — 14h45
    14 * 3600 + 51 * 60, // Cam 4 — 14h51
    14 * 3600 + 56 * 60, // Cam 5 — 14h56
];

function fmtClock(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function updateTimelineUI(idx) {
    const pct = scrubPosition[idx] / (getVideo(idx)?.duration || 1) * 100;
    const fill  = document.getElementById(`tlFill-${idx}`);
    const thumb = document.getElementById(`tlThumb-${idx}`);
    const cur   = document.getElementById(`tlCurrent-${idx}`);
    const dur   = document.getElementById(`tlDuration-${idx}`);
    if (fill)  fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
    if (cur)   cur.textContent  = fmtTime(scrubPosition[idx]);
    const vid = getVideo(idx);
    if (dur && vid && isFinite(vid.duration)) dur.textContent = fmtTime(vid.duration);

    // Met à jour l'heure de la caméra selon la position dans la timeline
    updateCamClock(idx, CAM_START_TIMES[idx] + scrubPosition[idx]);
}



// ── Mode ──
function clearModeClasses() {
    document.querySelectorAll('.rf-camera-card').forEach(f =>
        f.classList.remove('mode-pan', 'mode-focus', 'mode-timeline', 'mode-playing', 'scrubbing-left', 'scrubbing-right'));
    ['btnNav','btnPan','btnTimeline'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.className = 'rf-tab';
    });
}

function updateFooter() {
    const modeLabels = { nav: 'NAVIGATION', focus: 'FOCUS — ORIENTATION', pan: 'PANORAMIQUE 360°', timeline: 'LECTURE TEMPORELLE' };
    const fm = document.getElementById('footerMode');
    const fc = document.getElementById('footerCam');
    if (fm) fm.textContent = modeLabels[appMode] || appMode;
    if (fc) fc.textContent = String(selectedIndex + 1).padStart(2, '0');
}

function setMode(mode) {
    const selFeed = document.querySelector(`.rf-camera-card[data-index="${selectedIndex}"]`);
    const is360   = selFeed && selFeed.dataset.type === '360';
    if ((mode === 'focus' || mode === 'pan' || mode === 'timeline') && !is360) return;

    clearModeClasses();
    appMode = mode;
    const vid = getVideo(selectedIndex);

    if (mode === 'nav') {
        if (vid) vid.pause();
        const btn = document.getElementById('btnNav'); if (btn) btn.classList.add('active-nav');

    } else if (mode === 'focus') {
        const btn = document.getElementById('btnPan'); if (btn) btn.classList.add('active-focus');
        if (selFeed) selFeed.classList.add('mode-focus');
        pauseAllVideosExcept(-1);

    } else if (mode === 'pan') {
        const btn = document.getElementById('btnPan'); if (btn) btn.classList.add('active-pan');
        if (selFeed) selFeed.classList.add('mode-pan');
        pauseAllVideosExcept(selectedIndex);
        if (vid) vid.play().catch(() => {
            document.addEventListener('click', () => vid.play().catch(() => {}), { once: true });
        });

        // Indicateur visuel lecture / pause — listeners nommés pour éviter les doublons
        if (vid) {
            vid.removeEventListener('play',  onVideoPlay);
            vid.removeEventListener('pause', onVideoPause);
            vid.addEventListener('play',  onVideoPlay);
            vid.addEventListener('pause', onVideoPause);
        }

    } else if (mode === 'timeline') {
        const btn = document.getElementById('btnTimeline'); if (btn) btn.classList.add('active-timeline');
        if (selFeed) selFeed.classList.add('mode-timeline');
        scrubSpeed = SCRUB_SPEED;
        pauseAllVideosExcept(-1);
        if (vid) {
            if (vid.readyState >= 1) {
                updateTimelineUI(selectedIndex);
            } else {
                // Force le chargement des métadonnées via play/pause
                vid.play().then(() => {
                    vid.pause();
                    updateTimelineUI(selectedIndex);
                }).catch(() => {
                    vid.addEventListener('loadedmetadata', () => updateTimelineUI(selectedIndex), { once: true });
                });
            }
        }
    }
    updateFooter();
}

// ── Sélection ──
function selectCamera(index) {
    if (appMode !== 'nav') setMode('nav');
    document.querySelectorAll('.rf-camera-card').forEach(f => f.classList.remove('selected'));
    const target = document.querySelector(`.rf-camera-card[data-index="${index}"]`);
    if (target) { target.classList.add('selected'); selectedIndex = index; }
    updateFooter();
}

document.querySelectorAll('.rf-camera-card').forEach(f => {
    f.addEventListener('click', () => {
        const idx = parseInt(f.dataset.index);
        if (idx !== selectedIndex) { selectCamera(idx); return; }
        if (appMode === 'nav')        setMode('focus');
        else if (appMode === 'focus') setMode('pan');
    });
});

// ── Navigation ──
function navigate(dir) {
    if (appMode !== 'nav') return;
    if (document.querySelector('.rf-camera-card.fullscreen')) return;
    const row = Math.floor(selectedIndex / COLS), col = selectedIndex % COLS;
    let r = row, c = col;
    if (dir === 'up')    r = (row - 1 + ROWS) % ROWS;
    if (dir === 'down')  r = (row + 1) % ROWS;
    if (dir === 'left')  c = (col - 1 + COLS) % COLS;
    if (dir === 'right') c = (col + 1) % COLS;
    selectCamera(r * COLS + c);
}

// ── Clavier ──
window.addEventListener('keydown', e => {
    const d = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' };
    if (appMode === 'nav' && d[e.key]) { e.preventDefault(); navigate(d[e.key]); }
    if (appMode === 'timeline') {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); scrubVideo(selectedIndex, -5); }
        if (e.key === 'ArrowRight') { e.preventDefault(); scrubVideo(selectedIndex,  5); }
    }
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (appMode === 'nav')        setMode('focus');
        else if (appMode === 'focus') setMode('pan');
        else setMode('nav');
    }
    if (e.key === 'Escape') setMode('nav');
    if (e.key === '+' || e.key === '=') { applyZoom(selectedIndex, -5); scheduleHideZoomGauge(selectedIndex); }
    if (e.key === '-')                   { applyZoom(selectedIndex, +5); scheduleHideZoomGauge(selectedIndex); }
});

// ── Gamepad ──
const joystickStatus = document.getElementById('joystickStatus');
const joystickLabel  = document.getElementById('joystickLabel');
const joystickViz    = document.getElementById('joystickViz');
const joystickDot    = document.getElementById('joystickDot');
const btnDebug       = document.getElementById('btnDebug');
const dbgBtn         = document.getElementById('dbgBtn');
const dbgAll         = document.getElementById('dbgAll');

window.addEventListener('gamepadconnected', e => {
    gamepadIndex = e.gamepad.index;
    joystickStatus.classList.add('connected');
    joystickLabel.textContent = e.gamepad.id.substring(0, 28);
    joystickViz.classList.add('visible');
    btnDebug.classList.add('visible');
    requestAnimationFrame(gamepadLoop);
});
window.addEventListener('gamepaddisconnected', e => {
    if (e.gamepad.index !== gamepadIndex) return;
    gamepadIndex = null;
    joystickStatus.classList.remove('connected');
    joystickLabel.textContent = 'Manette déconnectée';
    joystickViz.classList.remove('visible');
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

    joystickDot.style.transform = `translate(${axisX * 18}px, ${axisY * 18}px)`;

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

    // Actions boutons
    if (rising[btnMap.back]) setMode('nav');
    if (rising[btnMap.pan]) {
        if (appMode === 'nav' || appMode === 'timeline') setMode('focus');
        else if (appMode === 'focus') setMode('pan');
        else if (appMode === 'pan')   setMode('focus');
    }
    if (rising[btnMap.timeline]) setMode(appMode === 'timeline' ? 'nav' : 'timeline');
    if (rising[btnMap.fullscreen]) toggleFullscreen();

    const zoomInHeld  = !!(gp.buttons[btnMap.zoomIn]?.pressed);
    const zoomOutHeld = !!(gp.buttons[btnMap.zoomOut]?.pressed);

    if (zoomInHeld) {
        applyZoom(selectedIndex, -zoomInSpeed);
        zoomInSpeed = Math.min(ZOOM_SPEED_MAX, zoomInSpeed * ZOOM_ACCEL);
    } else { zoomInSpeed = ZOOM_SPEED_BASE; }

    if (zoomOutHeld) {
        applyZoom(selectedIndex, +zoomOutSpeed);
        zoomOutSpeed = Math.min(ZOOM_SPEED_MAX, zoomOutSpeed * ZOOM_ACCEL);
    } else { zoomOutSpeed = ZOOM_SPEED_BASE; }

    if (!zoomInHeld && !zoomOutHeld) scheduleHideZoomGauge(selectedIndex);

    // Directions
    if (appMode === 'focus' || appMode === 'pan') {
        const cam = getCam(selectedIndex);
        if (cam) {
            // Déplacement ralenti selon le zoom
            const zoomFactor = fovPerCam[selectedIndex] / FOV_DEFAULT;
            if (Math.abs(axisX) > SCRUB_DZONE) yawPerCam[selectedIndex]   -= axisX * PAN_SPEED * zoomFactor;
            if (Math.abs(axisY) > SCRUB_DZONE) pitchPerCam[selectedIndex] -= axisY * PAN_SPEED * zoomFactor;
            pitchPerCam[selectedIndex] = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchPerCam[selectedIndex]));
            cam.setAttribute('rotation', `${pitchPerCam[selectedIndex]} ${yawPerCam[selectedIndex]} 0`);
        }
    } else if (appMode === 'timeline') {
        const selFeed = document.querySelector(`.rf-camera-card[data-index="${selectedIndex}"]`);
        if (Math.abs(axisX) > SCRUB_DZONE) {
            const vid = getVideo(selectedIndex);
            console.log(`[TIMELINE] axisX=${axisX.toFixed(3)} | scrubSpeed=${scrubSpeed.toFixed(2)} | delta=${(axisX * scrubSpeed * (1/60)).toFixed(4)}s | readyState=${vid?.readyState} | duration=${vid?.duration} | currentTime=${vid?.currentTime?.toFixed(2)}`);
            scrubVideo(selectedIndex, axisX * scrubSpeed * (1 / 60));
            scrubSpeed = Math.min(SCRUB_SPEED_MAX, scrubSpeed * SCRUB_ACCEL);
            if (selFeed) {
                selFeed.classList.toggle('scrubbing-left',  axisX < 0);
                selFeed.classList.toggle('scrubbing-right', axisX > 0);
            }
        } else {
            scrubSpeed = SCRUB_SPEED;
            if (selFeed) selFeed.classList.remove('scrubbing-left', 'scrubbing-right');
        }
    } else {
        // MODE NAVIGATION
        let navDir = null;

        if (now - lastNavTime > NAV_DELAY) {
            if (axisX >  DEADZONE && lastAxisState.x <=  DEADZONE) navDir = 'right';
            if (axisX < -DEADZONE && lastAxisState.x >= -DEADZONE) navDir = 'left';
            if (axisY >  DEADZONE && lastAxisState.y <=  DEADZONE) navDir = 'down';
            if (axisY < -DEADZONE && lastAxisState.y >= -DEADZONE) navDir = 'up';
        }

        if (!navDir && now - lastNavTime > NAV_DELAY) {
            if (gp.buttons[12]?.pressed) navDir = 'up';
            if (gp.buttons[13]?.pressed) navDir = 'down';
            if (gp.buttons[14]?.pressed) navDir = 'left';
            if (gp.buttons[15]?.pressed) navDir = 'right';
        }

        const dX = gp.axes[6] ?? 0, dY = gp.axes[7] ?? 0;
        if (!navDir && now - lastNavTime > NAV_DELAY) {
            if (dX >  0.5) navDir = 'right';
            if (dX < -0.5) navDir = 'left';
            if (dY >  0.5) navDir = 'down';
            if (dY < -0.5) navDir = 'up';
        }

        if (navDir) { navigate(navDir); lastNavTime = now; }
    }

    lastAxisState = { x: axisX, y: axisY };
    requestAnimationFrame(gamepadLoop);
}

// ── Fullscreen caméra sélectionnée ──
function toggleFullscreen() {
    const card = document.querySelector(`.rf-camera-card[data-index="${selectedIndex}"]`);
    if (!card) return;
    card.classList.toggle('fullscreen');
    // Mettre à jour le nom de la caméra dans le bandeau fullscreen
    const camIdEl = card.querySelector('.rf-fsm-cam-id');
    if (camIdEl) {
        const title = card.querySelector('.rf-card-title-text')?.textContent || `CAM ${String(selectedIndex + 1).padStart(2,'00')}`;
        camIdEl.textContent = title.toUpperCase();
    }
}

// Init
updateFooter();

// ══════════════════════════════════════════════════════
//  BROADCAST — réception des étapes depuis surveillance-ia-interface
// ══════════════════════════════════════════════════════
// Étape 0 : aucune caméra visible (écran d'attente)
// Étape 1 : caméra 0 visible
// Étape 2 : caméras 1, 2, 3 visibles
// Étape 3 : (toutes déjà visibles, signal de fin)

// ── Étapes d'affichage des caméras ──
// Étape 0 : 0 caméra
// Étape 1 : 1 caméra  (cam 0)
// Étape 2 : 4 caméras (cam 0-3)
// Étape 3 : 8 caméras (cam 0-7)

function applyEtape(etape) {
    const allCards = document.querySelectorAll('.rf-camera-card');
    const standby  = document.getElementById('standbyScreen');
    const grid     = document.getElementById('cameraGrid');
    const visible  = etape === 0 ? 0 : etape === 1 ? 1 : etape === 2 ? 4 : 6;

    if (etape === 0) {
        standby.classList.add('visible');
        grid.style.display = 'none';
        allCards.forEach(card => {
            card.style.visibility = 'hidden';
            card.style.opacity = '0';
            const vid = card.querySelector('video');
            if (vid) { vid.pause(); vid.currentTime = 0; }
        });
        return;
    } else {
        standby.classList.remove('visible');
        grid.style.display = '';
    }

    allCards.forEach((card, i) => {
        const show = i < visible;
        card.style.visibility = show ? 'visible' : 'hidden';
        card.style.opacity    = show ? '1' : '0';
    });

    // Après que les caméras deviennent visibles, force A-Frame à recalculer
    requestAnimationFrame(() => {
        allCards.forEach((card, i) => {
            if (i >= visible) return;
            const scene = card.querySelector('a-scene');
            if (scene && scene.renderer) {
                const w = scene.parentElement.offsetWidth;
                const h = scene.parentElement.offsetHeight;
                scene.renderer.setSize(w, h);
                if (scene.camera) {
                    scene.camera.aspect = w / h;
                    scene.camera.updateProjectionMatrix();
                }
            }
        });
    });
}

// État initial : aucune caméra
applyEtape(0);

const bc = new BroadcastChannel('surveillance_etapes');
bc.onmessage = (e) => {
    if (e.data === 'reset') {
        applyEtape(0);
        const screen = document.getElementById('usb-video-screen');
        const vid = document.getElementById('usb-video');
        if (screen) screen.classList.remove('visible');
        if (vid) { vid.pause(); vid.currentTime = 0; }
        document.getElementById('usb-toggle-btn').textContent = '▶ Lancer';
        return;
    }
    const etape = parseInt(e.data);
    if (!isNaN(etape)) applyEtape(etape);
};

// ── Détection USB via WebSocket ──
function connectUSBWatcher() {
    const ws = new WebSocket('ws://localhost:8765');

    ws.onopen = () => console.log('[USB] Connecté au watcher');

    ws.onmessage = (e) => {
        if (e.data === 'USB_CONNECTED') {
            console.log('[USB] Clé détectée — affichage de la vidéo');
            const screen = document.getElementById('usb-video-screen');
            const vid    = document.getElementById('usb-video');
            if (screen && vid) {
                screen.classList.add('visible');
            }
        }
    };

    ws.onclose = () => {
        // Retente la connexion toutes les 3s si le script Python n'est pas encore lancé
        setTimeout(connectUSBWatcher, 3000);
    };

    ws.onerror = () => ws.close();
}

connectUSBWatcher();


function usbTogglePlay() {
    const vid = document.getElementById('usb-video');
    const btn = document.getElementById('usb-toggle-btn');
    if (vid.paused) {
        vid.play();
        btn.textContent = '⏸ Pause';
    } else {
        vid.pause();
        btn.textContent = '▶ Reprendre';
    }
}
