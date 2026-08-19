/* PropertyList network map - 3D globe + extruded city columns.
   Data: window.__PLMAP__ (municipality rows) and /map/cities.json (every listing's city).
   Intro: globe -> Iberia -> Costa del Sol. Any interaction cancels it. */
(function () {
	var rows = window.__PLMAP__ || [];
	var byName = {};
	rows.forEach(function (r) { byName[r.name] = r; });
	var ALIAS = { 'Benahavís': 'Benahavis', 'Benalmádena': 'Benalmadena' };

	var SIGNUP = window.__PLSIGNUP__ || 'https://agents.propertylist.es/new_agency/new?locale=en';
	var T = window.__PLTEXT__ || {
		thin: 'List them free, forever. Your properties reach every agent on the network.',
		cta: 'List for free',
		thinTitle: 'Room for another agency'
	};
	var el = document.getElementById('map');
	var panel = document.getElementById('panel');
	if (!el || typeof maplibregl === 'undefined') return;

	var COAST = [[-5.3581, 36.3103], [-4.5076, 36.6424]];
	var NETWORK = [[-9.1, 35.7], [3.9, 42.7]];
	var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	var map = new maplibregl.Map({
		container: 'map',
		style: '/map/pl-style.json',
		center: [-3.7, 40.2],
		zoom: reduce ? 5.2 : 1.6,
		pitch: 0,
		bearing: 0,
		antialias: true,
		attributionControl: false,
		cooperativeGestures: true
	});
	try { map.setProjection({ type: 'globe' }); } catch (e) {}
	window.__PLMAPOBJ__ = map;
	map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
	map.addControl(new maplibregl.AttributionControl({
		compact: true,
		customAttribution: 'OpenStreetMap · Esri · AWS · PropertyList · Notariado'
	}));
	// keep it as a small (i) rather than a bar of text; full credits sit under the map
	map.on('load', function () {
		var a = el.querySelector('.maplibregl-ctrl-attrib');
		if (a) a.classList.remove('maplibregl-compact-show');
	});

	// ---- intro flight, cancellable ----
	var introRunning = false, introDone = false;
	function cancelIntro() {
		if (!introRunning) return;
		introRunning = false; introDone = true;
		map.stop();
		var b = skipBtn(); if (b) b.style.display = 'none';
	}
	['mousedown', 'wheel', 'touchstart', 'keydown'].forEach(function (ev) {
		el.addEventListener(ev, cancelIntro, { passive: true });
	});
	function skipBtn() { return document.getElementById('skipintro'); }
	document.addEventListener('click', function (ev) {
		var t = ev.target;
		if (t && t.id === 'skipintro') {
			cancelIntro();
			map.fitBounds(COAST, { padding: 30, duration: 900, pitch: 46, bearing: -18 });
		}
	});


	// hold the intro until the map is actually on screen
	var armed = false;
	function armIntro() {
		if (armed) return;
		armed = true;
		var io = null;
		function onScreen() {
			var r = el.getBoundingClientRect();
			var h = window.innerHeight || document.documentElement.clientHeight;
			return r.top < h * 0.55 && r.bottom > h * 0.25;
		}
		function stop() {
			window.removeEventListener('scroll', maybe);
			window.removeEventListener('resize', maybe);
			if (io) io.disconnect();
		}
		function maybe() {
			if (introDone || introRunning) { stop(); return; }
			if (onScreen()) { stop(); runIntro(); }
		}
		if ('IntersectionObserver' in window) {
			io = new IntersectionObserver(function (entries) {
				entries.forEach(function (e) { if (e.isIntersecting) maybe(); });
			}, { threshold: 0.3 });
			io.observe(el);
		}
		window.addEventListener('scroll', maybe, { passive: true });
		window.addEventListener('resize', maybe);
		maybe();
	}

	function runIntro() {
		if (reduce) { map.fitBounds(COAST, { padding: 30, duration: 0, pitch: 45 }); introDone = true; window.__PLINTRO__ = 'reduced-motion'; return; }
		introRunning = true;
		window.__PLINTRO__ = 'running';
		var sb = skipBtn(); if (sb) sb.style.display = 'inline-flex';
		map.flyTo({ center: [-3.7, 40.2], zoom: 4.6, pitch: 0, duration: 2600, essential: true });
		setTimeout(function () {
			if (!introRunning) return;
			map.flyTo({ center: [-4.9, 36.52], zoom: 8.2, pitch: 42, bearing: -14, duration: 3200, essential: true });
		}, 2750);
		setTimeout(function () {
			if (!introRunning) return;
			map.fitBounds(COAST, { padding: 30, pitch: 46, bearing: -18, duration: 2200 });
			introRunning = false; introDone = true;
			window.__PLINTRO__ = 'done';
			var sb2 = skipBtn(); if (sb2) sb2.style.display = 'none';
		}, 6100);
	}

	// ---- layers ----
	var LAYERS = {
		sale:     { key: 'sale',     label: 'Colour shows how many homes are listed.' },
		psm:      { key: 'psm',      label: 'Colour shows the asking price per m².' },
		verified: { key: 'verified', label: 'Colour shows the notary-verified price per m².' },
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
			? ['#ff5a3c', '#ff8a63', '#ffc4ab', '#8fe6d6', '#2fe3cb']
			: ['#0d5f57', '#12907f', '#17b39c', '#42d6bd', '#7deede'];
		var e = ['interpolate', ['linear'], ['coalesce', ['feature-state', key], s.lo]];
		for (var i = 0; i < cols.length; i++) e.push(s.lo + ((s.hi - s.lo) * i) / (cols.length - 1), cols[i]);
		return e;
	}

	map.on('load', function () {
		// terrain + sky for the Google-Earth feel
		try {
			map.addSource('dem', {
				type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
				tileSize: 256, maxzoom: 13, encoding: 'terrarium'
			});
			map.setTerrain({ source: 'dem', exaggeration: 1.25 });
			map.setSky({ 'sky-color': '#0a3f52', 'horizon-color': '#1d7d86', 'fog-color': '#06181c', 'fog-ground-blend': 0.5, 'sky-horizon-blend': 0.6 });
		} catch (e) {}

		// municipality polygons, extruded
		fetch('/map/municipalities.geojson').then(function (r) { return r.json(); }).then(function (gj) {
			gj.features.forEach(function (f, i) { f.properties.mls = ALIAS[f.properties.name] || f.properties.name; f.id = i; });
			map.addSource('munis', { type: 'geojson', data: gj });
			map.addLayer({
				id: 'muni-3d', type: 'fill', source: 'munis',
				paint: {
					'fill-color': ramp('sale', false),
					'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.78, 0.58]
				}
			});
			map.addLayer({
				id: 'muni-line', type: 'line', source: 'munis',
				paint: { 'line-color': '#0affd8', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.6, 0.9], 'line-opacity': 0.6 }
			});
			map.addLayer({
				id: 'muni-label', type: 'symbol', source: 'munis', minzoom: 7.4,
				layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-font': ['Noto Sans Bold'] },
				paint: { 'text-color': '#ffffff', 'text-halo-color': '#04171a', 'text-halo-width': 1.8 }
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
			armIntro();
		}).catch(function () { armIntro(); });

		// every other listing location, as circles that scale with count
		fetch('/map/cities.json').then(function (r) { return r.json(); }).then(function (cj) {
			map.addSource('cities', { type: 'geojson', data: cj });
			map.addLayer({
				id: 'city-dots', type: 'circle', source: 'cities',
				filter: ['!', ['get', 'inside']],
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'],
						3, ['interpolate', ['linear'], ['get', 'n'], 1, 4, 100, 9, 1200, 15],
						9, ['interpolate', ['linear'], ['get', 'n'], 1, 6.5, 100, 15, 1200, 32]],
					'circle-color': ['case', ['>=', ['get', 'n'], 100], '#7deede', ['>=', ['get', 'n'], 20], '#2fe3cb', '#0affd8'],
					'circle-opacity': 0.85,
					'circle-stroke-width': 1.1,
					'circle-stroke-color': '#eafff9'
				}
			});
			map.addLayer({
				id: 'city-labels', type: 'symbol', source: 'cities', minzoom: 6.5,
				filter: ['all', ['!', ['get', 'inside']], ['>=', ['get', 'n'], 8]],
				layout: { 'text-field': ['get', 'city'], 'text-size': 11.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] },
				paint: { 'text-color': '#eafff9', 'text-halo-color': '#04171a', 'text-halo-width': 1.5 }
			});
			map.addLayer({
				id: 'city-hit', type: 'circle', source: 'cities',
				filter: ['!', ['get', 'inside']],
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'],
						3, ['interpolate', ['linear'], ['get', 'n'], 1, 9, 100, 14, 1200, 20],
						9, ['interpolate', ['linear'], ['get', 'n'], 1, 12, 100, 20, 1200, 36]],
					'circle-color': '#000000',
					'circle-opacity': 0
				}
			});
			map.on('click', 'city-hit', function (e) { showCity(e.features[0].properties); });
			map.on('mouseenter', 'city-hit', function () { map.getCanvas().style.cursor = 'pointer'; });
			map.on('mouseleave', 'city-hit', function () { map.getCanvas().style.cursor = ''; });
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
			h += '<strong style="color:#c0392b;font-size:14px">' + T.thinTitle + '</strong>';
			h += '<span style="display:block;font-size:13px;color:#5b6b73;margin:3px 0 9px">' + T.thin + '</span>';
			h += '<a href="' + SIGNUP + '" data-umami-event="map-panel-signup" style="display:inline-block;background:#00ae9a;color:#fff;border-radius:999px;padding:9px 18px;font-size:13.5px;font-weight:800;text-decoration:none">' + T.cta + '</a></div>';
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
		if (p.v) {
			h += '<div style="margin-top:15px;padding:12px;border-radius:10px;background:#f0faf8;border:1px solid #d6ede8">';
			h += '<span style="display:block;font-size:11.5px;color:#00867a;text-transform:uppercase;letter-spacing:.6px;font-weight:800">' + T.verified + '</span>';
			h += '<strong style="font-size:20px;color:#00867a">€' + Number(p.v).toLocaleString('en-GB') + '/m²</strong>';
			h += '<span style="display:block;font-size:12px;color:#5b6b73;margin-top:3px">' + T.paid + ' · ' + Number(p.vn).toLocaleString('en-GB') + ' ' + T.sales + '</span></div>';
		} else if (p.vwhy) {
			var why = p.vwhy === 'pt' ? T.whyPt : (p.vwhy === 'thin' ? T.whyThin : T.whyNone);
			h += '<p style="margin-top:13px;font-size:12.5px;color:#8aa0a6;line-height:1.5">' + why + '</p>';
		}
		if (Number(p.n) < 10) {
			h += '<div style="margin-top:15px;padding:13px;border-radius:10px;background:#f0faf8;border:1px solid #d6ede8">';
			h += '<strong style="display:block;font-size:14px;color:#0b1b22;margin-bottom:3px">Do you list in ' + p.city + '?</strong>';
			h += '<span style="display:block;font-size:13px;color:#5b6b73;margin-bottom:9px">' + T.thin + '</span>';
			h += '<a href="' + SIGNUP + '" data-umami-event="map-panel-signup" style="display:inline-block;background:#00ae9a;color:#fff;border-radius:999px;padding:9px 18px;font-size:13.5px;font-weight:800;text-decoration:none">' + T.cta + '</a></div>';
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
				map.setPaintProperty('muni-3d', 'fill-color', ramp(cfg.key, current === 'gap'));
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
	if (spain) spain.addEventListener('click', function () {
		cancelIntro();
		map.fitBounds(NETWORK, { padding: { top: 40, bottom: 40, left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 1700 });
	});
})();
