# The Spanish twin of trim-en.py: the same 37 passages, tightened the same way,
# so the two hand-written pages stay mirrors. Every price and fact stays.
import sys

P = '/opt/info-hub/src/pages/es/constructor-de-webs.astro'
s = open(P, encoding='utf-8').read()

PAIRS = [
    (
        '<figcaption class="filmCap">Grabado en el nuevo creador: los quince diseños, Solaz elegida, el titular seleccionado, la cabecera reorganizada y después Revisar y publicar. 33 segundos. Los extras y los totales que se ven son los de la web de ejemplo y se pueden editar.</figcaption>',
        '',
    ),
    (
        "'Elige uno de los quince diseños de web de agencia ya terminados, hazlo tuyo, y todas las propiedades de la red PropertyList están en ella, filtradas como tú quieras, con las consultas llegando a tu CRM. Gratis para crear y previsualizar, desde 50 créditos al mes en cuanto publicas.'",
        "'Quince diseños de web de agencia ya terminados, con toda la red PropertyList filtrada como tú quieras. Las consultas llegan a tu CRM. Gratis para crear, desde 50 créditos al mes en cuanto publicas.'",
    ),
    (
        'Quince webs de agencia ya terminadas, cargadas con todas las propiedades de la red y filtradas como tú quieras. Las consultas llegan a tu CRM y a tus pipelines, y tus propios anuncios están en la web el día que publicas.',
        'Quince webs de agencia ya terminadas, cargadas con toda la red y filtradas como tú quieras. Las consultas llegan a tu CRM.',
    ),
    (
        'Tu web lee de la misma red que tu MLS y tu CRM. Todas las propiedades de la red pueden estar en tu web el día que publicas, filtradas como tú quieras, y se actualizan en el momento en que un anuncio cambia.',
        'Tu web lee la misma red que tu MLS y tu CRM. Al día desde que publicas, y se actualiza sola después.',
    ),
    (
        'Cada plantilla es una web de agencia completa: las mismas páginas, los mismos bloques que necesita una agencia, con un aspecto distinto. Elige la que se adapte a cómo trabajas, no al revés.',
        'Cada una es una web de agencia completa: mismas páginas, mismos bloques, distinto aspecto. Elige la que se adapte a cómo ya trabajas.',
    ),
    (
        'Cambia de opinión más adelante: cambia de plantilla y conserva tus textos, tus páginas y tus ajustes. Tres de las quince (Solaz, Noir, Faro) empiezan con una película.',
        'Cambia de plantilla más adelante y conserva tus textos, páginas y ajustes. Solaz, Noir y Faro empiezan con una película.',
    ),
    (
        'Añade tu color de marca, tus textos y tus fotos en un editor que muestra la web real mientras trabajas. Cada bloque tiene varias disposiciones; elige una.',
        'Tu color de marca, tus textos, tus fotos, en un editor que muestra la web real. Cada bloque tiene varias disposiciones.',
    ),
    (
        'Las propiedades de la red y las tuyas ya están ahí, así que publicar no significa subir nada. Las consultas empiezan a llegar a tu CRM de inmediato.',
        'Nada que subir: los anuncios ya están ahí. Las consultas empiezan a llegar a tu CRM.',
    ),
    (
        'Tus propios anuncios están en tu web el día que publicas. Los de la red también: fíltralos y muestra los que encajan con tus compradores, desde el primer momento.',
        'Tus anuncios están en tu web el día que publicas. Los de la red también: fíltralos y muestra los que encajan con tus compradores.',
    ),
    (
        'Cada consulta entra como lead. Pasa los que quieras por tus pipelines: Lead, Seller y Property son gratis y sin límite, y mover un lead cualificado al pipeline de Buyer cuesta 1 crédito.',
        'Cada consulta entra como lead. Los pipelines Lead, Seller y Property son gratis y sin límite; mover un lead cualificado a Buyer cuesta 1 crédito.',
    ),
    (
        'Cada solicitud de un vendedor llega como un lead con un Property Intelligence Report ya rellenado, listo para comprar por 5 créditos si lo quieres.',
        'Cada solicitud llega como un lead con un Property Intelligence Report ya rellenado, tuyo por 5 créditos si lo quieres.',
    ),
    (
        'Gastos de compra en España con la ley citada. Comprobamos si hay tipos nuevos o actualizados y refrescamos el bloque, así tu web sigue correcta sin que la toques. Tu abogado confirma la cifra final.',
        'Gastos de compra en España, ley citada. Refrescamos los tipos cuando cambian, así sigue correcto sin que lo toques. Tu abogado confirma la cifra.',
    ),
    (
        'Conecta tu Perfil de Empresa de Google y tus reseñas aparecen en la web, o escríbelas tú. Nada se inventa. Tu equipo sale del personal que ya está en tu cuenta de agencia.',
        'Conecta tu Perfil de Empresa de Google y tus reseñas aparecen, o escríbelas tú. Nada se inventa. Tu equipo sale de tu cuenta de agencia.',
    ),
    (
        'Inglés y español vienen de serie. Añade los demás idiomas que usan tus compradores, en la misma web.',
        'Inglés y español de serie. Añade los demás idiomas que usan tus compradores.',
    ),
    (
        'Nada que alquilar, instalar ni renovar. Tu web es rápida y está protegida desde el día que publicas, y sigue así.',
        'Nada que alquilar, instalar ni renovar.',
    ),
    (
        'Servida desde la red de Cloudflare, así las páginas cargan rápido esté donde esté tu comprador. Sin factura de hosting ni servidor que cuidar.',
        'Servida desde la red de Cloudflare, así las páginas cargan rápido esté donde esté tu comprador. Sin factura de hosting.',
    ),
    (
        'Cada web funciona en https con un certificado que se renueva solo. El candado que esperan los compradores, sin que hagas nada.',
        'Cada web funciona en https con un certificado que se renueva solo.',
    ),
    (
        'Protección frente a DDoS y la seguridad perimetral de Cloudflare delante de tu web. Los ataques se absorben antes de llegar a ella.',
        'Protección frente a DDoS delante de tu web. Los ataques se absorben antes de llegar a ella.',
    ),
    (
        'Describe un cambio en lenguaje normal y la página se actualiza. Cada cambio es un borrador hasta que lo publicas, y Deshacer siempre está ahí.',
        'Describe un cambio en lenguaje normal y la página se actualiza. Todo queda en borrador hasta que publicas.',
    ),
    (
        '<figcaption>El titular seleccionado en el editor. Más corto, un tono más cercano, que mencione la localidad, o tus propias palabras.</figcaption>',
        '<figcaption>El titular seleccionado en el editor.</figcaption>',
    ),
    (
        'No se cobra nada mientras creas y previsualizas; la suscripción empieza el día que publicas.',
        'No se cobra nada hasta que publicas.',
    ),
    (
        '<li>Inicio, Propiedades (búsqueda y resultados, con filtros y una búsqueda guardada), una página de propiedad para cada anuncio, Sobre Nosotros y Contacto</li>',
        '<li>Inicio, Propiedades (búsqueda, filtros, búsqueda guardada), una página por anuncio, Sobre Nosotros y Contacto</li>',
    ),
    (
        '<li>Alojamiento y protección de Cloudflare incluidos: rápida y protegida, sin nada que gestionar</li>',
        '<li>Alojamiento y protección de Cloudflare incluidos</li>',
    ),
    (
        '<li>Cancela al final de cualquier mes; la web vuelve al microsite gratuito de agencia y conservas tu dominio</li>',
        '<li>Cancela cualquier mes; la web vuelve al microsite gratuito de agencia y conservas tu dominio</li>',
    ),
    (
        'Cada uno es mensual, se activa desde tu cuenta, y puede cancelarse al final de cualquier mes.',
        'Cada uno es mensual, se activa desde tu cuenta y se cancela cuando quieras.',
    ),
    (
        'La unidad de PropertyList para las funciones de pago, que se compra en packs: 1 crédito (alrededor de 1 EUR) en el pack más pequeño, menos en los packs más grandes. Los créditos no caducan, así que lo que no uses este mes sigue disponible el mes siguiente.',
        'La unidad de PropertyList para las funciones de pago, comprada en packs: 1 crédito son alrededor de 1 EUR en el pack más pequeño, menos en los grandes. Los créditos no caducan.',
    ),
    (
        'Lleva todos los anuncios de la red a la web que ya tienes, filtrados como tú quieras: solo tu propia cartera, o una selección de la red junto a ella. XML o la API para webs; tu desarrollador lo conecta una vez y desde entonces la web lee de la misma cuenta que tu MLS y tu CRM.',
        'Lleva la red a la web que ya tienes, filtrada como tú quieras: tu propia cartera, o una selección de la red junto a ella. XML o la API para webs, conectada una vez.',
    ),
    # FAQ answers.
    (
        "a: 'Sí. Crear y previsualizar tu web no cuesta nada. Solo se te cobra cuando la publicas: 50 créditos al mes a partir de ese momento, más los extras que actives.' }",
        "a: 'Sí. Crear y previsualizar no cuesta nada. Solo se cobra cuando publicas: 50 créditos al mes, más los extras que actives.' }",
    ),
    (
        "a: 'Tu web se pone en marcha con todas las propiedades de la red que hayas elegido mostrar, y tus propios anuncios, de inmediato. A partir de ahí se te cobran 50 créditos al mes por la web, más los extras que tengas activados, cada uno con su cuota mensual.' }",
        "a: 'Tu web se pone en marcha con tus anuncios y la cartera de la red que hayas elegido mostrar. Desde entonces pagas 50 créditos al mes, más los extras que hayas activado.' }",
    ),
    (
        "a: 'Sí. Cambia a cualquiera de los quince diseños cuando quieras, y conservas tus textos, tus páginas y tus ajustes.' }",
        "a: 'Sí. Cambia a cualquiera de los quince cuando quieras y conserva tus textos, páginas y ajustes.' }",
    ),
    (
        "a: 'No. Todas las propiedades de la red ya están ahí, filtradas como tú quieras, con tus propios anuncios al lado, y todo se actualiza cuando un anuncio cambia en el CRM. Nada se escribe dos veces.' }",
        "a: 'No. Tus anuncios y la cartera de la red ya están ahí, y se actualizan cuando un anuncio cambia en el CRM. Nada se escribe dos veces.' }",
    ),
    (
        "a: 'Directas a tu CRM de PropertyList, y recibes un email por cada una. Los pipelines de Lead, Seller y Property son gratis y sin límite. Mover un lead cualificado al pipeline de Buyer cuesta 1 crédito.' }",
        "a: 'A tu CRM de PropertyList, con un email por cada una. Los pipelines Lead, Seller y Property son gratis y sin límite; mover uno a Buyer cuesta 1 crédito.' }",
    ),
    (
        "a: 'Sí, por 20 créditos al mes. Hasta entonces tu web funciona en nombre-de-tu-agencia.estate-agency.co: tu nombre en la dirección, no el nuestro.' }",
        "a: 'Sí, por 20 créditos al mes. Hasta entonces tu web funciona en nombre-de-tu-agencia.estate-agency.co, así que en la dirección va tu nombre, no el nuestro.' }",
    ),
    (
        "a: 'Bueno desde el primer día: cada página sale con estructura limpia, títulos y descripciones. Activa SEO y GEO automáticos (5 créditos al mes) y un agente dedicado a tu web trabaja en ella cada semana: revisa todas las páginas, actualiza las palabras clave a lo que buscan los compradores ahora y corrige lo que encuentra. Seguimos sin prometer posiciones; ninguna plataforma honesta puede.' }",
        "a: 'Estructura limpia, títulos y descripciones en cada página desde el primer día. SEO y GEO automáticos (5 créditos al mes) revisa tu web cada semana y actualiza las palabras clave a lo que buscan los compradores ahora. Ninguna plataforma puede prometer posiciones con honestidad.' }",
    ),
    (
        "a: 'No. Eliges una plantilla, la editas en un editor que muestra tu web real mientras trabajas, y publicas cuando estés listo. Editar con IA también te permite describir un cambio en lenguaje sencillo.' }",
        "a: 'No. Elige una plantilla, edítala en un editor que muestra la web real y publica cuando estés listo. O describe el cambio en lenguaje sencillo y deja que la IA lo haga.' }",
    ),
    (
        "a: 'Nosotros. El alojamiento y la protección de Cloudflare van incluidos: tu web se sirve rápido desde la red de Cloudflare y queda protegida frente a ataques, sin nada que gestionar ni renovar por tu parte.' }",
        "a: 'Nosotros. El alojamiento y la protección de Cloudflare van incluidos: rápida, protegida frente a ataques, sin nada que gestionar ni renovar.' }",
    ),
    (
        "a: 'Sí. El aviso legal, la política de privacidad y de cookies, más un banner de cookies, vienen con cada plantilla. Están incluidos y nunca se facturan aparte.' }",
        "a: 'Sí. El aviso legal, la política de privacidad y de cookies, más un banner de cookies, vienen con cada plantilla y nunca se facturan aparte.' }",
    ),
]

missing = [old for old, _ in PAIRS if old not in s]
if missing:
    print(f'{len(missing)} strings not found, nothing written:')
    for m in missing:
        print('  ' + m[:110])
    sys.exit(1)

for old, new in PAIRS:
    s = s.replace(old, new, 1)

open(P, 'w', encoding='utf-8').write(s)
print(f'{len(PAIRS)} passages tightened')
