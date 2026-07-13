import fs from 'fs';
for (const l of fs.readFileSync('/opt/info-hub/.env', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const D = process.env.DIRECTUS_URL, T = process.env.DIRECTUS_ADMIN_TOKEN;
const H = { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' };

const EN_IOS = `<h2>PropertyList on iOS (iPhone and iPad)</h2>
<p>The native PropertyList app for iPhone and iPad is in the final approval stage with the Apple App Store and will be available very soon. In the meantime, you can use the full PropertyList MLS and CRM on your iPhone or iPad today through Safari, and add it to your Home Screen so it opens just like an app.</p>
<h3>Native app: coming soon</h3>
<p>The iOS app is currently in review with Apple. As soon as it is approved we will announce it and add a direct App Store link here. <a href="mailto:xml@propertylist.es">Email us</a> to join the early-access list and be notified the moment it goes live.</p>
<h3>Use PropertyList now on your iPhone or iPad</h3>
<p>PropertyList is fully responsive and built for touch, so it works in your mobile browser today:</p>
<ol>
<li>Open <a href="https://agents.propertylist.es/login" target="_blank" rel="noopener">agents.propertylist.es/login</a> in <strong>Safari</strong>.</li>
<li>Sign in with your PropertyList agency account.</li>
</ol>
<h3>Add PropertyList to your Home Screen</h3>
<p>A Home Screen shortcut gives you a PropertyList icon that opens in full screen, without the browser bars:</p>
<ol>
<li>Open <a href="https://agents.propertylist.es/login" target="_blank" rel="noopener">agents.propertylist.es</a> in Safari.</li>
<li>Tap the <strong>Share</strong> button in the Safari toolbar (the square with an upward arrow).</li>
<li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
<li>Confirm the name and tap <strong>Add</strong>.</li>
</ol>
<p>The PropertyList icon will appear on your Home Screen, ready to open with a single tap.</p>
<h3>What you need</h3>
<ul>
<li>A recent version of iOS or iPadOS.</li>
<li>Safari (Add to Home Screen is a Safari feature on iOS).</li>
<li>An active PropertyList agency account.</li>
</ul>
<p>Need help getting set up? <a href="mailto:xml@propertylist.es">Contact our team</a> and we will walk you through it.</p>`;

const EN_ANDROID = `<h2>PropertyList on Android</h2>
<p>The native PropertyList app for Android is in the final approval stage with Google Play and will be available very soon. In the meantime, you can use the full PropertyList MLS and CRM on your Android phone or tablet today through Chrome, and add it to your home screen so it opens just like an app.</p>
<h3>Native app: coming soon</h3>
<p>The Android app is currently in review with Google. As soon as it is approved we will announce it and add a direct Google Play link here. <a href="mailto:xml@propertylist.es">Email us</a> to join the early-access list and be notified the moment it goes live.</p>
<h3>Use PropertyList now on Android</h3>
<p>PropertyList is fully responsive and built for touch, so it works in your mobile browser today:</p>
<ol>
<li>Open <a href="https://agents.propertylist.es/login" target="_blank" rel="noopener">agents.propertylist.es/login</a> in <strong>Chrome</strong>.</li>
<li>Sign in with your PropertyList agency account.</li>
</ol>
<h3>Add PropertyList to your home screen</h3>
<p>A home screen shortcut gives you a PropertyList icon that opens the app in full screen:</p>
<ol>
<li>Open <a href="https://agents.propertylist.es/login" target="_blank" rel="noopener">agents.propertylist.es</a> in Chrome.</li>
<li>Tap the <strong>three-dot menu</strong> in the top right.</li>
<li>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong> if it is offered).</li>
<li>Confirm and tap <strong>Add</strong>.</li>
</ol>
<p>The PropertyList icon will appear on your home screen for one-tap access.</p>
<h3>What you need</h3>
<ul>
<li>A recent version of Android.</li>
<li>Google Chrome, or another Chromium-based browser that supports Add to Home screen.</li>
<li>An active PropertyList agency account.</li>
</ul>
<p>Need a hand? <a href="mailto:xml@propertylist.es">Contact our team</a> and we will help you get started.</p>`;

const ES_IOS = `<h2>PropertyList en iOS (iPhone y iPad)</h2>
<p>La app nativa de PropertyList para iPhone y iPad está en la fase final de aprobación en la Apple App Store y estará disponible muy pronto. Mientras tanto, puedes usar todo el MLS y CRM de PropertyList en tu iPhone o iPad hoy mismo desde Safari, y añadirlo a tu pantalla de inicio para que se abra igual que una app.</p>
<h3>App nativa: muy pronto</h3>
<p>La app de iOS está actualmente en revisión con Apple. En cuanto se apruebe, lo anunciaremos y añadiremos aquí un enlace directo a la App Store. <a href="mailto:xml@propertylist.es">Escríbenos</a> para unirte a la lista de acceso anticipado y recibir un aviso en cuanto esté disponible.</p>
<h3>Usa PropertyList ahora en tu iPhone o iPad</h3>
<p>PropertyList es totalmente responsivo y está diseñado para pantallas táctiles, así que funciona en tu navegador móvil hoy mismo:</p>
<ol>
<li>Abre <a href="https://agents.propertylist.es/login" target="_blank" rel="noopener">agents.propertylist.es/login</a> en <strong>Safari</strong>.</li>
<li>Inicia sesión con tu cuenta de agencia de PropertyList.</li>
</ol>
<h3>Añade PropertyList a tu pantalla de inicio</h3>
<p>Un acceso directo en la pantalla de inicio te da un icono de PropertyList que se abre a pantalla completa, sin las barras del navegador:</p>
<ol>
<li>Abre <a href="https://agents.propertylist.es/login" target="_blank" rel="noopener">agents.propertylist.es</a> en Safari.</li>
<li>Toca el botón <strong>Compartir</strong> en la barra de Safari (el cuadrado con una flecha hacia arriba).</li>
<li>Desplázate hacia abajo y toca <strong>Añadir a pantalla de inicio</strong>.</li>
<li>Confirma el nombre y toca <strong>Añadir</strong>.</li>
</ol>
<p>El icono de PropertyList aparecerá en tu pantalla de inicio, listo para abrirse con un solo toque.</p>
<h3>Qué necesitas</h3>
<ul>
<li>Una versión reciente de iOS o iPadOS.</li>
<li>Safari (Añadir a pantalla de inicio es una función de Safari en iOS).</li>
<li>Una cuenta de agencia de PropertyList activa.</li>
</ul>
<p>¿Necesitas ayuda para configurarlo? <a href="mailto:xml@propertylist.es">Contacta con nuestro equipo</a> y te guiaremos paso a paso.</p>`;

const ES_ANDROID = `<h2>PropertyList en Android</h2>
<p>La app nativa de PropertyList para Android está en la fase final de aprobación en Google Play y estará disponible muy pronto. Mientras tanto, puedes usar todo el MLS y CRM de PropertyList en tu teléfono o tableta Android hoy mismo desde Chrome, y añadirlo a tu pantalla de inicio para que se abra igual que una app.</p>
<h3>App nativa: muy pronto</h3>
<p>La app de Android está actualmente en revisión con Google. En cuanto se apruebe, lo anunciaremos y añadiremos aquí un enlace directo a Google Play. <a href="mailto:xml@propertylist.es">Escríbenos</a> para unirte a la lista de acceso anticipado y recibir un aviso en cuanto esté disponible.</p>
<h3>Usa PropertyList ahora en Android</h3>
<p>PropertyList es totalmente responsivo y está diseñado para pantallas táctiles, así que funciona en tu navegador móvil hoy mismo:</p>
<ol>
<li>Abre <a href="https://agents.propertylist.es/login" target="_blank" rel="noopener">agents.propertylist.es/login</a> en <strong>Chrome</strong>.</li>
<li>Inicia sesión con tu cuenta de agencia de PropertyList.</li>
</ol>
<h3>Añade PropertyList a tu pantalla de inicio</h3>
<p>Un acceso directo en la pantalla de inicio te da un icono de PropertyList que abre la app a pantalla completa:</p>
<ol>
<li>Abre <a href="https://agents.propertylist.es/login" target="_blank" rel="noopener">agents.propertylist.es</a> en Chrome.</li>
<li>Toca el <strong>menú de tres puntos</strong> en la parte superior derecha.</li>
<li>Toca <strong>Añadir a pantalla de inicio</strong> (o <strong>Instalar app</strong> si aparece).</li>
<li>Confirma y toca <strong>Añadir</strong>.</li>
</ol>
<p>El icono de PropertyList aparecerá en tu pantalla de inicio para acceder con un solo toque.</p>
<h3>Qué necesitas</h3>
<ul>
<li>Una versión reciente de Android.</li>
<li>Google Chrome u otro navegador basado en Chromium compatible con Añadir a pantalla de inicio.</li>
<li>Una cuenta de agencia de PropertyList activa.</li>
</ul>
<p>¿Necesitas ayuda? <a href="mailto:xml@propertylist.es">Contacta con nuestro equipo</a> y te ayudaremos a empezar.</p>`;

const PAGES = [
  { language: 'en', path: '/docs/propertylist-mls-user-manual/getting-started/download-app/ios/', title: 'iOS (iPhone and iPad)', seo_title: 'PropertyList on iOS (iPhone and iPad)', seo_description: 'Use PropertyList on iPhone and iPad: add the MLS and CRM to your Home Screen now, and get the native iOS app when it launches.', description: 'Use PropertyList on iPhone and iPad, and add it to your Home Screen.', body: EN_IOS },
  { language: 'en', path: '/docs/propertylist-mls-user-manual/getting-started/download-app/android/', title: 'Android', seo_title: 'PropertyList on Android', seo_description: 'Use PropertyList on Android: add the MLS and CRM to your home screen now via Chrome, and get the native app when it launches.', description: 'Use PropertyList on Android, and add it to your home screen.', body: EN_ANDROID },
  { language: 'es', path: '/es/docs/propertylist-mls-manual-de-usuario/empezar/download-app/ios/', title: 'iOS (iPhone y iPad)', seo_title: 'PropertyList en iOS (iPhone y iPad)', seo_description: 'Usa PropertyList en iPhone y iPad: añade el MLS y CRM a tu pantalla de inicio ahora y obten la app nativa cuando se lance.', description: 'Usa PropertyList en iPhone y iPad, y anadelo a tu pantalla de inicio.', body: ES_IOS },
  { language: 'es', path: '/es/docs/propertylist-mls-manual-de-usuario/empezar/download-app/android/', title: 'Android', seo_title: 'PropertyList en Android', seo_description: 'Usa PropertyList en Android: añade el MLS y CRM a tu pantalla de inicio ahora con Chrome, y obten la app nativa cuando se lance.', description: 'Usa PropertyList en Android, y anadelo a tu pantalla de inicio.', body: ES_ANDROID },
];

const noDash = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ');

(async () => {
  for (const p of PAGES) {
    const exist = (await (await fetch(D + '/items/kb_pages?filter[path][_eq]=' + encodeURIComponent(p.path) + '&fields=id', { headers: H })).json()).data || [];
    if (exist.length) { console.log('SKIP exists #' + exist[0].id + ' ' + p.path); continue; }
    const rec = { status: 'published', language: p.language, path: p.path, title: noDash(p.title), seo_title: noDash(p.seo_title), seo_description: noDash(p.seo_description), description: noDash(p.description), body: noDash(p.body) };
    const r = await fetch(D + '/items/kb_pages', { method: 'POST', headers: H, body: JSON.stringify(rec) });
    const t = await r.text();
    if (!r.ok) { console.log('FAIL ' + p.path + ': ' + r.status + ' ' + t.slice(0, 200)); continue; }
    console.log('CREATED #' + JSON.parse(t).data.id + ' [' + p.language + '] ' + p.path);
  }
})();
