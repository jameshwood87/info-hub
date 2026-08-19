/* PropertyList network map - MapLibre + OSM admin boundaries.
   Data injected by map.astro as window.__PLMAP__ (per-municipality rows).
   Falls back to a plain polygon render if the basemap tiles fail. */
(function () {
	var rows = window.__PLMAP__ || [];
	var byName = {};
	rows.forEach(function (r) { byName[r.name] = r; });
	// OSM names carry accents; our MLS names do not.
	var ALIAS = { 'Benahavís': 'Benahavis', 'Benalmádena': 'Benalmadena' };

	var el = document.getElementById('map');
	var panel = document.getElementById('panel');
	if (!el || typeof maplibregl === 'undefined') return;

	var LAYERS = {
		sale:     { key: 'sale',     label: 'Darker means more homes listed.',                    fmt: function (v) { return v.toLocaleString('en-GB') + ' listed'; } },
		psm:      { key: 'psm',      label: 'Darker means a higher asking price per m².',         fmt: function (v) { return '€' + v.toLocaleString('en-GB') + '/m²'; } },
		verified: { key: 'verified', label: 'Darker means a higher notary-verified price per m².', fmt: function (v) { return '€' + v.toLocaleString('en-GB') + '/m²'; } },
		gap:      { key: 'sale',     label: 'Red means we are thin on the ground - room for another agency.', fmt: function (v) { return v.toLocaleString('en-GB') + ' listed'; } }
	};
	var current = 'sale';

	function vals(key) {
		return rows.map(function (r) { return r[key]; }).filter(function (v) { return typeof v === 'number' && v > 0; });
	}
	function ramp(key, invert) {
		var v = vals(key);
		if (!v.length) return ['literal', '#cfe0e2'];
		v.sort(function (a, b) { return a - b; });
		var lo = v[0], hi = v[v.length - 1];
		var cols = invert
			? ['#c0392b', '#e4573d', '#f0a58f', '#bcd9d4', '#00ae9a']
			: ['#d8ecea', '#9fd8d0', '#5bc4b6', '#12a894', '#00786b'];
		var stops = ['interpolate', ['linear'], ['coalesce', ['feature-state', key], lo]];
		for (var i = 0; i < cols.length; i++) {
			stops.push(lo + ((hi - lo) * i) / (cols.length - 1), cols[i]);
		}
		return stops;
	}

	var map = new maplibregl.Map({
		container: 'map',
		style: 'https://tiles.openfreemap.org/styles/liberty',
		bounds: [[-5.3581, 36.3103], [-4.5076, 36.6424]],
		fitBoundsOptions: { padding: { top: 28, bottom: 28, left: 28, right: 28 } },
		attributionControl: false,
		cooperativeGestures: true
	});
	map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
	map.addControl(new maplibregl.AttributionControl({
		compact: true,
		customAttribution: 'Boundaries © OpenStreetMap contributors · Market data PropertyList · Verified prices Consejo General del Notariado'
	}));

	// If the basemap never loads, still show the polygons on a flat background.
	var styleOk = false;
	map.on('styledata', function () { styleOk = true; });
	setTimeout(function () {
		if (!styleOk) {
			try { map.setStyle({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfeaec' } }] }); } catch (e) {}
		}
	}, 6000);

	map.on('load', function () {
		fetch('/map/municipalities.geojson')
			.then(function (r) { return r.json(); })
			.then(function (gj) {
				gj.features.forEach(function (f, i) {
					var n = f.properties.name;
					f.properties.mls = ALIAS[n] || n;
					f.id = i;
				});
				map.addSource('munis', { type: 'geojson', data: gj });

				map.addLayer({
					id: 'muni-fill', type: 'fill', source: 'munis',
					paint: { 'fill-color': ramp('sale', false), 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.92, 0.74] }
				});
				map.addLayer({
					id: 'muni-line', type: 'line', source: 'munis',
					paint: { 'line-color': '#0b1b22', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.4, 1], 'line-opacity': 0.55 }
				});
				map.addLayer({
					id: 'muni-label', type: 'symbol', source: 'munis',
					layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': false },
					paint: { 'text-color': '#0b1b22', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 }
				});

				gj.features.forEach(function (f) {
					var r = byName[f.properties.mls];
					if (!r) return;
					map.setFeatureState({ source: 'munis', id: f.id }, {
						sale: r.sale, psm: r.psm || 0, verified: r.verified || 0
					});
				});

				var hovered = null;
				map.on('mousemove', 'muni-fill', function (e) {
					map.getCanvas().style.cursor = 'pointer';
					if (hovered !== null) map.setFeatureState({ source: 'munis', id: hovered }, { hover: false });
					hovered = e.features[0].id;
					map.setFeatureState({ source: 'munis', id: hovered }, { hover: true });
				});
				map.on('mouseleave', 'muni-fill', function () {
					map.getCanvas().style.cursor = '';
					if (hovered !== null) map.setFeatureState({ source: 'munis', id: hovered }, { hover: false });
					hovered = null;
				});
				map.on('click', 'muni-fill', function (e) { show(e.features[0].properties.mls); });

				try { map.fitBounds([[-5.3581, 36.3103], [-4.5076, 36.6424]], { padding: 28, duration: 0 }); } catch (err) {}
			})
			.catch(function () {
				el.innerHTML = '<p style="padding:22px;color:#5b6b73">The map could not load. Every municipality is listed in the table below.</p>';
			});
	});

	function bar(pct) {
		return '<span style="display:block;height:6px;border-radius:4px;background:#eef3f4;overflow:hidden;margin-top:4px">' +
			'<span style="display:block;height:100%;width:' + Math.max(3, Math.round(pct * 100)) + '%;background:#00ae9a"></span></span>';
	}
	function show(name) {
		var r = byName[name];
		if (!r || !panel) return;
		var maxSale = Math.max.apply(null, rows.map(function (x) { return x.sale; }));
		var gapPct = r.sale / maxSale;
		var thin = gapPct < 0.12;
		var h = '<h3 style="margin:0 0 2px;font-size:20px;letter-spacing:-0.5px;color:#0b1b22">' + name + '</h3>';
		h += '<p style="margin:0 0 14px;font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:#8aa0a6">INE ' + (r.ine || '') + '</p>';
		h += '<div style="font-size:14.5px;color:#45585f;line-height:1.5">';
		h += '<strong style="font-size:26px;color:#0b1b22;letter-spacing:-0.7px">' + r.sale.toLocaleString('en-GB') + '</strong> homes for sale' + bar(gapPct);
		h += '<div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px 12px">';
		h += '<div><span style="display:block;font-size:11.5px;color:#8aa0a6;text-transform:uppercase;letter-spacing:.6px">Median asking</span><strong>' + (r.median ? '€' + r.median.toLocaleString('en-GB') : '-') + '</strong></div>';
		h += '<div><span style="display:block;font-size:11.5px;color:#8aa0a6;text-transform:uppercase;letter-spacing:.6px">Asking €/m²</span><strong>' + (r.psm ? '€' + r.psm.toLocaleString('en-GB') : '-') + '</strong></div>';
		h += '<div><span style="display:block;font-size:11.5px;color:#8aa0a6;text-transform:uppercase;letter-spacing:.6px">Long-term</span><strong>' + r.rent.toLocaleString('en-GB') + '</strong></div>';
		h += '<div><span style="display:block;font-size:11.5px;color:#8aa0a6;text-transform:uppercase;letter-spacing:.6px">Holiday</span><strong>' + r.holiday.toLocaleString('en-GB') + '</strong></div>';
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
			r.agencies.slice(0, 5).forEach(function (a) {
				h += '<div style="font-size:13.5px;color:#45585f;padding:3px 0;border-bottom:1px solid #f2f6f7">' + a.name + '</div>';
			});
			h += '</div>';
		}
		h += '</div>';
		panel.innerHTML = h;
	}

	document.querySelectorAll('.chip').forEach(function (b) {
		b.addEventListener('click', function () {
			document.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('on'); });
			b.classList.add('on');
			current = b.getAttribute('data-layer');
			var cfg = LAYERS[current];
			if (map.getLayer('muni-fill')) {
				map.setPaintProperty('muni-fill', 'fill-color', ramp(cfg.key, current === 'gap'));
			}
			var lab = document.getElementById('legendlabel');
			if (lab) lab.textContent = cfg.label;
		});
	});
})();
