// Then & now on the network map (/map/ and /es/mapa/). A second, non-interactive map shows a
// historical national flight to the left of a draggable line and mirrors the main map's
// camera, so every gesture stays on the main map. Buttons live in .tnMapCtl (data-era);
// labels and credits come from data attributes so this one file serves EN and ES.
// Tiles: /api/ign-tile/{era}/{z}/{x}/{y}.jpg (our cache of IGN's WMS, CC-BY 4.0 ign.es).
// Uses class tnChip, never chip: map.js binds every .chip as a data-layer switch.
(function () {
	var ctl = document.querySelector('.tnMapCtl');
	var host = document.getElementById('map');
	var credit = document.querySelector('.tnMapCredit');
	if (!ctl || !host || !window.maplibregl) return;
	var MARBELLA = [-4.886, 36.5095];
	var HIDE = { munis: 1, cities: 1 };
	var main = null, then = null, saved = null, ui = null, pos = 50;
	var buttons = Array.prototype.slice.call(ctl.querySelectorAll('.tnChip[data-era]'));
	var off = ctl.querySelector('.tnOff');

	function track(name, data) { try { if (window.umami) window.umami.track(name, data); } catch (e) { /* never break the map */ } }
	function styleFor(era) {
		return {
			version: 8,
			sources: { then: { type: 'raster', tiles: ['/api/ign-tile/' + era + '/{z}/{x}/{y}.jpg'], tileSize: 256, minzoom: 10, maxzoom: era === '1956' ? 16 : 17 } },
			layers: [
				{ id: 'bg', type: 'background', paint: { 'background-color': '#cfd8db' } },
				{ id: 'then', type: 'raster', source: 'then', paint: { 'raster-fade-duration': 150 } }
			]
		};
	}
	function sync() {
		if (then && main) then.jumpTo({ center: main.getCenter(), zoom: main.getZoom(), bearing: main.getBearing(), pitch: main.getPitch() });
	}
	function setPos(p) {
		pos = Math.max(0, Math.min(100, p));
		if (!ui) return;
		ui.clip.style.clipPath = 'inset(0 ' + (100 - pos) + '% 0 0)';
		ui.line.style.left = pos + '%';
		ui.knob.setAttribute('aria-valuenow', String(Math.round(pos)));
	}
	function buildUi() {
		var wrap = document.createElement('div'); wrap.className = 'tnMapWrap';
		var clip = document.createElement('div'); clip.className = 'tnMapClip';
		var box = document.createElement('div'); box.className = 'tnMapThen';
		clip.appendChild(box); wrap.appendChild(clip);
		var line = document.createElement('div'); line.className = 'tnMapLine';
		var knob = document.createElement('div'); knob.className = 'tnMapKnob';
		knob.tabIndex = 0;
		knob.setAttribute('role', 'slider');
		knob.setAttribute('aria-valuemin', '0');
		knob.setAttribute('aria-valuemax', '100');
		knob.setAttribute('aria-label', ctl.getAttribute('data-slider') || 'Compare');
		knob.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M9 6 3 12l6 6zM15 6l6 6-6 6z"/></svg>';
		line.appendChild(knob); wrap.appendChild(line);
		var labL = document.createElement('span'); labL.className = 'tnMapLab tnMapLabL';
		var labR = document.createElement('span'); labR.className = 'tnMapLab tnMapLabR';
		labR.textContent = ctl.getAttribute('data-now') || 'Today';
		wrap.appendChild(labL); wrap.appendChild(labR);
		host.appendChild(wrap);
		knob.addEventListener('pointerdown', function (e) { knob.setPointerCapture(e.pointerId); e.preventDefault(); });
		knob.addEventListener('pointermove', function (e) {
			if (!knob.hasPointerCapture(e.pointerId)) return;
			var r = host.getBoundingClientRect();
			setPos(((e.clientX - r.left) / r.width) * 100);
		});
		knob.addEventListener('pointerup', function (e) { if (knob.hasPointerCapture(e.pointerId)) knob.releasePointerCapture(e.pointerId); });
		knob.addEventListener('keydown', function (e) {
			var d = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : e.key === 'Home' ? -100 : e.key === 'End' ? 100 : 0;
			if (d) { e.preventDefault(); setPos(pos + d); }
		});
		return { wrap: wrap, clip: clip, box: box, line: line, knob: knob, labL: labL };
	}
	function mark(era) {
		buttons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-era') === era ? 'true' : 'false'); });
		if (off) off.hidden = !era;
	}
	function enter(btn) {
		main = window.__PLMAPOBJ__;
		if (!main || !main.loaded()) return;
		var era = btn.getAttribute('data-era');
		if (!saved) {
			saved = {
				terrain: main.getTerrain ? main.getTerrain() : null,
				projection: main.getProjection ? main.getProjection() : null,
				minZoom: main.getMinZoom(),
				pitch: main.getPitch(),
				bearing: main.getBearing(),
				vis: {}
			};
			if (!saved.terrain && main.getSource('dem')) saved.terrain = { source: 'dem', exaggeration: 1.25 };
			(main.getStyle().layers || []).forEach(function (l) {
				if (l.source && HIDE[l.source]) {
					saved.vis[l.id] = main.getLayoutProperty(l.id, 'visibility') || 'visible';
					main.setLayoutProperty(l.id, 'visibility', 'none');
				}
			});
			try { main.setTerrain(null); } catch (e) { /* older engines */ }
			try { main.setProjection({ type: 'mercator' }); } catch (e) { /* older engines */ }
			ui = buildUi();
			then = new maplibregl.Map({ container: ui.box, style: styleFor(era), interactive: false, attributionControl: false, center: main.getCenter(), zoom: main.getZoom(), pitch: 0, bearing: 0 });
			main.on('move', sync);
			var z = main.getZoom();
			main.easeTo({ center: z >= 11 ? main.getCenter() : MARBELLA, zoom: Math.max(z, 13), pitch: 0, bearing: 0, duration: 900 });
			main.once('moveend', function () { if (saved) main.setMinZoom(10.5); });
			setPos(50);
		} else {
			then.setStyle(styleFor(era));
		}
		ui.labL.textContent = btn.getAttribute('data-label') || era;
		if (credit) {
			var src = credit.querySelector('.tnMapSrc');
			if (src) src.textContent = btn.getAttribute('data-credit') || '';
			credit.hidden = false;
		}
		mark(era);
		track('map-then-now', { era: era });
	}
	function exit() {
		if (!saved || !main) return;
		main.off('move', sync);
		if (then) { then.remove(); then = null; }
		if (ui) { ui.wrap.remove(); ui = null; }
		Object.keys(saved.vis).forEach(function (id) { if (main.getLayer(id)) main.setLayoutProperty(id, 'visibility', saved.vis[id]); });
		try { if (saved.projection) main.setProjection(saved.projection); } catch (e) { /* ignore */ }
		try { if (saved.terrain) main.setTerrain(saved.terrain); } catch (e) { /* ignore */ }
		main.setMinZoom(saved.minZoom);
		main.easeTo({ pitch: saved.pitch, bearing: saved.bearing, duration: 700 });
		saved = null;
		if (credit) credit.hidden = true;
		mark('');
	}
	buttons.forEach(function (b) {
		b.addEventListener('click', function () {
			if (b.getAttribute('aria-pressed') === 'true') exit();
			else enter(b);
		});
	});
	if (off) off.addEventListener('click', exit);
})();
