// Preguntas y respuestas de la sección Features FAQ - español
// Section header: "¿Cuánto cuesta PropertyList y qué incluye?"
// Section anchor: #cuanto-cuesta-propertylist-y-que-incluye

export const featureFaqItemsEs = [
  // ─── Website Builder ───────────────────────────────────────────────────
  {
    id: 'website-builder-exists',
    q: '¿PropertyList tiene un creador de webs para agencias inmobiliarias?',
    aHtml:
      'Sí. PropertyList ofrece un constructor de webs drag-and-drop diseñado específicamente para agencias inmobiliarias. Construye y previsualiza tu web gratis - solo pagas cuando publiques. <a href="https://info.propertylist.es/website-builder">Ver cómo funciona</a>.',
  },
  {
    id: 'auto-property-upload',
    q: '¿Tengo que subir mis propiedades manualmente a mi web de agencia?',
    aHtml:
      'No. Cada anuncio de tu MLS de PropertyList - fotos, precios, descripciones - se carga automáticamente en tu web de agencia. Sin necesidad de volver a introducir los datos.',
  },
  {
    id: 'custom-domain',
    q: '¿Puedo usar mi propio dominio con el creador de webs de PropertyList?',
    aHtml:
      'Sí. Conecta tu propio dominio (tu-agencia.com) a tu web PropertyList. El extra de dominio personalizado cuesta 20 créditos/mes (unos 20 €) adicionales.',
  },
  {
    id: 'seo-features',
    q: '¿Qué funciones SEO incluye el creador de webs de PropertyList?',
    aHtml:
      'Meta títulos y descripciones SEO generados con IA para cada página, páginas de ubicación y zona generadas automáticamente, y código schema markup integrado. Cada página de anuncio está estructurada para buscadores desde el primer momento.',
  },
  {
    id: 'leads-to-crm',
    q: '¿Cómo llegan los leads de mi web de agencia a mi CRM?',
    aHtml:
      'Los formularios de captura de leads están incrustados en tu web y envían las consultas directamente a tu CRM de PropertyList en el momento en que un visitante envía el formulario - sin exportación manual.',
  },
  {
    id: 'cancel-website-builder',
    q: '¿Qué pasa con mi web si cancelo la suscripción al creador de webs?',
    aHtml:
      'Tu web publicada se desconecta. Tus anuncios y datos del CRM no se ven afectados - todo permanece en PropertyList. Puedes republicar en cualquier momento sin penalización ni nueva carga.',
  },

  // ─── XML Feeds ────────────────────────────────────────────────────────
  {
    id: 'xml-own-website',
    q: 'Ya tengo una web - ¿puedo incluir mis propiedades de PropertyList?',
    aHtml:
      'Sí, de dos formas: un feed XML en directo que tu web lee cada cierto tiempo, o la API para webs, una clave REST que tu web consulta directamente con resultados en vivo. Exportar tus propios anuncios es gratis en ambos casos. Alimentar tu web con toda la red son 35 créditos al mes, XML o API, mismo precio. Ambos pueden publicar a portales de terceros a la vez. <a href="https://propertylist.es/api-docs" rel="noopener">Documentación de la API</a>.',
  },
  {
    id: 'private-listings',
    q: '¿Puedo mantener un anuncio privado y no compartirlo con otros agentes?',
    aHtml:
      'Sí. En My Listings, selecciona las propiedades y usa Bulk actions &gt; "Do not share with other agents". La propiedad se oculta a otras agencias en el MLS, no aparece en sus microsites y queda fuera de todos los feeds de exportación - pero sigue activa en el portal público, así los compradores directos la encuentran y cada lead te llega a ti. Tus primeros 5 anuncios privados activos son gratis, después 5 créditos cada uno, y puedes reactivar la compartición cuando quieras. <a href="https://info.propertylist.es/es/docs/propertylist-mls-manual-de-usuario/managing-listings/private-listings/">Lee la guía</a>.',
  },
  {
    id: 'crm-email-integration',
    q: '¿Puedo conectar mi propio correo (Gmail u Outlook) al CRM?',
    aHtml: 'La integración del correo está en construcción: conectarás de forma segura (OAuth) Gmail/Google Workspace u Outlook/Microsoft 365, con sincronización bidireccional y envío desde tu propia dirección, mientras las conversaciones se enlazan automáticamente con el lead correcto. <a href="https://info.propertylist.es/es/docs/propertylist-mls-manual-de-usuario/contacts-crm/connect-your-email/">Consulta la guía</a> para preparar hoy tu Google Workspace o Microsoft 365.',
  },
  {
    id: 'xml-property-types',
    q: '¿Qué tipos de propiedades incluye el feed XML?',
    aHtml:
      'El feed combinado incluye todas las propiedades de segunda mano, alquileres a largo plazo y alquileres vacacionales en un único flujo. Un feed, todos los tipos de inventario.',
  },
  {
    id: 'xml-new-developments',
    q: '¿Hay un feed XML separado para nuevos desarrollos?',
    aHtml:
      'Sí. Las propiedades de nueva construcción y de plano están en un feed dedicado separado - manteniendo tu feed de segunda mano y alquiler limpio y ordenado.',
  },
  {
    id: 'xml-portals',
    q: '¿Puedo usar el feed XML para enviar anuncios a otros portales como Idealista?',
    aHtml:
      'Sí. Ambos feeds envían a tu propia web y a portales de terceros simultáneamente - Idealista, Fotocasa, o cualquier plataforma que acepte XML.',
  },
  {
    id: 'xml-cost',
    q: '¿Cuánto cuesta el feed XML?',
    aHtml:
      'Enviar tus anuncios a otros portales - Idealista, Fotocasa o cualquier plataforma que acepte XML - es gratis. El feed de pago es para alimentar tu propia web: 35 créditos/mes (unos 35 €) el feed de reventa y alquileres, y 25 créditos/mes el de obra nueva. <a href="https://info.propertylist.es/es/precios">Precios completos</a>.',
  },

  // ─── Market Intelligence ──────────────────────────────────────────────
  {
    id: 'market-reports',
    q: '¿PropertyList ofrece informes de mercado inmobiliario?',
    aHtml:
      'Sí. La plataforma de Market Intelligence de PropertyList (intelligence.propertylist.es) ofrece informes basados en datos reales de transacciones MLS en la Costa del Sol.',
  },
  {
    id: 'market-reports-free',
    q: '¿Los informes de mercado son gratuitos?',
    aHtml:
      'Los resúmenes de ciudad gratuitos están disponibles sin registro - lecturas mensuales de precio mediano, variación interanual y días en mercado para Marbella, Estepona, Mijas, Benahavís, Fuengirola, Sotogrande y más. También hay informes forenses de pago y suscripciones de acceso en directo.',
  },
  {
    id: 'forensic-reports',
    q: '¿Qué son los informes forenses de pago y cuánto cuestan?',
    aHtml:
      'Informes PDF de pago único entregados en menos de un minuto. Precios: Executive Overview 5 €, Market Value Index 9 €, District Deep-Dive 9 €, New Dev Pipeline 19 €, Buyer Origin & Demand 19 €, Investment Forensic 29 €.',
  },
  {
    id: 'live-dashboard',
    q: '¿Hay un dashboard de mercado en directo para inversores o asesores serios?',
    aHtml:
      'Sí. Strategic Investor (29 €/mes) ofrece 5 sectores seleccionados, 10 informes de análisis profundo al mes, actualizaciones semanales de datos y alertas de umbral. Enterprise Authority (99 €/mes) añade áreas ilimitadas, informes ilimitados, PDFs para clientes con marca blanca y mapas de calor de origen de compradores.',
  },

  // ─── CRM & Pipelines ──────────────────────────────────────────────────
  {
    id: 'crm-free',
    q: '¿El CRM de PropertyList es realmente gratis?',
    aHtml:
      'El MLS core y el CRM son gratis para siempre. Eso incluye los pipelines de Lead, Seller y Property, sin límites. Solo pagas por la demanda: 1 crédito por cada lead cualificado que decidas meter en el pipeline de Buyer, que se descuenta de tu saldo de créditos. El pipeline de Tenants va con la suscripción del Módulo de Alquileres y el de Nurture con la suscripción de Automatización y Nurture. <a href="https://info.propertylist.es/es/precios/">Ver precios</a>.',
  },
  {
    id: 'pipeline-boards',
    q: '¿Qué tableros de pipeline incluye el CRM de PropertyList?',
    aHtml:
      'Seis pipelines que funcionan juntos automáticamente: Lead (todos los leads nuevos entran en New Lead), Buyer (compradores cualificados), Seller (recorrido del vendedor), Property (estado del stock, los anuncios nuevos entran en Active Listing), Tenants (pipeline de alquiler, incluido en la suscripción del Módulo de Alquileres) y Nurture (clientes pasados y referrals, incluido en la suscripción de Automatización y Nurture). Los pipelines de Buyer y Property también incluyen la fase legal: Reservation Paid, Deposit Paid, Mortgage in Progress, Notary Appointment y WON - Deed Signed. Lead y Seller son fijos; Buyer y Property son editables.',
  },
  {
    id: 'pipeline-setup',
    q: '¿Tengo que configurar los tableros de pipeline manualmente?',
    aHtml:
      'No. Todos los tableros se configuran automáticamente y todos los contactos y propiedades existentes se distribuyen en los tableros correctos desde el primer día - nada que configurar.',
  },
  {
    id: 'pipeline-pricing',
    q: '¿Cómo funciona el precio de los pipelines - qué pago exactamente?',
    aHtml:
      'Pagas por la demanda, no por el inventario. Los pipelines de Lead, Seller y Property son gratis. El pipeline de Buyer cuesta 1 crédito por cada lead cualificado que decidas meter en él, y los créditos se descuentan de tu saldo de créditos. El pipeline de Tenants va incluido en el Módulo de Alquileres: 50 créditos por período de 30 días, con prueba gratis de 30 días. El pipeline de Nurture va incluido en la suscripción de Automatización y Nurture, 20 créditos/mes (unos 20 €), que cubre además todos los correos automáticos, la detección de leads calientes (Hot-lead) y la Daily Action Queue.',
  },

  // ─── Rentals Module ───────────────────────────────────────────────────
  {
    id: 'rentals-module',
    q: '¿PropertyList tiene un módulo de gestión de alquileres?',
    aHtml:
      'Sí. El Módulo de Alquileres desbloquea el flujo completo de trabajo de alquiler - desde la primera consulta hasta la firma del contrato y la renovación.',
  },
  {
    id: 'rentals-includes',
    q: '¿Qué incluye el módulo de Alquileres?',
    aHtml:
      'Un tablero de Tenants dedicado, un libro de arrendamientos (contratos vivos/en expiración/finalizados con estado de la fianza), correos automáticos de renovación de contrato (30 días antes del vencimiento, multilingüe), flujo de trabajo de mantenimiento con seguimiento de proveedores, vista de cartera de propietarios con renta y renovaciones pendientes, y un registro de auditoría completo para disputas de fianzas.',
  },
  {
    id: 'rentals-cost',
    q: '¿Cuánto cuesta el módulo de Alquileres?',
    aHtml:
      'Prueba gratis de 30 días, sin tarjeta de crédito necesaria. Después de la prueba son 50 créditos por período de 30 días, sin cargo hasta que renueves.',
  },
  {
    id: 'rentals-deposit-disputes',
    q: '¿El módulo de Alquileres gestiona disputas de fianzas y cumple con la ley de alquiler española?',
    aHtml:
      'Sí. El registro de auditoría marca con fecha y hora cada cambio de estado y de fianza junto al agente responsable - proporcionando evidencia defendible para disputas de fianzas españolas bajo el marco LAU / RDL 8/2024.',
  },

  // ─── Credits & Pricing ─────────────────────────────────────────────────
  {
    id: 'credits-work',
    q: '¿Cómo funcionan los créditos de PropertyList?',
    aHtml:
      '1 crédito (~1€). Compra en volumen con descuento. Los créditos nunca caducan. Se usan para desbloquear funciones de pago en toda la plataforma. Para cualquier cuota mensual puedes activar la recarga automática: una tarjeta guardada repone tu saldo por el coste de tus suscripciones activas el día antes de la renovación, así nada se pausa. Es una forma de pagar, no un cargo extra. <a href="https://info.propertylist.es/es/precios/">Ver precios de créditos</a>.',
  },
  {
    id: 'credits-expire',
    q: '¿Los créditos caducan?',
    aHtml: 'No. Los créditos de PropertyList nunca caducan - úsalos a tu propio ritmo.',
  },
  {
    id: 'earn-free-credits',
    q: '¿Puedo ganar créditos gratis en PropertyList?',
    aHtml:
      'Sí. Verifica tu agencia (gratis, y cuando quieras) y recibe 20 créditos gratis. Los agentes también ganan 20 créditos por cada agencia que se registra a través de su enlace de referido - y el nuevo usuario recibe 10 créditos.',
  },

  // ─── MCP / Developers ─────────────────────────────────────────────────
  {
    id: 'api-developers',
    q: '¿PropertyList tiene una API para desarrolladores?',
    aHtml:
      'Dos, para cosas distintas. La API para webs lleva tu propia cartera de PropertyList a tu web (una clave REST que creas, rotas y revocas en tu cuenta, 35 créditos al mes por toda la red, gratis para tus propios anuncios). El MCP en mcp.propertylist.es es un servidor de Model Context Protocol que permite a agentes de IA buscar en el mercado: search_properties, find_properties_by_description, autocomplete_location, get_property, area_market_summary y list_agencies. <a href="https://propertylist.es/api-docs" rel="noopener">Docs de la API para webs</a>, <a href="https://mcp.propertylist.es/" rel="noopener">MCP</a>.',
  },
  {
    id: 'ai-tools',
    q: '¿Puedo conectar PropertyList a herramientas de IA como Claude, Cursor o Perplexity?',
    aHtml:
      'Sí. El MCP conecta los datos en directo de PropertyList a cualquier cliente compatible con MCP - Claude, Cursor, Zed, Perplexity y cualquier herramienta de Model Context Protocol - para que un agente de IA busque en tu mercado por ti. Instalación vía Claude Desktop config, adaptador npx o el endpoint JSON-RPC directo. La búsqueda estructurada funciona sin clave; el matcher de IA en lenguaje natural necesita una clave de agente, solo con aprobación.',
  },
  {
    id: 'mcp-free',
    q: '¿El MCP es gratis?',
    aHtml:
      'Tres niveles. Público: gratis, sin registro ni clave, búsqueda estructurada, autocompletado de ubicaciones, detalle completo de anuncios y resúmenes de mercado por zona a 60 solicitudes por minuto. Agente: una clave gratis, solo con aprobación (revisamos cada solicitud a mano), que activa el matcher de IA en lenguaje natural con 200 búsquedas de IA al mes incluidas, después 1 crédito por cada 10 búsquedas de la cartera de tu agencia y nada más, a 600 solicitudes por minuto. Enterprise: a medida, por contrato, para bancos, tasadores, portales y equipos de producto de IA. <a href="https://mcp.propertylist.es/" rel="noopener">mcp.propertylist.es</a>.',
  },

  // ─── Oracle ────────────────────────────────────────────────────────────
  {
    id: 'oracle',
    q: '¿Qué es PropertyList Oracle?',
    aHtml:
      'PropertyList Oracle (oracle.propertylist.es) es un suministro de precios €/m² firmado y ya disponible - creado para plataformas de tokenización, prestamistas on-chain e issuers de stablecoins respaldadas por propiedad que necesitan feeds de atestación diarios. Construido para protocolos RWA (Real World Assets). <a href="https://oracle.propertylist.es">Explora PropertyList Oracle</a>.',
  },
];

// JSON-LD FAQPage - respuestas de texto plano (sin HTML)
export const featureFaqLdEs = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: featureFaqItemsEs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: f.aHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    },
  })),
};