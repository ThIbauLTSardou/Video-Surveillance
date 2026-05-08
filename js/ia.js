    // Horloge
    function updateClock() {
        const t = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        document.getElementById('globalClock').textContent = t;
    }
    updateClock();
    setInterval(updateClock, 1000);

    // ── Données caméras et tracé ──
    const ETAPES = [
        // Étape 1 — 1er envoi formulaire
        {
            cameras: [
                { label: 'Cam 1 — 4 Hent Kerouandener', coords: [48.7455003, -3.4788234] },
            ],
            segments: []
        },
        // Étape 2 — 2ème envoi formulaire
        {
            cameras: [
                { label: 'Cam 2 — Route de Trébeurden',  coords: [48.743159,  -3.473209]  },
                { label: 'Cam 3 — 3 Pl. des Ursulines',  coords: [48.7307422, -3.4544340] },
                { label: 'Cam 4 — 3 Pl. des Ursulines',  coords: [48.7307422, -3.4544340] },
            ],
            segments: [
                // Cam 1 → Cam 2 : trait bleu
                { waypoints: [[48.7455003, -3.4788234], [48.743159, -3.473209]], color: '#003189' },
                // Cam 2 → Cam 3&4 : trait bleu
                { waypoints: [[48.743159, -3.473209], [48.7307422, -3.4544340]], color: '#003189' }
            ]
        },
        // Étape 3 — 3ème envoi formulaire
        {
            cameras: [
                { label: 'Cam 5 — 17 Quai du Mal. Foch', coords: [48.7319629, -3.4666370] },
                { label: 'Cam 6 — Parking quai à sable',  coords: [48.736590,  -3.483497]  },
            ],
            segments: [
                // Pl. des Ursulines → Cam 5 : trait rouge
                { waypoints: [[48.7307422, -3.4544340], [48.7319629, -3.4666370]], color: '#e1000f' },
                // Cam 5 → Cam 6 : trait rouge
                { waypoints: [[48.7319629, -3.4666370], [48.736590, -3.483497]], color: '#e1000f' }
            ]
        }
    ];

    // Récupère un itinéraire routier via OSRM et trace la polyline
    async function traceRoute(waypoints, color) {
        // OSRM attend les coordonnées en lon,lat
        const coords = waypoints.map(([lat, lon]) => `${lon},${lat}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
        try {
            const res  = await fetch(url);
            const data = await res.json();
            const latlngs = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
            const line = L.polyline(latlngs, { color, weight: 4, opacity: 0.85 }).addTo(leafletMap);
            linesOnMap.push(line);
        } catch {
            // Fallback ligne droite si OSRM échoue
            const line = L.polyline(waypoints, { color, weight: 4, opacity: 0.85, dashArray: '6,6' }).addTo(leafletMap);
            linesOnMap.push(line);
        }
    }

    // Carte Leaflet — initialisée une seule fois
    let leafletMap = null;
    const markersOnMap = [];
    const linesOnMap   = [];

    function initMap() {
        if (leafletMap) return;
        leafletMap = L.map('leaflet-map').setView([48.7380, -3.4680], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19
        }).addTo(leafletMap);

        // Affiche les étapes déjà atteintes si on revient sur la carte après des soumissions
        for (let i = 0; i < etapeCourante; i++) renderEtape(i);
    }

    function renderEtape(index) {
        if (!leafletMap || index >= ETAPES.length) return;
        const etape = ETAPES[index];

        etape.cameras.forEach(cam => {
            const marker = L.circleMarker(cam.coords, {
                radius: 8, color: '#003189', fillColor: '#fff',
                fillOpacity: 1, weight: 2
            }).addTo(leafletMap).bindTooltip(cam.label, { permanent: false, direction: 'top' });
            markersOnMap.push(marker);
        });

        etape.segments.forEach(seg => traceRoute(seg.waypoints, seg.color));
    }

    // Onglets principaux
    function switchMainTab(tab, btn) {
        document.querySelectorAll('.rf-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.rf-main-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`main-panel-${tab}`).classList.add('active');
        btn.classList.add('active');
        if (tab === 'carte') {
            initMap();
            leafletMap.invalidateSize();
        }
    }

    // Onglets secondaires
    function switchSubTab(tab, btn) {
        document.querySelectorAll('.rf-subtab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.rf-subpanel').forEach(p => p.classList.remove('active'));
        document.getElementById(`panel-${tab}`).classList.add('active');
        btn.classList.add('active');
    }

    // Date du jour par défaut
    document.getElementById('date').valueAsDate = new Date();

    // Ouvre etat.html une seule fois et remet les étapes à zéro
    if (!sessionStorage.getItem('etat_opened')) {
        sessionStorage.setItem('etat_opened', '1');
        sessionStorage.setItem('etape_courante', '0');
        window.open('./etat.html', 'etat_tv');
    }

    // Canal de communication avec etat.html
    const bc = new BroadcastChannel('surveillance_etapes');

    // Récupère l'étape courante depuis sessionStorage pour ne pas remettre à zéro
    let etapeCourante = parseInt(sessionStorage.getItem('etape_courante') || '0');

    const etapeLabels = ['Valider la première étape', 'Valider la deuxième étape', 'Valider la troisième étape'];

    function updateSubmitBtn() {
        const label = etapeLabels[etapeCourante] || etapeLabels[etapeLabels.length - 1];
        document.querySelectorAll('#submitBtn').forEach(btn => btn.textContent = label);
    }

    updateSubmitBtn();

    function lancerRecherche(e) {
        e.preventDefault();
        if (etapeCourante < 3) {
            renderEtape(etapeCourante);
            etapeCourante++;
            sessionStorage.setItem('etape_courante', etapeCourante);
            bc.postMessage(etapeCourante);
            if (etapeCourante === 3) {
                document.getElementById('finEnquete').classList.add('visible');
            } else {
                updateSubmitBtn();
            }
        }
    }

    document.getElementById('searchForm').addEventListener('submit', lancerRecherche);
    document.getElementById('searchFormVehicule').addEventListener('submit', lancerRecherche);

    function resetPartie() {
        etapeCourante = 0;
        sessionStorage.setItem('etape_courante', '0');
        updateSubmitBtn();
        document.getElementById('finEnquete').classList.remove('visible');
        // Efface marqueurs et tracés de la carte
        markersOnMap.forEach(m => m.remove());
        markersOnMap.length = 0;
        linesOnMap.forEach(l => l.remove());
        linesOnMap.length = 0;
        // Notifie etat.html
        bc.postMessage('reset');
        // Fallback : recharge etat.html directement si la fenêtre est accessible
        const etatWin = window.open('', 'etat_tv');
        if (etatWin && !etatWin.closed) {
            etatWin.location.reload();
        }
    }
