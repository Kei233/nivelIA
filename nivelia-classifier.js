/* ==========================================================================
   NivelIA — Clasificador de URLs (prototipo)
   --------------------------------------------------------------------------
   Reglas, en este orden de prioridad:
     1. Red social            -> "Sin verificar"          (nivel 0)
     2. Sitio oficial         -> "Verificado"             (nivel 4)
     3. Prensa                -> "Razonablemente sólida"  (nivel 2)
     4. Cualquier otro dominio-> sin clasificar (levelIndex = null)

   Además de clasificar, assess() genera el "Desglose de pistas", buildCitation()
   arma citas APA 7 / IEEE y getLoadingSteps() produce los mensajes de verificación.

   Para ampliar la "base de datos", agrega dominios a los arrays de abajo
   (sin https:// ni www.). Cada dominio cubre también todos sus subdominios:
   "bbc.com" cubre "www.bbc.com" y "news.bbc.com".
   ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------- BASE DE DATOS (arrays) ------------------------- */

  // 1) Redes sociales y plataformas de contenido generado por usuarios
  const SOCIAL_DOMAINS = [
    'facebook.com', 'fb.com', 'fb.watch', 'instagram.com', 'threads.net',
    'x.com', 'twitter.com', 't.co',
    'tiktok.com', 'youtube.com', 'youtu.be', 'snapchat.com', 'pinterest.com',
    'reddit.com', 'linkedin.com', 'tumblr.com', 'quora.com',
    'telegram.org', 't.me', 'whatsapp.com', 'wa.me', 'discord.com', 'discord.gg',
    'twitch.tv', 'bsky.app', 'mastodon.social', 'vk.com', 'weibo.com',
    'kwai.com', 'truthsocial.com', 'gab.com', 'parler.com'
  ];

  // 2) Prensa y medios de comunicación
  const PRESS_DOMAINS = [
    // Internacional (inglés)
    'nytimes.com', 'washingtonpost.com', 'wsj.com', 'usatoday.com', 'npr.org',
    'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'cnn.com', 'time.com',
    'bbc.com', 'bbc.co.uk', 'theguardian.com', 'ft.com', 'economist.com',
    'bloomberg.com', 'reuters.com', 'apnews.com', 'aljazeera.com',
    'forbes.com', 'theatlantic.com', 'newyorker.com',
    // Internacional (otros idiomas)
    'afp.com', 'efe.com', 'dw.com', 'france24.com', 'lemonde.fr',
    'elpais.com', 'elmundo.es', 'abc.es', 'lavanguardia.com',
    // Colombia
    'rcnradio.com', 'noticiasrcn.com', 'caracoltv.com', 'caracol.com.co',
    'eltiempo.com', 'elespectador.com', 'semana.com', 'portafolio.co',
    'larepublica.co', 'elcolombiano.com', 'elheraldo.co', 'elpais.com.co',
    'lasillavacia.com', 'noticias.canal1.com.co', 'citytv.com.co',
    'vanguardia.com', 'eluniversal.com.co', 'pulzo.com',
    // Latinoamérica
    'infobae.com', 'clarin.com', 'lanacion.com.ar', 'eluniversal.com.mx',
    'milenio.com', 'folha.uol.com.br', 'elcomercio.pe', 'emol.com',
    'latercera.com', 'elnuevoherald.com'
  ];

  // 3) Organismos oficiales: internacionales y nacionales
  const OFFICIAL_DOMAINS = [
    // Internacionales
    'who.int', 'paho.org', 'un.org', 'unesco.org', 'unicef.org', 'undp.org',
    'unhcr.org', 'fao.org', 'ilo.org', 'iaea.org', 'itu.int', 'wmo.int',
    'worldbank.org', 'imf.org', 'wto.org', 'oecd.org', 'oas.org', 'iadb.org',
    'cepal.org', 'europa.eu', 'esa.int', 'cern.ch', 'icj-cij.org',
    // Estados Unidos
    'nasa.gov', 'noaa.gov', 'nih.gov', 'cdc.gov', 'fda.gov', 'usa.gov',
    'whitehouse.gov', 'usgs.gov', 'census.gov',
    // Colombia
    'presidencia.gov.co', 'minsalud.gov.co', 'mineducacion.gov.co',
    'dane.gov.co', 'banrep.gov.co', 'ideam.gov.co', 'ins.gov.co',
    'antioquia.gov.co', 'medellin.gov.co', 'registraduria.gov.co',
    // Otros países
    'gov.uk', 'gob.mx', 'gob.es', 'gob.ar', 'gob.cl', 'gob.pe', 'gouv.fr'
  ];

  // Patrones de sufijo reservados a gobiernos o a organismos intergubernamentales
  // (cubren países no listados arriba). Ej: salud.gob.mx, www.dian.gov.co, itu.int
  const OFFICIAL_SUFFIX_PATTERNS = [
    /(^|\.)(gov|gob|gouv|mil)(\.[a-z]{2})?$/,   // .gov, .gov.co, .gob.mx, .gouv.fr, .mil
    /\.int$/                                      // .int: solo organizaciones internacionales
  ];

  /* ---------------------------- NIVELES (escala) ---------------------------- */

  const LEVELS = [
    'Sin verificar', 'Indicios iniciales', 'Razonablemente sólida',
    'Alta coincidencia', 'Verificado'
  ];

  const RULES = {
    social:   { levelIndex: 0, reason: 'Es una red social: cualquier persona puede publicar sin verificación editorial, por eso se trata como información sin verificar.' },
    press:    { levelIndex: 2, reason: 'Proviene de un medio de prensa con proceso editorial, por eso se considera razonablemente sólida. Contrástala con otras fuentes.' },
    official: { levelIndex: 4, reason: 'Es el sitio de un organismo oficial (nacional o internacional), por eso se considera verificada.' }
  };

  /* ------------------------------- UTILIDADES ------------------------------- */

  // Devuelve el dominio normalizado (minúsculas, sin "www." ni punto final) o null.
  function parseHost(input) {
    if (typeof input !== 'string') return null;
    let raw = input.trim();
    if (!raw || /\s/.test(raw)) return null;
    const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    if (!explicit) raw = 'https://' + raw;
    let url;
    try { url = new URL(raw); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // new URL ya ignora trucos como "https://nasa.gov@sitio-falso.com" (el host real es el de después de @)
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    // Debe tener al menos un punto y una terminación alfabética (descarta "hola" o "2027.5")
    if (!/\.[a-z]{2,}$/.test(host) && !/\.xn--[a-z0-9-]+$/.test(host)) return null;
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch (e) {}
    return { host: host, href: url.href, pathname: path, typedProtocol: explicit ? url.protocol : null };
  }

  // ¿El host es el dominio listado o uno de sus subdominios?
  // Se compara por final de cadena con punto, así "nasa.gov.falso.com" y "fakenasa.gov" NO coinciden.
  function matchesList(host, list) {
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (host === d || host.endsWith('.' + d)) return d;
    }
    return null;
  }

  function matchesOfficialSuffix(host) {
    return OFFICIAL_SUFFIX_PATTERNS.some(function (re) { return re.test(host); });
  }

  /* ----------------------------- API PRINCIPAL ------------------------------ */

  /**
   * Clasifica una URL.
   * @param {string} input  URL con o sin "https://" (ej: "www.bbc.com/mundo/...")
   * @returns {{
   *   valid: boolean, url: string|null, host: string|null,
   *   category: 'social'|'press'|'official'|'unknown'|'invalid',
   *   levelIndex: number|null, levelName: string|null,
   *   matched: string|null, reason: string
   * }}
   */
  function classifyUrl(input) {
    const parsed = parseHost(input);
    if (!parsed) {
      return { valid: false, url: null, host: null, category: 'invalid', levelIndex: null,
               levelName: null, matched: null, reason: 'No parece una URL válida.' };
    }
    const host = parsed.host;
    let category = 'unknown', matched = null;

    // Orden de prioridad: social > oficial > prensa
    if ((matched = matchesList(host, SOCIAL_DOMAINS))) category = 'social';
    else if ((matched = matchesList(host, OFFICIAL_DOMAINS))) category = 'official';
    else if (matchesOfficialSuffix(host)) { category = 'official'; matched = 'sufijo oficial'; }
    else if ((matched = matchesList(host, PRESS_DOMAINS))) category = 'press';

    if (category === 'unknown') {
      return { valid: true, url: parsed.href, host: host, category: category, levelIndex: null,
               levelName: null, matched: null,
               reason: 'El dominio ' + host + ' todavía no está en la base de datos del prototipo.' };
    }
    const rule = RULES[category];
    return { valid: true, url: parsed.href, host: host, category: category,
             levelIndex: rule.levelIndex, levelName: LEVELS[rule.levelIndex],
             matched: matched, reason: rule.reason };
  }

  /**
   * Busca una URL dentro de un texto libre y la clasifica.
   * Útil cuando el usuario pega un titular que incluye un enlace.
   * Devuelve null si no encuentra ninguna URL.
   */
  function classifyInput(text) {
    if (typeof text !== 'string') return null;
    const t = text.trim();
    if (!t) return null;
    // Caso 1: el texto completo es una URL (con o sin protocolo)
    const whole = classifyUrl(t);
    if (whole.valid) return whole;
    // Caso 2: hay una URL explícita (http/https o www.) dentro del texto
    const m = t.match(/(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/i);
    if (m) return classifyUrl(m[0].replace(/[).,;:!?]+$/, ''));
    return null;
  }

  /* ====================== PISTAS, CITAS Y MENSAJES DE CARGA ====================== */

  const LEVEL_DETAILS = [
    'no se encontraron indicios claros que la respalden.',
    'una sola referencia la menciona, sin forma de contrastarla aún.',
    'hay coincidencia parcial entre un par de fuentes.',
    'varias fuentes independientes coinciden en lo esencial.',
    'la evidencia es reciente, sólida y consistente.'
  ];

  // Terminaciones baratas y muy usadas por sitios desechables
  const SUSPICIOUS_TLDS = ['xyz','top','click','buzz','loan','work','gq','ml','tk','cf','ga','icu','monster',
    'cyou','sbs','rest','bid','win','stream','download','review','date','party','trade','cam','zip','mov','quest','lol','fun'];

  const SHORTENERS = ['bit.ly','tinyurl.com','goo.gl','ow.ly','is.gd','cutt.ly','rb.gy','shorturl.at','buff.ly','tiny.cc','lnkd.in','s.id'];

  // Lenguaje sensacionalista (se compara sin tildes y por prefijo: "impactante" cubre "impactantes")
  const SENSATIONAL_TERMS = ['impactante','increible','urgente','escandalo','escandaloso','shock','milagro','milagroso',
    'secreto','revelan','revelado','bomba','bombazo','viral','exclusivo','conmocion','terrorifico','aterrador','explosivo',
    'brutal','insolito','indignante','alarmante','censurado','prohibido','no vas a creer','lo que no quieren que sepas',
    'antes de que lo borren','nadie te cuenta','te dejara sin palabras','miracle','shocking','unbelievable','exposed',
    'bombshell','you wont believe','la verdad que ocultan'];

  // Marcas que NO se usan para detectar imitaciones (palabras comunes o muy genéricas)
  const BRAND_EXCLUDE = ['time','semana','portafolio','abc','who','un','dw','gov','gob','gouv','mil','europa','usa','ins','espanol'];

  // Nombre legible del medio u organismo (para las citas)
  const SITE_NAMES = {
    'nytimes.com':'The New York Times','washingtonpost.com':'The Washington Post','wsj.com':'The Wall Street Journal',
    'usatoday.com':'USA Today','npr.org':'NPR','nbcnews.com':'NBC News','cbsnews.com':'CBS News','cnn.com':'CNN',
    'bbc.com':'BBC','bbc.co.uk':'BBC','theguardian.com':'The Guardian','ft.com':'Financial Times',
    'economist.com':'The Economist','bloomberg.com':'Bloomberg','reuters.com':'Reuters','apnews.com':'Associated Press',
    'aljazeera.com':'Al Jazeera','dw.com':'DW','france24.com':'France 24','efe.com':'Agencia EFE','afp.com':'AFP',
    'elpais.com':'El País','elmundo.es':'El Mundo','lavanguardia.com':'La Vanguardia','lemonde.fr':'Le Monde',
    'rcnradio.com':'RCN Radio','noticiasrcn.com':'Noticias RCN','caracoltv.com':'Caracol Televisión','caracol.com.co':'Caracol Radio',
    'eltiempo.com':'El Tiempo','elespectador.com':'El Espectador','semana.com':'Semana','portafolio.co':'Portafolio',
    'larepublica.co':'La República','elcolombiano.com':'El Colombiano','elheraldo.co':'El Heraldo','elpais.com.co':'El País Cali',
    'lasillavacia.com':'La Silla Vacía','infobae.com':'Infobae','clarin.com':'Clarín','lanacion.com.ar':'La Nación',
    'eluniversal.com.mx':'El Universal','milenio.com':'Milenio',
    'who.int':'Organización Mundial de la Salud','paho.org':'Organización Panamericana de la Salud','un.org':'Naciones Unidas',
    'unesco.org':'UNESCO','unicef.org':'UNICEF','undp.org':'PNUD','fao.org':'FAO','ilo.org':'Organización Internacional del Trabajo',
    'worldbank.org':'Banco Mundial','imf.org':'Fondo Monetario Internacional','wto.org':'Organización Mundial del Comercio',
    'oecd.org':'OCDE','oas.org':'Organización de los Estados Americanos','iadb.org':'Banco Interamericano de Desarrollo',
    'cepal.org':'CEPAL','europa.eu':'Unión Europea','esa.int':'Agencia Espacial Europea','cern.ch':'CERN',
    'nasa.gov':'NASA','noaa.gov':'NOAA','nih.gov':'National Institutes of Health','cdc.gov':'Centers for Disease Control and Prevention',
    'fda.gov':'U.S. Food and Drug Administration','presidencia.gov.co':'Presidencia de la República de Colombia',
    'minsalud.gov.co':'Ministerio de Salud y Protección Social','mineducacion.gov.co':'Ministerio de Educación Nacional',
    'dane.gov.co':'DANE','banrep.gov.co':'Banco de la República','ideam.gov.co':'IDEAM',
    'antioquia.gov.co':'Gobernación de Antioquia','medellin.gov.co':'Alcaldía de Medellín'
  };

  const strip = function (s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); };
  const words = function (s) { return ' ' + strip(s).replace(/[^a-z0-9]+/g, ' ').trim() + ' '; };
  const SENS_RE = SENSATIONAL_TERMS.map(function (t) { return { t: t, re: new RegExp('\\s' + t + '[a-z]*\\s') }; });

  function findSensational(str) {
    const w = words(str), out = [];
    SENS_RE.forEach(function (x) { if (x.re.test(w) && out.indexOf(x.t) < 0) out.push(x.t); });
    return out;
  }
  const quoted = function (arr) { return arr.slice(0, 3).map(function (t) { return '“' + t + '”'; }).join(', '); };

  function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 997;
    return h;
  }

  function levenshtein(a, b) {
    const m = [];
    for (let i = 0; i <= a.length; i++) m[i] = [i];
    for (let j = 0; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    return m[a.length][b.length];
  }

  // Parte "central" del dominio: bbc-noticias-24.xyz -> bbc-noticias-24 ; caracol.com.co -> caracol
  const SECOND_LEVEL = ['com','co','org','net','gov','edu','gob','ac','or','go'];
  function mainLabel(host) {
    const l = host.split('.');
    if (l.length >= 3 && l[l.length-1].length === 2 && SECOND_LEVEL.indexOf(l[l.length-2]) > -1) l.length -= 2;
    else l.length -= 1;
    return l[l.length - 1] || host;
  }

  function siteNameFor(host) {
    let best = null;
    Object.keys(SITE_NAMES).forEach(function (k) {
      if ((host === k || host.endsWith('.' + k)) && (!best || k.length > best.length)) best = k;
    });
    if (best) return SITE_NAMES[best];
    const lab = mainLabel(host);
    return lab.charAt(0).toUpperCase() + lab.slice(1);
  }

  const BRANDS = (function () {
    const out = [];
    PRESS_DOMAINS.concat(OFFICIAL_DOMAINS).forEach(function (d) {
      const lab = mainLabel(d);
      if (lab.length >= 3 && BRAND_EXCLUDE.indexOf(lab) < 0 && out.every(function (b) { return b.label !== lab; }))
        out.push({ label: lab, domain: d });
    });
    return out;
  })();

  // ¿El dominio se hace pasar por un medio u organismo conocido? Devuelve su nombre o null.
  function detectImitation(host) {
    const padded = '.' + host + '.';
    const all = PRESS_DOMAINS.concat(OFFICIAL_DOMAINS);
    for (let i = 0; i < all.length; i++)                       // bbc.com.noticias-hoy.xyz
      if (padded.indexOf('.' + all[i] + '.') > -1) return siteNameFor(all[i]);
    const label = mainLabel(host), tokens = label.split('-');
    const norm = label.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's');
    for (let i = 0; i < BRANDS.length; i++) {
      const L = BRANDS[i].label;
      if (label === L) continue;
      if (tokens.indexOf(L) > -1 || (L.length >= 6 && label.indexOf(L) > -1) ||
          norm === L || (L.length >= 6 && levenshtein(norm, L) === 1)) return siteNameFor(BRANDS[i].domain);
    }
    return null;
  }

  function parsePathDate(p) {
    let m = p.match(/(?:^|[\/_-])((?:19|20)\d{2})[\/_-](0?[1-9]|1[0-2])[\/_-](0?[1-9]|[12]\d|3[01])(?!\d)/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = p.match(/(?:^|[\/_-])((?:19|20)\d{2})[\/_-](0?[1-9]|1[0-2])(?!\d)/);
    if (m) return { y: +m[1], m: +m[2], d: null };
    m = p.match(/\/((?:19|20)\d{2})(?:\/|$)/);
    if (m) return { y: +m[1], m: null, d: null };
    return null;
  }

  const GENERIC_SEGS = ['es','en','pt','fr','news','noticias','mundo','article','articles','articulo','detail','index','home','amp','story','stories','nota','notas','node','post','posts','content','page','pages'];
  function slugTitle(pathname) {
    const segs = pathname.split('/').filter(Boolean).reverse();
    for (let i = 0; i < segs.length; i++) {
      let s = segs[i].replace(/\.(html?|php|aspx?|shtml)$/i, '').replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/-\d{5,}$/, '');
      const toks = s.split(/[-_+]/).filter(function (t) { return t && !/^\d+$/.test(t); });
      if (!toks.length || (toks.length === 1 && (/\d/.test(toks[0]) || GENERIC_SEGS.indexOf(toks[0].toLowerCase()) > -1))) continue;
      const t = toks.join(' ');
      if (t.replace(/[^a-záéíóúñ]/gi, '').length < 3) continue;
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    return '';
  }

  /* ----------------------------------- Citas ----------------------------------- */

  const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const MONTHS_EN = ['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sep.','Oct.','Nov.','Dec.'];
  const escHtml = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); };
  const dot = function (s) { return /[.!?]$/.test(s) ? s : s + '.'; };

  // Metadatos de la cita, autocompletados a partir de la URL (el usuario puede editarlos)
  function getCitationMeta(href, category) {
    const p = parseHost(href);
    if (!p) return null;
    const site = siteNameFor(p.host), official = category === 'official';
    return { url: p.href, title: slugTitle(p.pathname), author: official ? site : '', siteName: site,
             date: parsePathDate(p.pathname), kind: official ? 'official' : 'press' };
  }

  function formatDateInput(d) {
    if (!d) return '';
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.m ? (d.d ? d.y + '-' + pad(d.m) + '-' + pad(d.d) : d.y + '-' + pad(d.m)) : String(d.y);
  }
  // Acepta AAAA, AAAA-MM o AAAA-MM-DD. Devuelve null si está vacío o es inválido.
  function parseDateInput(str) {
    const m = String(str || '').trim().match(/^((?:19|20)\d{2})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/);
    return m ? { y: +m[1], m: m[2] ? +m[2] : null, d: m[3] ? +m[3] : null } : null;
  }

  /** Devuelve { html, text } de la cita en formato 'apa' (APA 7, español) o 'ieee'. */
  function buildCitation(meta, format) {
    const now = new Date(), d = meta.date, url = meta.url;
    const title = (meta.title || '').trim() || '[Título de la página]';
    const author = (meta.author || '').trim(), site = (meta.siteName || '').trim();
    const sameOrg = author && site && strip(author) === strip(site);
    let segs;

    if (format === 'ieee') {
      const ds = d ? (d.m ? (d.d ? MONTHS_EN[d.m-1] + ' ' + d.d + ', ' + d.y : MONTHS_EN[d.m-1] + ' ' + d.y) : String(d.y)) : '';
      const acc = MONTHS_EN[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
      segs = ['[1] '];
      if (author) segs.push(author + ', ');
      segs.push('“' + title.replace(/,$/, '') + ',” ');
      if (site && !sameOrg) { segs.push(['i', site]); segs.push((ds ? ', ' + ds : '') + '. '); }
      else if (ds) segs.push(ds + '. ');
      segs.push('Accessed: ' + acc + '. [Online]. Available: ' + url);
    } else {
      const ds = d ? (d.m ? (d.d ? d.y + ', ' + d.d + ' de ' + MONTHS_ES[d.m-1] : d.y + ', ' + MONTHS_ES[d.m-1]) : String(d.y)) : 's. f.';
      const retrieved = d ? '' : 'Recuperado el ' + now.getDate() + ' de ' + MONTHS_ES[now.getMonth()] + ' de ' + now.getFullYear() + ', de ';
      const t = dot(title);
      segs = [];
      if (meta.kind === 'official') {                       // Página web: título en cursiva
        if (author) segs.push(dot(author) + ' ');
        segs.push('(' + ds + '). ');
        segs.push(['i', title.replace(/[.]$/, '')]); segs.push(/[?!]$/.test(title) ? ' ' : '. ');
        if (site && !sameOrg) segs.push(dot(site) + ' ');
      } else {                                              // Artículo de prensa: el medio va en cursiva
        if (author) { segs.push(dot(author) + ' '); segs.push('(' + ds + '). '); segs.push(t + ' '); }
        else { segs.push(t + ' '); segs.push('(' + ds + '). '); }
        if (site) { segs.push(['i', site]); segs.push('. '); }
      }
      segs.push(retrieved + url);
    }
    return {
      html: segs.map(function (s) { return typeof s === 'string' ? escHtml(s) : '<em>' + escHtml(s[1]) + '</em>'; }).join(''),
      text: segs.map(function (s) { return typeof s === 'string' ? s : s[1]; }).join('')
    };
  }

  /* ----------------------------- Mensajes de carga ----------------------------- */

  function pick(arr, n) {
    if (n >= arr.length) return arr.slice();
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]);
    return out;
  }

  /** Secuencia de pasos de "consulta" según el tiempo de espera (más espera = más pasos). */
  function getLoadingSteps(input, delayMs) {
    const n = Math.max(3, Math.min(9, Math.round(delayMs / 450)));
    const u = extractUrl(input);
    if (u) {
      const p = parseHost(u), host = p ? p.host : 'el dominio';
      return pick([
        { text: 'Resolviendo dominio ' + host + '…', source: 'DNS y registro de dominios' },
        { text: 'Consultando antigüedad y titularidad del dominio…', source: 'Registro WHOIS' },
        { text: 'Buscando coincidencias en la base de medios y organismos…', source: 'Base de datos de fuentes' },
        { text: 'Cruzando con listas de suplantación y dominios sospechosos…', source: 'Listas de alertas' },
        { text: 'Analizando el titular y el lenguaje del enlace…', source: 'Análisis de contenido' },
        { text: 'Rastreando citas de expertos y enlaces a fuentes primarias…', source: 'Índice de fuentes primarias' },
        { text: 'Contrastando con fuentes independientes…', source: 'Contraste entre fuentes' },
        { text: 'Verificando fecha de publicación y contexto…', source: 'Cronología' },
        { text: 'Calculando nivel de confianza…', source: 'Motor de clasificación' }
      ], n);
    }
    return pick([
      { text: 'Extrayendo las afirmaciones clave del texto…', source: 'Análisis de texto' },
      { text: 'Buscando la afirmación en bases de datos de hechos…', source: 'Base de datos de hechos' },
      { text: 'Analizando tono y lenguaje…', source: 'Análisis de contenido' },
      { text: 'Rastreando fuentes primarias citadas…', source: 'Índice de fuentes primarias' },
      { text: 'Contrastando con fuentes independientes…', source: 'Contraste entre fuentes' },
      { text: 'Verificando fecha y contexto…', source: 'Cronología' },
      { text: 'Calculando nivel de confianza…', source: 'Motor de clasificación' }
    ], n);
  }

  /* ------------------------------ Análisis completo ------------------------------ */

  function extractUrl(text) {
    if (typeof text !== 'string') return null;
    const t = text.trim();
    if (!t) return null;
    if (classifyUrl(t).valid) return t;
    const m = t.match(/(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/i);
    return m ? m[0].replace(/[).,;:!?]+$/, '') : null;
  }

  const SEV_ORDER_TRUST = ['ok', 'info', 'medium', 'high'];
  const SEV_ORDER_DOUBT = ['high', 'medium', 'info', 'ok'];

  /**
   * Análisis completo de lo que pegó el usuario (URL o texto).
   * Devuelve nivel, explicación, desglose de pistas y, si es confiable, los datos para citar.
   */
  function assess(input) {
    const text = (input || '').trim(), year = new Date().getFullYear(), h = hashText(text);
    const clues = [];
    const add = function (id, sev, icon, title, body, tip) { clues.push({ id: id, severity: sev, icon: icon, title: title, text: body, tip: tip }); };
    const urlStr = extractUrl(text);
    const out = { kind: urlStr ? 'url' : 'text', input: text, url: null, host: null, category: 'text', matched: null,
                  levelIndex: 0, levelName: '', estimated: false, reason: '', clues: [], citable: false, citation: null };

    // Señales del lenguaje (sirven para el texto suelto y para lo que acompañe a una URL)
    const lang = function (str, sensId) {
      const sens = findSensational(str);
      if (sens.length) add(sensId, sens.length >= 2 ? 'high' : 'medium', '⚠️', 'Titular amarillista o sensacionalista detectado',
        'Aparecen expresiones como ' + quoted(sens) + ': buscan emoción y clics más que informar.',
        'Los medios serios describen hechos con lenguaje sobrio; desconfía de los adjetivos exagerados.');
      const letters = str.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
      if (letters.length >= 12 && letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length / letters.length > 0.6)
        add('caps', 'medium', '🔊', 'Uso excesivo de MAYÚSCULAS', 'Escribir casi todo en mayúsculas es una táctica para llamar la atención y generar alarma.', 'Una información rigurosa no necesita gritar.');
      if ((str.match(/[!¡]/g) || []).length >= 2)
        add('excl', 'medium', '❗', 'Exclamaciones en exceso', 'Los signos de exclamación repetidos apelan a la emoción, no a la evidencia.', 'Pregúntate: ¿me informa o quiere que reaccione sin pensar?');
      return sens;
    };

    if (urlStr) {
      const cls = classifyUrl(urlStr), p = parseHost(urlStr), host = p.host;
      const tld = host.split('.').pop(), rest = text.replace(urlStr, '');
      const known = cls.levelIndex !== null, reliable = cls.category === 'press' || cls.category === 'official';
      Object.assign(out, { url: p.href, host: host, category: cls.category, matched: cls.matched });

      const sens = lang(p.pathname.replace(/\.[a-z]{2,5}$/i, '') + ' ' + rest, 'sens');
      const tldBad = SUSPICIOUS_TLDS.indexOf(tld) > -1;
      if (tldBad) add('tld', 'high', '🔍', 'Dominio sospechoso (.' + tld + ')', 'Esta terminación es barata y muy usada por sitios desechables que aparentan ser medios.', 'Mira siempre el final del dominio: los medios y organismos oficiales rara vez usan terminaciones como esta.');
      const fake = known ? null : detectImitation(host);
      if (fake) add('imitation', 'high', '🔍', 'Dominio que imita a un medio reconocido', host + ' se parece a “' + fake + '”, pero no es su sitio real.', 'Compara el dominio letra por letra con el del medio original antes de confiar.');
      const isShort = SHORTENERS.some(function (s) { return host === s; });
      if (isShort) add('short', 'medium', '🔗', 'Enlace acortado', 'No se ve a qué sitio lleva en realidad; podría ocultar un dominio sospechoso.', 'Expande el enlace antes de abrirlo o compartirlo.');
      if (p.typedProtocol === 'http:') add('http', 'medium', '🔓', 'Conexión sin cifrar (HTTP)', 'El sitio no usa HTTPS, algo que hoy se espera hasta de los sitios pequeños.', 'Busca el candado en la barra del navegador.');
      const lab = mainLabel(host);
      if (!known && ((lab.match(/-/g) || []).length >= 3 || (lab.match(/\d/g) || []).length >= 3))
        add('stuffing', 'medium', '🧩', 'Dominio con guiones o números en exceso', 'Los nombres con muchos guiones o cifras suelen ser improvisados para parecer un medio real.', 'Los medios serios tienen dominios cortos y fáciles de recordar.');
      if (cls.category === 'social') add('social', 'high', '👥', 'Contenido de red social sin revisión editorial', 'Cualquier persona puede publicar aquí sin que nadie verifique antes los datos.', 'Busca el mismo dato en un medio o en un sitio oficial antes de compartirlo.');
      if (!reliable) add('nosrc', cls.category === 'social' ? 'high' : 'medium', '❌', 'Sin cita directa de expertos ni enlaces a fuentes primarias', 'No encontramos citas de especialistas ni enlaces a estudios, datos o documentos originales.', 'Una noticia sólida dice quién lo afirma y enlaza a su origen.');
      const pd = parsePathDate(p.pathname);
      if (pd && year - pd.y >= 2) add('old', reliable ? 'medium' : 'high', '📅', 'Noticia posiblemente fuera de contexto', 'La URL indica que se publicó en ' + pd.y + ' (hace ' + (year - pd.y) + ' años). Si se presenta como actual, puede estar descontextualizada.', 'Revisa la fecha de publicación antes de usar un dato como si fuera reciente.');
      else if (pd && reliable) add('fresh', 'ok', '📅', 'Fecha reciente', 'La URL indica que se publicó en ' + pd.y + '.', 'Confirma siempre la fecha dentro del artículo.');
      if (cls.category === 'unknown') add('unknown', 'info', '🧭', 'Dominio sin historial en nuestra base de datos', 'No aparece como medio de prensa ni como organismo oficial conocido.', 'Busca la sección “Quiénes somos” y comprueba quién está detrás del sitio.');
      if (cls.category === 'press') add('press', 'ok', '📰', 'Medio de prensa reconocido', host + ' figura en nuestra base de medios, con proceso editorial.', 'Aun así, contrasta con otra fuente: un medio también puede equivocarse.');
      if (cls.category === 'official') add('official', 'ok', '🏛️', 'Sitio oficial de un organismo', host + ' es el dominio de una institución nacional o internacional.', 'Los sitios oficiales son fuentes primarias: ideales para citar datos.');
      if (reliable && p.typedProtocol === 'https:') add('https', 'ok', '🔒', 'Conexión segura (HTTPS)', 'El enlace usa cifrado, lo que protege la conexión con el sitio.', 'El candado no prueba que el contenido sea cierto, pero es un requisito mínimo.');
      if (reliable && !sens.length && slugTitle(p.pathname)) add('sober', 'ok', '✅', 'Titular sobrio, sin lenguaje alarmista', 'El enlace describe el tema sin adjetivos exagerados.', 'Compara cómo titulan otros medios la misma noticia.');

      if (known) { out.levelIndex = cls.levelIndex; out.reason = cls.reason; }
      else {
        out.estimated = true;
        let lv = h % 2;
        const highs = clues.filter(function (c) { return c.severity === 'high'; }).length;
        if (fake || isShort) lv = 0; else if (highs >= 2) lv = 0; else if (highs === 1 || tldBad) lv = Math.min(lv, 1);
        out.levelIndex = lv;
        out.reason = fake
          ? 'Parece una imitación de “' + fake + '”, por eso se trata como información sin verificar.'
          : 'El dominio ' + host + ' no está en la base de datos del prototipo; se muestra una estimación a partir de las señales detectadas: ' + LEVEL_DETAILS[lv];
      }
      if (reliable) { out.citable = true; out.citation = getCitationMeta(p.href, cls.category); }
    } else {
      lang(text, 'sens');
      const w = words(text);
      if (/\s(comparte|difunde|reenvia|pasalo|viralizalo)\s/.test(w) || /antes de que lo borren/.test(w))
        add('urgency', 'high', '📣', 'Presión para compartir de inmediato', 'Pedir que se difunda “ya” busca que lo reenvíes antes de que lo verifiques.', 'Si te piden compartir con urgencia, es motivo para verificar más.');
      if (/segun (los )?(expertos|especialistas|cientificos|medicos|fuentes|estudios)/.test(w) || /dicen que|se dice que|todo el mundo sabe/.test(w))
        add('vague', 'medium', '🕵️', 'Atribución vaga', 'Se habla de “expertos” o “estudios” sin nombrar a nadie ni citar dónde comprobarlo.', 'Una fuente fiable dice quién, cuándo y dónde se publicó.');
      if (/(100 ?%|cura definitiva|garantizado|comprobado cientificamente|jamas|nunca antes)/.test(w) || /100%/.test(text))
        add('absolute', 'medium', '🎯', 'Afirmaciones absolutas', 'Frases como “100 % comprobado” o “cura definitiva” rara vez se sostienen con evidencia.', 'La ciencia habla con matices; las promesas absolutas son una alerta.');
      const oldYear = (text.match(/\b(19|20)\d{2}\b/g) || []).map(Number).filter(function (y) { return y <= year - 2; })[0];
      if (oldYear && /\s(hoy|ahora|actualmente|esta semana|ultima hora|ultimo momento)\s/.test(w))
        add('old', 'high', '📅', 'Posible noticia fuera de contexto', 'El texto menciona ' + oldYear + ' pero se presenta como si fuera actual.', 'Verifica la fecha original antes de darlo por reciente.');
      add('nosrc', 'medium', '❌', 'Sin cita directa de expertos ni enlaces a fuentes primarias', 'El mensaje no incluye ningún enlace ni referencia que permita comprobarlo.', 'Pregunta: ¿quién lo dice y dónde puedo comprobarlo? Pega el enlace original para un análisis más completo.');
      out.estimated = true;
      let lv = h % 3;
      const highs = clues.filter(function (c) { return c.severity === 'high'; }).length;
      const meds = clues.filter(function (c) { return c.severity === 'medium'; }).length;
      if (highs >= 2) lv = 0; else if (highs === 1 || meds >= 3) lv = Math.min(lv, 1);
      out.levelIndex = lv;
      out.reason = 'Es un texto sin enlace, así que se muestra una estimación ilustrativa a partir de su lenguaje y de la falta de fuente: ' + LEVEL_DETAILS[lv];
    }

    out.levelName = LEVELS[out.levelIndex];
    const order = out.levelIndex >= 2 ? SEV_ORDER_TRUST : SEV_ORDER_DOUBT;
    out.clues = clues.map(function (c, i) { return { c: c, i: i }; })
      .sort(function (a, b) { return order.indexOf(a.c.severity) - order.indexOf(b.c.severity) || a.i - b.i; })
      .map(function (x) { return x.c; }).slice(0, 6);
    return out;
  }

  /* -------------------------------- EXPORTS --------------------------------- */

  const api = {
    classifyUrl: classifyUrl,
    classifyInput: classifyInput,
    assess: assess,
    getLoadingSteps: getLoadingSteps,
    getCitationMeta: getCitationMeta,
    buildCitation: buildCitation,
    formatDateInput: formatDateInput,
    parseDateInput: parseDateInput,
    LEVELS: LEVELS,
    DB: { SOCIAL_DOMAINS: SOCIAL_DOMAINS, PRESS_DOMAINS: PRESS_DOMAINS, OFFICIAL_DOMAINS: OFFICIAL_DOMAINS }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NivelIAClassifier = api;
})(typeof window !== 'undefined' ? window : globalThis);
