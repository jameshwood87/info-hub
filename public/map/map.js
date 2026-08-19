/* PropertyList network map - 3D globe + extruded city columns.
   Data: window.__PLMAP__ (municipality rows) and /map/cities.json (every listing's city).
   Intro: globe -> Iberia -> Costa del Sol. Any interaction cancels it. */
(function () {
	var rows = window.__PLMAP__ || [];
	var byName = {};
	rows.forEach(function (r) { byName[r.name] = r; });
	var ALIAS = { 'Benahavís': 'Benahavis', 'Benalmádena': 'Benalmadena' };

	var el = document.getElementById('map');
	var panel = document.getElementById('panel');
	if (!el || typeof maplibregl === 'undefined') return;

	var COAST = [[-5.3581, 36.3103], [-4.5076, 36.6424]];
	var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	var map = new maplibregl.Map({
		container: 'map',
		style: 'https://tiles.openfreemap.org/styles/liberty',
		center: [-3.7, 40.2],
		zoom: reduce ? 5.2 : 1.6,
		pitch: 0,
		bearing: 0,
		antialias: true,
		attributionControl: false,
		cooperativeGestures: true
	});
	try { map.setProjection({ type: 'globe' }); } catch (e) {}
	map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
	map.addControl(new maplibregl.AttributionControl({
		compact: true,
		customAttribution: 'Boundaries © OpenStreetMap contributors · Terrain © AWS Terrain Tiles · Market data PropertyList · Verified prices Consejo General del Notariado'
	}));

	// ---- intro flight, cancellable ----
	var introRunning = false, introDone = false;
	function cancelIntro() {
		if (!introRunning) return;
		introRunning = false; introDone = true;
		map.stop();
		var b = document.getElementById('skipintro'); if (b) b.style.display = 'none';
	}
	['mousedown', 'wheel', 'touchstart', 'keydown'].forEach(function (ev) {
		el.addEventListener(ev, cancelIntro, { passive: true });
	});
	var skip = document.getElementById('skipintro');
	if (skip) skip.addEventListener('click', function () { cancelIntro(); map.fitBounds(COAST, { padding: 30, duration: 900, pitch: 50 }); });

	function runIntro() {
		if (reduce) { map.fitBounds(COAST, { padding: 30, duration: 0, pitch: 45 }); introDone = true; return; }
		introRunning = true;
		if (skip) skip.style.display = 'inline-flex';
		map.flyTo({ center: [-3.7, 40.2], zoom: 4.6, pitch: 0, duration: 2600, essential: true });
		setTimeout(function () {
			if (!introRunning) return;
			map.flyTo({ center: [-4.9, 36.52], zoom: 8.2, pitch: 42, bearing: -14, duration: 3200, essential: true });
		}, 2750);
		setTimeout(function () {
			if (!introRunning) return;
			map.fitBounds(COAST, { padding: 30, pitch: 46, bearing: -18, duration: 2200 });
			introRunning = false; introDone = true;
			if (skip) skip.style.display = 'none';
		}, 6100);
	}

	// ---- layers ----
	var LAYERS = {
		sale:     { key: 'sale',     label: 'Height and colour show how many homes are listed.' },
		psm:      { key: 'psm',      label: 'Height and colour show the asking price per m².' },
		verified: { key: 'verified', label: 'Height and colour show the notary-verified price per m².' },
		gap:      { key: 'sale',     label: 'Red means we are thin on the ground - room for another agency.' }
	};
	var current = 'sale';

	function stats(key) {
		var v = rows.map(function (r) { return r[key]; }).filter(function (x) { return typeof x === 'number' && x > 0; });
		v.sort(function (a, b) { return a - b; });
		return v.length ? { lo: v[0], hi: v[v.length - 1] } : { lo: 0, hi: 1 };
	}
	function ramp(key, invert) {
		var s = stats(key);
		var cols = invert
			? ['#c0392b', '#e4573d', '#f0a58f', '#bcd9d4', '#00ae9a']
			: ['#d8ecea', '#9fd8d0', '#5bc4b6', '#12a894', '#00786b'];
		var e = ['interpolate', ['linear'], ['coalesce', ['feature-state', key], s.lo]];
		for (var i = 0; i < cols.length; i++) e.push(s.lo + ((s.hi - s.lo) * i) / (cols.length - 1), cols[i]);
		return e;
	}
	function heightExpr(key) {
		var s = stats(key);
		return ['interpolate', ['linear'], ['coalesce', ['feature-state', key], s.lo], s.lo, 250, s.hi, 6500];
	}

	map.on('load', function () {
		// terrain + sky for the Google-Earth feel
		try {
			map.addSource('dem', {
				type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
				tileSize: 256, maxzoom: 13, encoding: 'terrarium'
			});
			map.setTerrain({ source: 'dem', exaggeration: 1.25 });
			map.setSky({ 'sky-color': '#8ec5e8', 'horizon-color': '#e8f2f6', 'fog-color': '#dfeaec', 'fog-ground-blend': 0.5, 'sky-horizon-blend': 0.6 });
		} catch (e) {}

		// municipality polygons, extruded
		fetch('/map/municipalities.geojson').then(function (r) { return r.json(); }).then(function (gj) {
			gj.features.forEach(function (f, i) { f.properties.mls = ALIAS[f.properties.name] || f.properties.name; f.id = i; });
			map.addSource('munis', { type: 'geojson', data: gj });
			map.addLayer({
				id: 'muni-3d', type: 'fill-extrusion', source: 'munis',
				paint: {
					'fill-extrusion-color': ramp('sale', false),
					'fill-extrusion-height': heightExpr('sale'),
					'fill-extrusion-base': 0,
					'fill-extrusion-opacity': 0.82,
					'fill-extrusion-vertical-gradient': true
				}
			});
			map.addLayer({
				id: 'muni-line', type: 'line', source: 'munis',
				paint: { 'line-color': '#06302c', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.6, 0.9], 'line-opacity': 0.6 }
			});
			map.addLayer({
				id: 'muni-label', type: 'symbol', source: 'munis', minzoom: 7.4,
				layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-font': ['Noto Sans Bold'] },
				paint: { 'text-color': '#08211f', 'text-halo-color': '#ffffff', 'text-halo-width': 1.7 }
			});
			gj.features.forEach(function (f) {
				var r = byName[f.properties.mls]; if (!r) return;
				map.setFeatureState({ source: 'munis', id: f.id }, { sale: r.sale, psm: r.psm || 0, verified: r.verified || 0 });
			});
			var hov = null;
			map.on('mousemove', 'muni-3d', function (e) {
				map.getCanvas().style.cursor = 'pointer';
				if (hov !== null) map.setFeatureState({ source: 'munis', id: hov }, { hover: false });
				hov = e.features[0].id; map.setFeatureState({ source: 'munis', id: hov }, { hover: true });
			});
			map.on('mouseleave', 'muni-3d', function () {
				map.getCanvas().style.cursor = '';
				if (hov !== null) map.setFeatureState({ source: 'munis', id: hov }, { hover: false });
				hov = null;
			});
			map.on('click', 'muni-3d', function (e) { showMuni(e.features[0].properties.mls); });
			runIntro();
		}).catch(function () { runIntro(); });

		// every other listing location, as circles that scale with count
		fetch('/map/cities.json').then(function (r) { return r.json(); }).then(function (cj) {
			map.addSource('cities', { type: 'geojson', data: cj });
			map.addLayer({
				id: 'city-dots', type: 'circle', source: 'cities',
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'],
						3, ['interpolate', ['linear'], ['get', 'n'], 1, 2.2, 100, 7, 1200, 13],
						9, ['interpolate', ['linear'], ['get', 'n'], 1, 4, 100, 13, 1200, 30]],
					'circle-color': ['case', ['>=', ['get', 'n'], 100], '#00786b', ['>=', ['get', 'n'], 20], '#12a894', '#5bc4b6'],
					'circle-opacity': 0.85,
					'circle-stroke-width': 1.1,
					'circle-stroke-color': '#ffffff'
				}
			});
			map.addLayer({
				id: 'city-labels', type: 'symbol', source: 'cities', minzoom: 6.5,
				filter: ['>=', ['get', 'n'], 8],
				layout: { 'text-field': ['get', 'city'], 'text-size': 11.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] },
				paint: { 'text-color': '#0b1b22', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
			});
			map.on('click', 'city-dots', function (e) { showCity(e.features[0].properties); });
			map.on('mouseenter', 'city-dots', function () { map.getCanvas().style.cursor = 'pointer'; });
			map.on('mouseleave', 'city-dots', function () { map.getCanvas().style.cursor = ''; });
		}).catch(function () {});
	});

	// ---- panel ----
	function lbl(t, v) {
		return '<div><span style="display:block;font-size:11.5px;color:#8aa0a6;text-transform:uppercase;letter-spacing:.6px">' + t + '</span><strong>' + v + '</strong></div>';
	}
	function showMuni(name) {
		var r = byName[name]; if (!r || !panel) return;
		var maxSale = Math.max.apply(null, rows.map(function (x) { return x.sale; }));
		var thin = r.sale / maxSale < 0.12;
		var h = '<h3 style="margin:0 0 2px;font-size:20px;letter-spacing:-0.5px;color:#0b1b22">' + name + '</h3>';
		h += '<p style="margin:0 0 14px;font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:#8aa0a6">INE ' + (r.ine || '') + '</p>';
		h += '<div style="font-size:14.5px;color:#45585f;line-height:1.5">';
		h += '<strong style="font-size:26px;color:#0b1b22;letter-spacing:-0.7px">' + r.sale.toLocaleString('en-GB') + '</strong> homes for sale';
		h += '<div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px 12px">';
		h += lbl('Median asking', r.median ? '€' + r.median.toLocaleString('en-GB') : '-');
		h += lbl('Asking €/m²', r.psm ? '€' + r.psm.toLocaleString('en-GB') : '-');
		h += lbl('Long-term', r.rent.toLocaleString('en-GB'));
		h += lbl('Holiday', r.holiday.toLocaleString('en-GB'));
		h += '</div>';
		if (r.verified) {
			h += '<div style="margin-top:15px;padding:12px;border-radius:10px;background:#f0faf8;border:1px solid #d6ede8">';
			h += '<span style="display:block;font-size:11.5px;color:#00867a;text-transform:uppercase;letter-spacing:.6px;font-weight:800">Notary-verified</span>';
			h += '<strong style="font-size:20px;color:#00867a">€' + r.verified.toLocaleString('en-GB') + '/m²</strong>';
			h += '<span style="display:block;font-size:12px;color:#5b6b73;margin-top:3px">what buyers actually paid · ' + (r.vn ? r.vn.toLocaleString('en-GB') + ' sales' : '') + '</span></div>';
		}
		if (thin) {
			h += '<div style="margin-top:14px;padding:12px;border-radius:10px;background:#fff5f2;border:1px solid #f6d9d0">';
			h += '<strong style="color:#c0392b;font-size:14px">Thin coverage</strong>';
			h += '<span style="display:block;font-size:13px;color:#5b6b73;margin-top:3px">Few agencies list here. Room to own this area.</span></div>';
		}
		if (r.agencies && r.agencies.length) {
			h += '<div style="margin-top:15px"><span style="display:block;font-size:11.5px;color:#8aa0a6;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Agencies listing here</span>';
			r.agencies.slice(0, 5).forEach(function (a) { h += '<div style="font-size:13.5px;color:#45585f;padding:3px 0;border-bottom:1px solid #f2f6f7">' + a.name + '</div>'; });
			h += '</div>';
		}
		panel.innerHTML = h + '</div>';
	}
	function showCity(p) {
		if (!panel) return;
		var h = '<h3 style="margin:0 0 2px;font-size:20px;letter-spacing:-0.5px;color:#0b1b22">' + p.city + '</h3>';
		h += '<p style="margin:0 0 14px;font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:#8aa0a6">' + (p.region || '') + '</p>';
		h += '<div style="font-size:14.5px;color:#45585f;line-height:1.5">';
		h += '<strong style="font-size:26px;color:#0b1b22;letter-spacing:-0.7px">' + Number(p.n).toLocaleString('en-GB') + '</strong> ' + (Number(p.n) === 1 ? 'home listed' : 'homes listed');
		h += '<div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px 12px">';
		h += lbl('Median asking', p.median ? '€' + Number(p.median).toLocaleString('en-GB') : '-');
		h += lbl('Asking €/m²', p.psm ? '€' + Number(p.psm).toLocaleString('en-GB') : '-');
		h += '</div>';
		if (Number(p.n) < 10) {
			h += '<p style="margin-top:14px;font-size:13px;color:#5b6b73">A small number of listings here - enough to show the network reaches this far, not enough to read as a market.</p>';
		}
		panel.innerHTML = h + '</div>';
	}

	// ---- controls ----
	document.querySelectorAll('.chip').forEach(function (b) {
		b.addEventListener('click', function () {
			document.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('on'); });
			b.classList.add('on');
			current = b.getAttribute('data-layer');
			var cfg = LAYERS[current];
			if (map.getLayer('muni-3d')) {
				map.setPaintProperty('muni-3d', 'fill-extrusion-color', ramp(cfg.key, current === 'gap'));
				map.setPaintProperty('muni-3d', 'fill-extrusion-height', heightExpr(cfg.key));
			}
			var lab = document.getElementById('legendlabel');
			if (lab) lab.textContent = cfg.label;
		});
	});
	var flat = document.getElementById('flattoggle');
	if (flat) flat.addEventListener('click', function () {
		var is3d = map.getPitch() > 5;
		map.easeTo({ pitch: is3d ? 0 : 50, bearing: is3d ? 0 : -14, duration: 700 });
		flat.textContent = is3d ? '3D view' : 'Flat view';
	});
	var home = document.getElementById('homebtn');
	if (home) home.addEventListener('click', function () { cancelIntro(); map.fitBounds(COAST, { padding: 30, pitch: 46, bearing: -18, duration: 1400 }); });
	var spain = document.getElementById('spainbtn');
	if (spain) spain.addEventListener('click', function () { cancelIntro(); map.flyTo({ center: [-4.2, 38.6], zoom: 5.1, pitch: 0, bearing: 0, duration: 1600 }); });
})();
