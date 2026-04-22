/**
 * RL Store Locator - Main Logic
 * Version: 2.1.0
 * Updated: 2026-04-22
 */

window.initStoreLocator = function(config) {
    const { mapboxToken, mapStyle, defaultCoords, iconUrl } = config;

    mapboxgl.accessToken = mapboxToken;

    // Initialize the Map
    const map = new mapboxgl.Map({
        container: 'map',
        style: mapStyle,
        center: defaultCoords,
        zoom: 7
    });

    // Make map available globally if needed for debugging
    window.map = map;

    // Global State
    let stores = [];
    let activeSubset = [];
    let activeStoreId = null;
    let userLocation = null;
    let currentSortMethod = 'nearest';
    let currentSearchTerm = '';
    let isMapVisible = false;

    // DOM Elements
    const locationListEl = document.getElementById('location-list');
    const locationDetailEl = document.getElementById('location-detail');
    const detailContentEl = document.getElementById('detail-content');
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search');
    const resultCountEl = document.getElementById('result-count');
    const backButton = document.getElementById('back-to-list');
    const sidebar = document.getElementById('sidebar');
    const mobileToggleBtn = document.getElementById('mobile-toggle');
    const sortSelect = document.getElementById('sort-select');
    const filtersEl = document.querySelector('.filters');
    const acDropdown = document.getElementById('ac-dropdown');

    // --- Helper Functions ---

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const p = 0.017453292519943295; // Math.PI / 180
        const c = Math.cos;
        const a = 0.5 - c((lat2 - lat1) * p) / 2 +
            c(lat1 * p) * c(lat2 * p) *
            (1 - c((lon2 - lon1) * p)) / 2;
        return 12742 * Math.asin(Math.sqrt(a)) * 0.621371; // miles
    }

    function parseHoursString(hoursStr) {
        if (!hoursStr) return [];
        const dayMap = { 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 0 };
        const chunks = hoursStr.split('|').map(s => s.trim()).filter(Boolean);
        const schedule = [];

        for (const chunk of chunks) {
            const match = chunk.match(/^([A-Za-z,& -]+):\s*(.+)$/);
            if (!match) continue;

            const dayPart = match[1].trim().toLowerCase();
            const timePart = match[2].trim();
            let days = [];

            if (dayPart.includes('-')) {
                const [start, end] = dayPart.split('-').map(d => d.trim().substring(0, 3));
                const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
                let sIdx = weekdays.indexOf(start);
                let eIdx = weekdays.indexOf(end);
                if (sIdx >= 0 && eIdx >= 0) {
                    for (let i = sIdx; i <= eIdx; i++) days.push(dayMap[weekdays[i]]);
                }
            } else {
                dayPart.split(/[,&]+/).forEach(d => {
                    const day = d.trim().substring(0, 3);
                    if (dayMap[day] !== undefined) days.push(dayMap[day]);
                });
            }

            const timeMatch = timePart.match(/(\d{1,2}:\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
            if (timeMatch) {
                const parseTime = (t, ampm) => {
                    let [h, m] = t.split(':').map(Number);
                    if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12;
                    if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
                    return h * 60 + m;
                };
                const open = parseTime(timeMatch[1], timeMatch[2]);
                const close = parseTime(timeMatch[3], timeMatch[4]);
                days.forEach(d => schedule.push({ day: d, open, close, label: timePart }));
            }
        }
        return schedule;
    }

    function getStoreStatus(feature) {
        const hours = feature.properties.opening_hours || "";
        if (/opening|coming soon/i.test(hours)) return 'coming-soon';
        
        const schedule = parseHoursString(hours);
        if (schedule.length === 0) return 'unknown';

        const now = new Date();
        const day = now.getDay();
        const time = now.getHours() * 60 + now.getMinutes();

        for (const item of schedule) {
            if (item.day === day && time >= item.open && time < item.close) return 'open';
        }
        return 'closed';
    }

    function getStatusBadgeHtml(feature) {
        const status = getStoreStatus(feature);
        if (status === 'coming-soon') return '<span class="status-badge status-coming-soon"><span class="status-dot"></span>Coming Soon</span>';
        if (status === 'open') return '<span class="status-badge status-open"><span class="status-dot"></span>Open Now</span>';
        if (status === 'closed') return '<span class="status-badge status-closed"><span class="status-dot"></span>Closed</span>';
        return '';
    }

    function formatHoursDetail(hoursStr) {
        if (!hoursStr) return "";
        if (/opening|coming soon/i.test(hoursStr)) return `<p style="color:var(--primary-color);font-weight:500;">${hoursStr}</p>`;

        const chunks = hoursStr.split('|').map(s => s.trim()).filter(Boolean);
        const today = new Date().getDay();
        const dayMap = { 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 0 };
        
        let html = '<div class="hours-grid">';
        for (const chunk of chunks) {
            const match = chunk.match(/^([A-Za-z,& -]+):\s*(.+)$/);
            if (!match) continue;
            const dayPart = match[1].trim();
            const timePart = match[2].trim();
            
            let isToday = false;
            const lowerDay = dayPart.toLowerCase();
            if (lowerDay.includes('-')) {
                const [start, end] = lowerDay.split('-').map(d => d.trim().substring(0, 3));
                const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
                let sIdx = weekdays.indexOf(start);
                let eIdx = weekdays.indexOf(end);
                for (let i = sIdx; i <= eIdx; i++) if (dayMap[weekdays[i]] === today) isToday = true;
            } else {
                lowerDay.split(/[,&]+/).forEach(d => {
                    if (dayMap[d.trim().substring(0, 3)] === today) isToday = true;
                });
            }

            const todayClass = isToday ? ' hours-today' : '';
            html += `<div class="hours-day${todayClass}">${dayPart}</div>`;
            html += `<div class="hours-time${todayClass}">${timePart}${isToday ? ' ★' : ''}</div>`;
        }
        return html + '</div>';
    }

    function isStoreMatch(feature, term) {
        if (!term) return false;
        const p = feature.properties;
        const t = term.toLowerCase();
        return p.name.toLowerCase().includes(t) || 
               p.city.toLowerCase().includes(t) || 
               p.address.toLowerCase().includes(t) ||
               (p.postalCode && p.postalCode.includes(t)) ||
               (p.state && p.state.toLowerCase().includes(t));
    }

    // --- Map Layers & Sync ---

    function syncMapLayerFilters(activeName) {
        if (map.getLayer('location-active-pin')) {
            map.setFilter('location-active-pin', ['==', ['get', 'name'], activeName || '']);
        }
        if (map.getLayer('unclustered-point-symbols')) {
            map.setFilter('unclustered-point-symbols', [
                'all',
                ['!', ['has', 'point_count']],
                ['!=', ['get', 'name'], activeName || '']
            ]);
        }
    }

    function syncSidebarActiveState(activeName) {
        document.querySelectorAll('.location-card').forEach(card => {
            if (card.dataset.id === activeName) {
                card.classList.add('active');
                if (!card.matches(':hover')) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                card.classList.remove('active');
            }
        });
    }

    // --- Rendering ---

    function renderListItem(feature) {
        const p = feature.properties;
        let distHtml = "";
        if (feature.distance !== undefined && feature.distance !== null) {
            distHtml = `<div class="store-distance">${feature.distance.toFixed(1)} mi</div>`;
        }

        const card = document.createElement('div');
        card.className = `location-card ${activeStoreId === p.name ? 'active' : ''}`;
        card.dataset.id = p.name;
        
        let actionButtons = `<button class="btn-view-details">View Details</button>`;
        if (/opening|coming soon/i.test(p.opening_hours || "")) {
            actionButtons += `<span class="btn-view-page" style="opacity:0.6;cursor:default;">Coming Soon</span>`;
        } else if (p.bookingUrl) {
            actionButtons += `<a href="${p.bookingUrl}" target="_blank" class="btn-booking" onclick="event.stopPropagation();">Book Online</a>`;
        } else {
            const phoneClean = p.phone.replace(/[^+\d]/g, '');
            actionButtons += `<a href="tel:${phoneClean}" class="btn-call-to-book" onclick="event.stopPropagation();">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                Call to Book</a>`;
        }

        card.innerHTML = `
            <div class="card-info" style="width: 100%;">
                <div class="card-header-row">
                    <h3>${p.name}</h3>
                    ${distHtml}
                </div>
                <div style="margin-top:4px;">${getStatusBadgeHtml(feature)}</div>
                <p style="margin-top:5px;">${p.address}</p>
                <p>${p.city}, ${p.state} ${p.postalCode}</p>
            </div>
            <div class="card-action">${actionButtons}</div>
        `;

        card.addEventListener('click', () => selectStore(feature));
        card.querySelector('.btn-view-details').addEventListener('click', (e) => {
            e.stopPropagation();
            selectStore(feature);
        });
        card.addEventListener('mouseenter', () => syncMapLayerFilters(p.name));
        card.addEventListener('mouseleave', () => syncMapLayerFilters(activeStoreId));

        return card;
    }

    function renderDetailView(feature) {
        const p = feature.properties;
        const mapLink = p.mapLink || `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.address + ' ' + p.city)}`;
        const hoursHtml = formatHoursDetail(p.opening_hours);
        const phoneClean = p.phone.replace(/[^+\d]/g, '');

        const neighbors = getNeighbors(feature.geometry.coordinates, p.name, p.postalCode);
        const neighborsHtml = neighbors.length > 0 ? `
            <div style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px;">
                <h4 style="margin-bottom: 10px; font-family:var(--font-heading);">NEARBY LOCATIONS</h4>
                <div class="nearby-list">
                    ${neighbors.map(n => `
                        <div class="nearby-item" data-nearby-name="${n.properties.name.replace(/"/g, '&quot;')}">
                            <div class="nearby-name">${n.properties.name}</div>
                            <div class="nearby-dist">${n.tempDist.toFixed(1)} mi</div>
                        </div>
                    `).join('')}
                </div>
            </div>` : "";

        const heroImg = p.heroPhoto ? `<img class="detail-image" src="${p.heroPhoto}" alt="${p.name}" onerror="this.style.display='none'"/>` : "";
        const bookingBtn = p.bookingUrl ? `<a href="${p.bookingUrl}" target="_blank" class="btn-booking" style="margin-bottom: 10px; width: 100%;">Book Online</a>` : "";

        detailContentEl.innerHTML = `
            ${heroImg}
            <h2 class="detail-title">${p.name}</h2>
            <div style="margin-bottom:12px;">${getStatusBadgeHtml(feature)}</div>
            <div class="detail-address">${p.address}<br>${p.city}, ${p.state} ${p.postalCode}</div>
            <a href="tel:${phoneClean}" class="detail-phone">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                ${p.phone}
            </a>
            <div class="action-buttons" style="display:flex; flex-direction:column; gap:10px;">
                ${bookingBtn}
                <a href="${mapLink}" target="_blank" class="btn-primary">Get Directions</a>
                ${p.page ? `<a href="${p.page}" target="_blank" class="btn-outline">Visit Page</a>` : ""}
            </div>
            ${hoursHtml ? `<div style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px;"><h4 style="margin-bottom: 10px;">HOURS</h4>${hoursHtml}</div>` : ""}
            ${neighborsHtml}
        `;

        locationListEl.classList.add('hidden');
        filtersEl.classList.add('hidden');
        locationDetailEl.classList.remove('hidden');
    }

    function getNeighbors(coords, currentName, currentZip) {
        let matches = [];
        // 1. Try ZIP matches
        if (currentZip && window.zipToStores && zipToStores[currentZip]) {
            const ids = zipToStores[currentZip];
            for (let i = 0; i < ids.length; i += 2) {
                const store = stores[ids[i]];
                if (store && store.properties.name !== currentName) {
                    matches.push({ ...store, tempDist: ids[i + 1] });
                }
            }
        }
        // 2. Fallback to nearest geometric
        if (matches.length < 3) {
            const existingNames = matches.map(m => m.properties.name);
            existingNames.push(currentName);
            const nearest = stores
                .filter(s => !existingNames.includes(s.properties.name))
                .map(s => {
                    const dist = calculateDistance(coords[1], coords[0], s.geometry.coordinates[1], s.geometry.coordinates[0]);
                    return { ...s, tempDist: dist };
                })
                .sort((a, b) => a.tempDist - b.tempDist);
            matches = matches.concat(nearest.slice(0, 3 - matches.length));
        }
        return matches.slice(0, 3);
    }

    // --- Search & Logic ---

    function updateView() {
        if (!currentSearchTerm) {
            resetToAllLocations();
            return;
        }

        const term = currentSearchTerm.toUpperCase();
        let matches = [];

        // Try Direct Zip/City Map
        let mappedIds = null;
        if (/^\d{5}$/.test(currentSearchTerm)) {
            mappedIds = window.zipToStores ? zipToStores[currentSearchTerm] : null;
        } else {
            mappedIds = window.cityToStores ? cityToStores[term] : null;
        }

        if (!mappedIds && currentSearchTerm.length >= 3) {
            let aggregated = [];
            if (/^\d+$/.test(currentSearchTerm)) {
                Object.keys(zipToStores || {}).filter(z => z.startsWith(currentSearchTerm)).forEach(z => aggregated = aggregated.concat(zipToStores[z]));
            } else {
                Object.keys(cityToStores || {}).filter(c => c.startsWith(term)).forEach(c => aggregated = aggregated.concat(cityToStores[c]));
            }
            if (aggregated.length > 0) mappedIds = aggregated;
        }

        if (mappedIds) {
            const seen = new Set();
            for (let i = 0; i < mappedIds.length; i += 2) {
                const idx = mappedIds[i];
                if (stores[idx] && !seen.has(idx)) {
                    seen.add(idx);
                    matches.push({ ...stores[idx], distance: mappedIds[i + 1] });
                }
            }
            stores.forEach((s, idx) => {
                if (!seen.has(idx) && isStoreMatch(s, currentSearchTerm)) {
                    seen.add(idx);
                    matches.push({ ...s });
                }
            });
        } else {
            matches = stores.filter(s => isStoreMatch(s, currentSearchTerm));
        }

        activeSubset = matches;
        renderList(activeSubset);

        const source = map.getSource('stores');
        if (source) source.setData({ type: 'FeatureCollection', features: activeSubset });

        if (activeSubset.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            activeSubset.forEach(f => bounds.extend(f.geometry.coordinates));
            map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
        }
    }

    function selectStore(feature) {
        activeStoreId = feature.properties.name;
        if (currentSearchTerm) {
            if (!activeSubset.find(s => s.properties.name === activeStoreId)) {
                const copy = { ...feature };
                copy.distance = copy.distance || 0;
                activeSubset.unshift(copy);
                renderList(activeSubset);
            }
        }
        syncSidebarActiveState(activeStoreId);
        renderDetailView(feature);
        syncMapLayerFilters(activeStoreId);
        map.flyTo({ center: feature.geometry.coordinates, zoom: 15, essential: true });
    }

    function renderList(features) {
        locationListEl.innerHTML = '';
        const sorted = [...features].sort((a, b) => {
            if (currentSortMethod === 'nearest') return (a.distance ?? 9999) - (b.distance ?? 9999);
            return a.properties.name.localeCompare(b.properties.name);
        });
        if (sorted.length === 0) {
            locationListEl.innerHTML = `<div class="empty-state"><p>No locations found</p></div>`;
            resultCountEl.innerText = "Showing 0 locations";
            return;
        }
        sorted.forEach(f => locationListEl.appendChild(renderListItem(f)));
        resultCountEl.innerText = `Showing ${sorted.length} locations`;
    }

    function resetToAllLocations() {
        activeStoreId = null;
        currentSearchTerm = "";
        activeSubset = stores;
        syncMapLayerFilters(null);
        document.querySelectorAll('.location-card.active').forEach(c => c.classList.remove('active'));
        const source = map.getSource('stores');
        if (source) source.setData({ type: 'FeatureCollection', features: stores });
        renderList(stores);
    }

    function initGeolocation() {
        if (!("geolocation" in navigator)) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                stores = stores.map(s => {
                    s.distance = calculateDistance(userLocation.lat, userLocation.lng, s.geometry.coordinates[1], s.geometry.coordinates[0]);
                    return s;
                });
                currentSortMethod = 'nearest';
                sortSelect.value = 'nearest';
                renderList(activeSubset.length > 0 ? activeSubset : stores);
            },
            (err) => {
                currentSortMethod = 'name';
                sortSelect.value = 'name';
                renderList(activeSubset.length > 0 ? activeSubset : stores);
            }
        );
    }

    // --- Event Listeners ---

    sortSelect.addEventListener('change', (e) => {
        currentSortMethod = e.target.value;
        renderList(activeSubset);
    });

    searchInput.addEventListener('input', (e) => {
        currentSearchTerm = e.target.value.trim();
        clearSearchBtn.style.display = currentSearchTerm ? 'block' : 'none';
        debouncedUpdateView();
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        currentSearchTerm = '';
        clearSearchBtn.style.display = 'none';
        updateView();
    });

    backButton.addEventListener('click', () => {
        locationDetailEl.classList.add('hidden');
        filtersEl.classList.remove('hidden');
        locationListEl.classList.remove('hidden');
        activeStoreId = null;
        syncMapLayerFilters(null);
        renderList(activeSubset);
    });

    mobileToggleBtn.addEventListener('click', () => {
        isMapVisible = !isMapVisible;
        sidebar.classList.toggle('hidden-mobile', isMapVisible);
        mobileToggleBtn.innerText = isMapVisible ? 'List' : 'Map';
    });

    const debouncedUpdateView = debounce(updateView, 300);
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Map Events
    map.on('load', () => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = iconUrl;
        img.onload = () => map.addImage('dentist-icon', img);

        stores = window.storeData || [];
        activeSubset = stores;
        
        map.addSource('stores', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: stores },
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 50
        });

        map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'stores',
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': '#6E99EB',
                'circle-radius': ['step', ['get', 'point_count'], 20, 100, 30, 750, 40],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff'
            }
        });

        map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'stores',
            filter: ['has', 'point_count'],
            layout: {
                'text-field': '{point_count_abbreviated}',
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                'text-size': 14
            },
            paint: { 'text-color': '#ffffff' }
        });

        map.addLayer({
            id: 'unclustered-point-symbols',
            type: 'symbol',
            source: 'stores',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': 'dentist-icon',
                'icon-size': 0.8,
                'icon-anchor': 'bottom',
                'text-field': ['get', 'name'],
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                'text-size': 12,
                'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                'text-radial-offset': 0.5,
                'text-optional': true
            },
            paint: {
                'text-color': '#000000',
                'text-halo-color': '#ffffff',
                'text-halo-width': 2
            }
        });

        map.addLayer({
            id: 'location-active-pin',
            type: 'symbol',
            source: 'stores',
            filter: ['==', ['get', 'name'], ''],
            layout: {
                'icon-image': 'dentist-icon',
                'icon-size': 1.1,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });

        map.on('click', 'unclustered-point-symbols', (e) => {
            const name = e.features[0].properties.name;
            const store = stores.find(s => s.properties.name === name);
            if (store) selectStore(store);
        });

        map.on('click', 'clusters', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
            const clusterId = features[0].properties.cluster_id;
            map.getSource('stores').getClusterExpansionZoom(clusterId, (err, zoom) => {
                if (err) return;
                map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
            });
        });

        ['clusters', 'unclustered-point-symbols'].forEach(l => {
            map.on('mouseenter', l, () => map.getCanvas().style.cursor = 'pointer');
            map.on('mouseleave', l, () => map.getCanvas().style.cursor = '');
        });

        initGeolocation();
        renderList(stores);
    });

    // Autocomplete Logic
    if (acDropdown) {
        const acCities = Object.keys(window.cityToStores || {}).map(c => ({ label: c, type: 'city' }));
        const acZips = Object.keys(window.zipToStores || {}).map(z => ({ label: z, type: 'zip' }));
        
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.trim().toUpperCase();
            if (val.length < 2) {
                acDropdown.classList.remove('visible');
                return;
            }
            const cityMatches = acCities.filter(c => c.label.startsWith(val)).slice(0, 3);
            const zipMatches = acZips.filter(z => z.label.startsWith(val)).slice(0, 3);
            let html = '';
            if (cityMatches.length) html += '<div class="ac-group-label">Cities</div>' + cityMatches.map(m => `<div class="ac-item" data-val="${m.label}">${m.label}</div>`).join('');
            if (zipMatches.length) html += '<div class="ac-group-label">Zip Codes</div>' + zipMatches.map(m => `<div class="ac-item" data-val="${m.label}">${m.label}</div>`).join('');
            if (html) {
                acDropdown.innerHTML = html;
                acDropdown.classList.add('visible');
                acDropdown.querySelectorAll('.ac-item').forEach(item => {
                    item.addEventListener('click', () => {
                        searchInput.value = item.dataset.val;
                        currentSearchTerm = item.dataset.val;
                        acDropdown.classList.remove('visible');
                        updateView();
                    });
                });
            } else {
                acDropdown.classList.remove('visible');
            }
        });
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !acDropdown.contains(e.target)) acDropdown.classList.remove('visible');
        });
    }
};