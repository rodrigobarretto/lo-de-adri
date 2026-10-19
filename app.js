// =====================================================================
//  PUESTO DE DIARIOS — app.js
//  Gestión de stock simple para el puesto + catálogo público por WhatsApp
// =====================================================================

// ---------- CONFIGURACIÓN (lo único que hay que tocar) ----------
// Supabase → Project Settings → API
const SUPABASE_URL = 'https://bwraqfodqrformwxuooo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xazA_cdy-DxfcoYng9ObYQ_X3qZF_Jy'; // SOLO la publishable. NUNCA la secret.
// Nombre y WhatsApp del puesto: se editan desde la app (pantalla Ajustes).
// Estos valores solo se usan si todavía no se guardó nada.
const NOMBRE_POR_DEFECTO = 'Lo de Adri';
const WHATSAPP_POR_DEFECTO = '5491126467210';   // Adonde llegan los pedidos de clientes (sin + ni espacios)
const NUMERO_SOPORTE = '5491126467210';    // Tu número, para el botón "Necesito ayuda"
const DIAS_NOVEDAD = 7;                    // Días que algo figura como "Nuevo"
const BUCKET = 'fotos-stock';
const VERSION_APP = '13';                // subir junto con VERSION de sw.js
// ---------------------------------------------------------------

const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const MODO_CATALOGO = new URLSearchParams(location.search).has('catalogo');
const LINK_CATALOGO = location.origin + location.pathname.replace(/index\.html$/, '') + '?catalogo';

const CATEGORIAS_PLURAL = {
  Diarios: '🗞️ Diarios',
  Revistas: '📰 Revistas',
  Colecciones: '📚 Colecciones',
  Libros: '📕 Libros',
  Figuritas: '🎴 Figuritas',
  Otros: '📦 Otros'
};

const CATEGORIAS = {
  Diarios: '🗞️ Diario',
  Revistas: '📰 Revista',
  Colecciones: '📚 Colección',
  Libros: '📕 Libro',
  Figuritas: '🎴 Figuritas',
  Otros: '📦 Otro'
};

const estado = {
  productos: [],
  filtro: 'todo',
  categoria: 'Revistas',
  tipo: 'nuevo',
  fotoArchivo: null,
  fotoPreviewUrl: null,
  modo: 'suelto',          // 'suelto' o 'serie'
  serieElegida: null,      // id de la colección, 'nueva' o null
  series: [],
  pantalla: null,
  nombre: leerAjusteLocal('nombre') || NOMBRE_POR_DEFECTO,
  whatsapp: leerAjusteLocal('whatsapp') || WHATSAPP_POR_DEFECTO,
  redes: {},
  diasSinRepetir: Number(leerAjusteLocal('dias_sin_repetir')) || 4,  // stock: no repetir antes de N días
  reservas: [],
  titulosExtra: [],      // títulos que se fueron agregando (tabla "titulos")
  editorial: '',         // editorial del título elegido en las sugerencias
  motivos: [],
  movimientos: [],
  tabReservas: 'activa',
  filtroMov: 'todo'
};

function leerAjusteLocal(clave) {
  try { return localStorage.getItem('ajuste_' + clave); } catch (e) { return null; }
}

function guardarAjusteLocal(clave, valor) {
  try { localStorage.setItem('ajuste_' + clave, valor); } catch (e) {}
}

// =====================================================================
//  UTILIDADES
// =====================================================================

function $(id) { return document.getElementById(id); }

function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plata(numero) {
  const n = Number(numero) || 0;
  return '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function soloNumeros(texto) {
  // Acepta "1.500", "1500", "1500,50"
  const limpio = String(texto).trim().replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  return parseFloat(limpio);
}

function diasDesde(fechaIso) {
  if (!fechaIso) return 999;
  return Math.floor((Date.now() - new Date(fechaIso).getTime()) / 86400000);
}

// "nuevo" solo vale durante DIAS_NOVEDAD; después pasa solo al archivo
function esNovedad(p) {
  return p.tipo === 'nuevo' && diasDesde(p.created_at) < DIAS_NOVEDAD;
}

function diasQueQuedan(p) {
  return Math.max(0, DIAS_NOVEDAD - diasDesde(p.created_at));
}

let avisoTimer;
function avisar(texto, tipo = 'ok', ms = 2800) {
  const el = $('aviso');
  el.textContent = texto;
  el.className = tipo;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.className = tipo + ' escondido'; }, ms);
}

function mostrarCargando(texto) {
  $('cargandoTexto').textContent = texto || 'Un momento…';
  $('cargando').classList.remove('oculto');
}

function ocultarCargando() {
  $('cargando').classList.add('oculto');
}

// Traduce errores técnicos a algo que se entienda
function mensajeError(error) {
  const m = (error && (error.message || error.error_description || String(error))) || '';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No hay internet. Probá de nuevo en un rato.';
  if (/row-level security|permission|not authorized|JWT|401|403/i.test(m)) return 'Este teléfono no tiene permiso. Llamá a Rodrigo.';
  if (/Payload too large|exceeded/i.test(m)) return 'La foto es muy pesada. Probá con otra.';
  if (/FALTA_CLAVE_BUSQUEDA/.test(m)) return 'Falta activar la búsqueda en internet. Llamá a Rodrigo.';
  if (/NO_ES_IMAGEN|NO_SE_PUDO_DESCARGAR|MUY_PESADA|URL_INVALIDA/.test(m)) return 'No se pudo traer esa foto. Probá con otra.';
  if (/NO_ALCANZA/.test(m)) return 'No hay tantos disponibles (puede haber reservados).';
  if (/TELEFONO_INVALIDO/.test(m)) return 'El teléfono no parece válido. Poné código de área y número.';
  if (/FALTA_NOMBRE/.test(m)) return 'Falta el nombre.';
  if (/DEMASIADAS_RESERVAS/.test(m)) return 'Ya hay varias reservas con ese teléfono hoy. Escribinos por WhatsApp.';
  if (/CANTIDAD_INVALIDA/.test(m)) return 'La cantidad no es válida.';
  if (/NO_EXISTE/.test(m)) return 'Eso ya no existe. Actualizá la pantalla.';
  if (/duplicate key|23505/i.test(m)) return 'Ya existe uno igual.';
  if (/does not exist|Could not find the function|schema cache/i.test(m)) return 'Falta activar esta parte en la base. Llamá a Rodrigo.';
  return 'Algo salió mal. Llamá a Rodrigo.';
}

function abrirWhatsApp(numero, texto) {
  const url = 'https://wa.me/' + (numero || '') + '?text=' + encodeURIComponent(texto);
  window.open(url, '_blank');
}

// =====================================================================
//  MODO NOCHE (lo elige cada uno en su teléfono: dueño o cliente)
// =====================================================================

function temaGuardado() {
  try { return localStorage.getItem('tema') || 'auto'; } catch (e) { return 'auto'; }
}

function temaActualEsOscuro() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function aplicarTema(tema) {
  if (tema === 'dark' || tema === 'light') document.documentElement.setAttribute('data-theme', tema);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('tema', tema); } catch (e) {}
  const oscuro = temaActualEsOscuro();
  $('btnTema').textContent = oscuro ? '☀️' : '🌙';
  $('btnTema').setAttribute('aria-label', oscuro ? 'Cambiar a modo día' : 'Cambiar a modo noche');
  document.querySelectorAll('#elegirTema button').forEach(b => b.classList.toggle('activo', b.dataset.tema === tema));
}

// Botón del encabezado: alterna día / noche
function alternarTema() {
  aplicarTema(temaActualEsOscuro() ? 'light' : 'dark');
}

// Ajustes: automático / día / noche
function elegirTema(tema) {
  aplicarTema(tema);
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (temaGuardado() === 'auto') aplicarTema('auto');
  });
}

// =====================================================================
//  NAVEGACIÓN
// =====================================================================

const TITULOS = {
  cargar: '📷 Cargar revista',
  stock: '📋 Lo que tengo',
  ajustes: '⚙️ Ajustes',
  rafagas: '📣 Ráfagas',
  rafaga: '✏️ Ráfaga',
  compartir: '📣 Ráfaga lista',
  reservas: '📌 Reservas',
  movimientos: '📒 Ventas y bajas',
  motivos: '🏷️ Motivos de baja',
  redes: '📱 Redes del puesto'
};

// Pantalla "madre" de cada una: adonde lleva el botón Volver
const PADRE = {
  cargar: 'inicio', stock: 'inicio', ajustes: 'inicio', compartir: 'inicio',
  rafagas: 'ajustes', rafaga: 'rafagas',
  reservas: 'inicio', movimientos: 'ajustes', motivos: 'ajustes', redes: 'ajustes'
};

function volver() {
  if (history.state && history.state.pantalla) history.back();
  else irA(PADRE[estado.pantalla] || 'inicio', false);
}

function tituloDe(pantalla) {
  return TITULOS[pantalla] || estado.nombre;
}

// Pone el nombre del puesto en todos lados
function aplicarNombre() {
  document.title = estado.nombre;
  if (estado.pantalla) $('tituloPantalla').textContent = tituloDe(estado.pantalla);
  $('catPie').textContent = estado.nombre;
}

// Trae nombre y WhatsApp guardados en la base (si falla, usa los últimos conocidos)
async function cargarAjustes() {
  try {
    const { data, error } = await db.from('ajustes').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return;
    if (data.nombre) { estado.nombre = data.nombre; guardarAjusteLocal('nombre', data.nombre); }
    if (data.whatsapp) { estado.whatsapp = data.whatsapp; guardarAjusteLocal('whatsapp', data.whatsapp); }
    if (data.redes) { estado.redes = data.redes; dibujarRedesCatalogo(); }
    if (data.dias_sin_repetir) { estado.diasSinRepetir = Number(data.dias_sin_repetir); guardarAjusteLocal('dias_sin_repetir', data.dias_sin_repetir); }
    aplicarNombre();
  } catch (e) {
    console.warn('No se pudieron leer los ajustes', e);
  }
}

function irA(pantalla, agregarHistorial = true) {
  if (seleccion.activa && pantalla !== 'stock') salirSeleccion();
  document.querySelectorAll('main > section').forEach(s => s.classList.add('oculto'));
  $('pantalla-' + pantalla).classList.remove('oculto');
  $('tituloPantalla').textContent = tituloDe(pantalla);
  $('logoCab').classList.toggle('oculto', !!TITULOS[pantalla]);
  const conVolver = !!PADRE[pantalla];
  $('btnVolver').classList.toggle('oculto', !conVolver);
  estado.pantalla = pantalla;
  window.scrollTo(0, 0);

  // El botón "atrás" del celular vuelve al inicio en vez de cerrar la app
  if (agregarHistorial && conVolver) {
    history.pushState({ pantalla }, '');
  }

  if (pantalla === 'stock') cargarStock();
  if (pantalla === 'cargar') prepararCarga();
  if (pantalla === 'inicio') actualizarResumen();
  if (pantalla === 'ajustes') llenarAjustes();
  if (pantalla === 'rafagas') cargarRafagas();
  if (pantalla === 'reservas') cargarReservas();
  if (pantalla === 'movimientos') cargarMovimientos();
  if (pantalla === 'motivos') cargarMotivos();
  if (pantalla === 'redes') dibujarRedes();
}

let ignorarProximoAtras = false;   // cuando la app misma retrocede para cerrar una hoja

window.addEventListener('popstate', () => {
  if (ignorarProximoAtras) { ignorarProximoAtras = false; return; }
  if (!$('hoja').classList.contains('oculto')) {
    cerrarHoja(false);
    return;
  }
  if (PADRE[estado.pantalla]) irA(PADRE[estado.pantalla], false);
  else if (estado.pantalla === 'catalogo' && filtroCliente.serie) cerrarSerie(false);
});

function saludar() {
  const h = new Date().getHours();
  const s = h < 13 ? '¡Buen día!' : h < 20 ? '¡Buenas tardes!' : '¡Buenas noches!';
  $('saludo').textContent = s + ' ¿Qué querés hacer?';
}

// =====================================================================
//  INGRESO (Rodrigo activa el teléfono una sola vez)
// =====================================================================

async function ingresar() {
  const email = $('loginEmail').value.trim();
  const clave = $('loginClave').value;
  if (!email || !clave) { avisar('Completá correo y contraseña', 'mal'); return; }

  mostrarCargando('Entrando…');
  const { error } = await db.auth.signInWithPassword({ email, password: clave });
  ocultarCargando();

  if (error) { avisar('Correo o contraseña incorrectos', 'mal'); return; }
  $('loginClave').value = '';
  avisar('✅ Teléfono activado');
  arrancarAdmin();
}

// =====================================================================
//  CARGAR PRODUCTO
// =====================================================================

function elegirCategoria(boton) {
  document.querySelectorAll('#elegirCategoria button').forEach(b => b.classList.remove('activo'));
  boton.classList.add('activo');
  estado.categoria = boton.dataset.valor;
}

function elegirTipo(boton) {
  document.querySelectorAll('#elegirTipo button').forEach(b => b.classList.remove('activo'));
  boton.classList.add('activo');
  estado.tipo = boton.dataset.valor;
}

function elegirModo(boton) {
  document.querySelectorAll('#elegirModo button').forEach(b => b.classList.remove('activo'));
  boton.classList.add('activo');
  estado.modo = boton.dataset.valor;
  actualizarFormularioModo();
}

function actualizarFormularioModo() {
  const enSerie = estado.modo === 'serie';
  $('bloqueSuelto').classList.toggle('oculto', enSerie);
  $('bloqueSerie').classList.toggle('oculto', !enSerie);
  // Si elige una colección que ya existe, el tipo (diario/revista…) ya se sabe
  const serieExistente = enSerie && estado.serieElegida && estado.serieElegida !== 'nueva';
  $('tarjetaCategoria').classList.toggle('oculto', !!serieExistente);
  $('numPasoTipo').textContent = serieExistente ? '5' : '6';
  if (enSerie) dibujarListaSeries();
  mostrarTituloFinal();
}

function dibujarListaSeries() {
  const botones = estado.series.map(serie => {
    const portada = portadaDeSerie(serie);
    const cant = numerosDeSerie(serie.id).length;
    const activo = Number(estado.serieElegida) === Number(serie.id) ? 'activo' : '';
    return `
      <button class="serie-opcion ${activo}" onclick="elegirSerie(${Number(serie.id)})">
        ${portada ? `<img src="${escapar(portada)}" alt="">` : '<span class="sin-foto">📚</span>'}
        <span>${escapar(serie.nombre)}<span class="cant">${cant} número${cant === 1 ? '' : 's'} cargado${cant === 1 ? '' : 's'}</span></span>
      </button>`;
  }).join('');
  const nueva = `<button class="serie-opcion nueva ${estado.serieElegida === 'nueva' ? 'activo' : ''}" onclick="elegirSerie('nueva')">➕ Es una colección nueva</button>`;
  $('listaSeries').innerHTML = botones + nueva;
  $('bloqueSerieNueva').classList.toggle('oculto', estado.serieElegida !== 'nueva');
}

function elegirSerie(id) {
  estado.serieElegida = id;
  actualizarFormularioModo();
  setTimeout(() => (id === 'nueva' ? $('nombreSerieNueva') : $('nuevoNumero')).focus(), 150);
}

async function prepararCarga() {
  traerTitulosExtra();
  try {
    await traerProductos();
    if (estado.serieElegida && estado.serieElegida !== 'nueva' && !serieDe(estado.serieElegida)) estado.serieElegida = null;
  } catch (e) { /* sin conexión: se verá al guardar */ }
  actualizarFormularioModo();
}

function elegirFoto(input) {
  const archivo = input.files && input.files[0];
  input.value = '';
  if (!archivo) return;

  estado.fotoArchivo = archivo;
  if (estado.fotoPreviewUrl) URL.revokeObjectURL(estado.fotoPreviewUrl);
  estado.fotoPreviewUrl = URL.createObjectURL(archivo);
  $('fotoCaja').innerHTML = '<img src="' + estado.fotoPreviewUrl + '" alt="Foto elegida">';

  // Pasa directo al siguiente paso
  setTimeout(() => {
    if (estado.modo === 'suelto') $('nuevoTitulo').focus();
    else if (estado.serieElegida) $('nuevoNumero').focus();
  }, 300);
}

// Achica la foto antes de subirla (de ~4 MB a ~150 KB)
function comprimirFoto(archivo, ladoMax = 1100, calidad = 0.78) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);
    img.onload = () => {
      let { width, height } = img;
      const escala = Math.min(1, ladoMax / Math.max(width, height));
      width = Math.round(width * escala);
      height = Math.round(height * escala);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob || archivo), 'image/jpeg', calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(archivo); };
    img.src = url;
  });
}

async function subirFoto(archivo) {
  const blob = await comprimirFoto(archivo);
  const nombre = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg';
  const { error } = await db.storage.from(BUCKET).upload(nombre, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000'
  });
  if (error) throw error;
  return db.storage.from(BUCKET).getPublicUrl(nombre).data.publicUrl;
}

function rutaDeFoto(url) {
  if (!url) return null;
  const marca = '/' + BUCKET + '/';
  const i = url.indexOf(marca);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marca.length).split('?')[0]);
}

function limpiarFormulario() {
  $('nuevoTitulo').value = '';
  $('nuevoNumero').value = '';
  $('nuevaCantidad').textContent = '1';
  $('nombreSerieNueva').value = '';
  $('nuevaDescripcion').value = '';
  $('nuevoDetalle').value = '';
  if ($('vistaTitulo')) $('vistaTitulo').textContent = '';
  estado.editorial = '';
  // En una colección deja el precio puesto: casi siempre el siguiente número cuesta lo mismo
  if (estado.modo !== 'serie') $('nuevoPrecio').value = '';
  estado.fotoArchivo = null;
  if (estado.fotoPreviewUrl) URL.revokeObjectURL(estado.fotoPreviewUrl);
  estado.fotoPreviewUrl = null;
  $('fotoCaja').innerHTML = '<span class="grande">📷</span><span>Tocá acá para sacar la foto</span>';
}

async function guardarProducto() {
  const precio = soloNumeros($('nuevoPrecio').value);
  const enSerie = estado.modo === 'serie';
  let titulo = $('nuevoTitulo').value.trim();
  const numero = $('nuevoNumero').value.trim();
  const nombreNueva = $('nombreSerieNueva').value.trim();
  const detalle = $('nuevoDetalle').value.trim().slice(0, 60);

  if (enSerie) {
    if (!estado.serieElegida) { avisar('Elegí de qué colección es (paso 2)', 'mal'); return; }
    if (estado.serieElegida === 'nueva' && !nombreNueva) { avisar('Falta el nombre de la colección', 'mal'); $('nombreSerieNueva').focus(); return; }
  } else if (!titulo) {
    avisar('Falta escribir qué es (paso 2)', 'mal'); $('nuevoTitulo').focus(); return;
  }
  if (!precio || precio <= 0) { avisar('Falta el precio (paso 3)', 'mal'); $('nuevoPrecio').focus(); return; }

  const boton = $('btnGuardar');
  boton.disabled = true;
  mostrarCargando(estado.fotoArchivo ? 'Subiendo la foto…' : 'Guardando…');

  try {
    let imagenUrl = '';
    if (estado.fotoArchivo) {
      imagenUrl = await subirFoto(estado.fotoArchivo);
      $('cargandoTexto').textContent = 'Guardando…';
    }

    const fila = {
      precio,
      categoria: estado.categoria,
      imagen_url: imagenUrl,
      tipo: estado.tipo,
      visitas: 0,
      cantidad: Math.max(1, Number($('nuevaCantidad').textContent) || 1),
      descripcion: $('nuevaDescripcion').value.trim().slice(0, 300) || null,
      editorial: estado.editorial || null
    };

    let serie = null;
    if (enSerie) {
      if (estado.serieElegida === 'nueva') {
        const { data, error } = await db.from('series')
          .insert([{ nombre: nombreNueva, categoria: estado.categoria, portada_url: imagenUrl, editorial: estado.editorial || null }])
          .select()
          .single();
        if (error) throw error;
        serie = data;
        estado.series.push(serie);
        estado.serieElegida = serie.id;
      } else {
        serie = serieDe(estado.serieElegida);
      }
      fila.serie_id = serie.id;
      fila.numero = numero || null;
      fila.categoria = serie.categoria;
      fila.editorial = fila.editorial || serie.editorial || null;
      fila.titulo = armarTitulo(serie.nombre, numero, detalle);
    } else {
      fila.titulo = armarTitulo(titulo, '', detalle);
    }
    fila.detalle = detalle || null;

    const { error } = await db.from('productos').insert([fila]);
    if (error) throw error;

    // Si el título no estaba en la lista, queda guardado para las próximas veces
    guardarTituloSiEsNuevo(enSerie ? serie.nombre : titulo, fila.categoria, enSerie);

    ocultarCargando();
    limpiarFormulario();
    if (enSerie) {
      avisar('✅ Guardado. Sacá la foto del siguiente número', 'ok', 3500);
      prepararCarga();
    } else {
      avisar('✅ ¡Guardado!');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    ocultarCargando();
    avisar('❌ ' + mensajeError(err), 'mal', 5000);
  } finally {
    boton.disabled = false;
  }
}

// =====================================================================
//  TÍTULOS: sugerencias mientras se escribe
// =====================================================================

function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function traerTitulosExtra() {
  try {
    const { data, error } = await db.from('titulos').select('*').order('nombre', { ascending: true });
    if (!error) estado.titulosExtra = data || [];
  } catch (e) { /* sin conexión: se usan solo los de la lista */ }
}

// Todos los títulos conocidos: lista base + los que se agregaron + colecciones ya cargadas
function todosLosTitulos() {
  const lista = [];
  const vistos = new Set();
  const sumar = (nombre, categoria, editorial, coleccion, origen) => {
    const k = normalizar(nombre);
    if (!k || vistos.has(k)) return;
    vistos.add(k);
    lista.push({ nombre, categoria, editorial: editorial || '', coleccion: !!coleccion, origen, clave: k });
  };
  estado.series.forEach(x => sumar(x.nombre, x.categoria, x.editorial, true, 'serie'));
  estado.titulosExtra.forEach(x => sumar(x.nombre, x.categoria, x.editorial, x.es_coleccion, 'propio'));
  (typeof TITULOS_BASE !== 'undefined' ? TITULOS_BASE : []).forEach(([n, c, e, col]) => sumar(n, c, e, col === 1, 'base'));
  return lista;
}

function buscarTitulos(texto, max = 6) {
  const q = normalizar(texto);
  if (q.length < 2) return [];
  const palabras = q.split(' ');
  return todosLosTitulos()
    .map(t => {
      let p = -1;
      if (t.clave.startsWith(q)) p = 0;
      else if (t.clave.split(' ').some(w => w.startsWith(q))) p = 1;
      else if (palabras.every(w => t.clave.includes(w))) p = 2;
      if (p >= 0 && t.origen === 'serie') p -= 0.5;   // lo que ya tiene cargado, primero
      return { t, p };
    })
    .filter(x => x.p >= 0)
    .sort((a, b) => a.p - b.p || a.t.nombre.length - b.t.nombre.length)
    .slice(0, max)
    .map(x => x.t);
}

let sugerenciasActuales = [];

function resaltar(nombre, texto) {
  const q = normalizar(texto);
  const i = normalizar(nombre).indexOf(q);
  // normalizar conserva la longitud salvo signos: si no coincide la posición, sin resaltar
  if (i < 0 || normalizar(nombre.slice(i, i + q.length)) !== q) return escapar(nombre);
  return escapar(nombre.slice(0, i)) + '<mark>' + escapar(nombre.slice(i, i + q.length)) + '</mark>' + escapar(nombre.slice(i + q.length));
}

function sugerirTitulo(input) {
  const caja = $('sug-' + input.id);
  const texto = input.value.trim();
  sugerenciasActuales = buscarTitulos(texto);
  if (texto.length < 2) { caja.innerHTML = ''; return; }
  const exacto = sugerenciasActuales.some(t => t.clave === normalizar(texto));
  caja.innerHTML = sugerenciasActuales.map((t, i) => `
      <button type="button" class="sugerencia" role="option" onmousedown="event.preventDefault()" onclick="elegirSugerencia('${input.id}', ${i})">
        <span class="t">${resaltar(t.nombre, texto)}${t.editorial ? `<small>${escapar(t.editorial)}</small>` : ''}</span>
        <span class="tag-cat">${t.origen === 'serie' ? '📚 Ya cargada' : escapar(CATEGORIAS[t.categoria] || t.categoria)}</span>
      </button>`).join('') +
    (exacto ? '' : `<button type="button" class="sugerencia nuevo-titulo" onmousedown="event.preventDefault()" onclick="ocultarSugerencias($('${input.id}'), true)">
        <span class="t">➕ Usar "${escapar(texto)}"<small>Es nuevo: queda guardado en la lista</small></span></button>`);
}

function ocultarSugerencias(input, ya) {
  const caja = $('sug-' + input.id);
  if (ya) { caja.innerHTML = ''; return; }
  setTimeout(() => { caja.innerHTML = ''; }, 150);
}

function marcarCategoria(cat) {
  if (!CATEGORIAS[cat]) return;
  estado.categoria = cat;
  document.querySelectorAll('#elegirCategoria button').forEach(b => b.classList.toggle('activo', b.dataset.valor === cat));
}

// Elegir una sugerencia: si tiene números (colección o revista), pasa a "Un número"
function elegirSugerencia(inputId, i) {
  const t = sugerenciasActuales[i];
  if (!t) return;
  $('sug-' + inputId).innerHTML = '';
  estado.editorial = t.editorial || '';
  marcarCategoria(t.categoria);

  if (t.coleccion) {
    const existente = estado.series.find(x => normalizar(x.nombre) === t.clave);
    document.querySelectorAll('#elegirModo button').forEach(b => b.classList.toggle('activo', b.dataset.valor === 'serie'));
    estado.modo = 'serie';
    if (existente) {
      estado.serieElegida = existente.id;
    } else {
      estado.serieElegida = 'nueva';
      $('nombreSerieNueva').value = t.nombre;
    }
    actualizarFormularioModo();
    setTimeout(() => $('nuevoNumero').focus(), 150);
  } else {
    document.querySelectorAll('#elegirModo button').forEach(b => b.classList.toggle('activo', b.dataset.valor === 'suelto'));
    estado.modo = 'suelto';
    $('nuevoTitulo').value = t.nombre;
    actualizarFormularioModo();
    setTimeout(() => $('nuevoPrecio').focus(), 150);
  }
}

// Si se escribió un título que no está en ninguna lista, se guarda
async function guardarTituloSiEsNuevo(nombre, categoria, coleccion) {
  const k = normalizar(nombre);
  const base = typeof TITULOS_BASE !== 'undefined' ? TITULOS_BASE : [];
  if (!k || base.some(t => normalizar(t[0]) === k) || estado.titulosExtra.some(t => normalizar(t.nombre) === k)) return;
  const fila = { nombre: nombre.trim().slice(0, 80), categoria, editorial: estado.editorial || null, es_coleccion: !!coleccion };
  const { error } = await db.from('titulos').insert([fila]);
  if (!error) estado.titulosExtra.push(fila);
}

// =====================================================================
//  BUSCAR FOTO Y DESCRIPCIÓN EN INTERNET
// =====================================================================

const busqueda = { resultados: null, foto: null, desc: null, destino: null };

async function invocarBusqueda(cuerpo) {
  const { data, error } = await db.functions.invoke('buscar-foto', { body: cuerpo });
  if (error) {
    let codigo = error.message || 'error';
    try { const j = await error.context.json(); if (j && j.error) codigo = j.error; } catch (e) {}
    throw new Error(codigo);
  }
  return data;
}

// Arma lo que se busca con lo que ya se cargó en el formulario
function consultaDeLaCarga() {
  if (estado.modo === 'serie') {
    const serie = estado.serieElegida && estado.serieElegida !== 'nueva' ? serieDe(estado.serieElegida) : null;
    const nombre = serie ? serie.nombre : $('nombreSerieNueva').value.trim();
    const numero = $('nuevoNumero').value.trim();
    const editorial = estado.editorial || (serie && serie.editorial) || '';
    if (!nombre) return '';
    return [nombre, numero ? 'N° ' + numero : '', $('nuevoDetalle').value.trim(), editorial].filter(Boolean).join(' ');
  }
  return [$('nuevoTitulo').value.trim(), $('nuevoDetalle').value.trim(), estado.editorial].filter(Boolean).join(' ');
}

function buscarFotoParaCarga() {
  const q = consultaDeLaCarga();
  if (!q) { avisar('Primero escribí qué es (paso 2)', 'mal'); window.scrollTo({ top: 300, behavior: 'smooth' }); return; }
  abrirBusqueda(q, { tipo: 'carga' });
}

function buscarFotoParaProducto(pid) {
  const p = productoPorId(pid);
  if (!p) return;
  abrirBusqueda([p.titulo, p.editorial].filter(Boolean).join(' '), { tipo: 'producto', pid: Number(pid) });
}

async function abrirBusqueda(q, destino) {
  busqueda.resultados = null; busqueda.foto = null; busqueda.desc = null; busqueda.destino = destino;
  mostrarHoja(`
    <h3>🔎 Buscando…</h3>
    <p class="info">${escapar(q)}</p>
    <div class="resultados-fotos">${'<button disabled></button>'.repeat(6)}</div>`);
  try {
    busqueda.resultados = await invocarBusqueda({ q });
    dibujarBusqueda(q);
  } catch (err) {
    console.error(err);
    mostrarHoja(`
      <h3>No se pudo buscar</h3>
      <p class="info">${escapar(mensajeError(err))}</p>
      <div class="acciones"><button class="accion cerrar" onclick="cerrarHoja()">Cerrar</button></div>`);
  }
}

function dibujarBusqueda(q) {
  const r = busqueda.resultados || { imagenes: [], descripciones: [] };
  if (!busqueda.desc && r.descripciones.length) busqueda.desc = 0;
  const fotos = r.imagenes.map((im, i) => `
      <button class="${busqueda.foto === i ? 'activo' : ''}" onclick="elegirFotoBuscada(${i})" aria-label="Foto ${i + 1} de ${escapar(im.fuente)}">
        <img src="${escapar(im.miniatura)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span class="fuente">${escapar(im.fuente)}</span>
      </button>`).join('');
  const descs = r.descripciones.map((d, i) => `
      <button class="${busqueda.desc === i ? 'activo' : ''}" onclick="elegirDescBuscada(${i})">
        ${escapar(d.texto)}<small>${escapar(d.fuente)}</small>
      </button>`).join('');
  mostrarHoja(`
    <h3>Elegí la tapa</h3>
    <p class="info">${escapar(q)}</p>
    ${fotos ? `<div class="resultados-fotos">${fotos}</div>` : '<p class="vacio">No encontré fotos. Probá sacándole una foto.</p>'}
    ${descs ? `<p class="mini">Descripción (tocá la que mejor la describe)</p><div class="opciones-desc">${descs}
      <button class="${busqueda.desc === -1 ? 'activo' : ''}" onclick="elegirDescBuscada(-1)">Sin descripción</button></div>` : ''}
    <div class="acciones">
      <button class="btn-principal" onclick="usarBusqueda()" ${busqueda.foto === null && (busqueda.desc === null || busqueda.desc < 0) ? 'disabled' : ''}>✅ Usar esto</button>
      <button class="accion cerrar" onclick="cerrarHoja()">Cancelar</button>
    </div>`);
}

function elegirFotoBuscada(i) {
  busqueda.foto = busqueda.foto === i ? null : i;
  const scroll = $('hoja').scrollTop;
  dibujarBusqueda(document.querySelector('.hoja .info') ? document.querySelector('.hoja .info').textContent : '');
  $('hoja').scrollTop = scroll;
}

function elegirDescBuscada(i) {
  busqueda.desc = i;
  const scroll = $('hoja').scrollTop;
  dibujarBusqueda(document.querySelector('.hoja .info') ? document.querySelector('.hoja .info').textContent : '');
  $('hoja').scrollTop = scroll;
}

async function traerFotoElegida() {
  const im = busqueda.resultados.imagenes[busqueda.foto];
  let blob;
  try {
    blob = await invocarBusqueda({ descargar: im.url });
  } catch (e) {
    // Si la original no se deja bajar, se usa la vista previa (más chica)
    blob = await invocarBusqueda({ descargar: im.miniatura });
  }
  if (!(blob instanceof Blob)) throw new Error('NO_ES_IMAGEN');
  return blob;
}

async function usarBusqueda() {
  const r = busqueda.resultados;
  const texto = busqueda.desc !== null && busqueda.desc >= 0 ? r.descripciones[busqueda.desc].texto : '';
  mostrarCargando(busqueda.foto !== null ? 'Trayendo la foto…' : 'Guardando…');
  try {
    let blob = null;
    if (busqueda.foto !== null) blob = await comprimirFoto(await traerFotoElegida());

    if (busqueda.destino.tipo === 'carga') {
      if (blob) {
        estado.fotoArchivo = blob;
        if (estado.fotoPreviewUrl) URL.revokeObjectURL(estado.fotoPreviewUrl);
        estado.fotoPreviewUrl = URL.createObjectURL(blob);
        $('fotoCaja').innerHTML = '<img src="' + estado.fotoPreviewUrl + '" alt="Foto elegida">';
      }
      if (texto) $('nuevaDescripcion').value = texto;
      ocultarCargando();
      cerrarHoja();
      avisar('✅ Listo. Revisá y tocá Guardar');
    } else {
      const pid = busqueda.destino.pid;
      const cambios = {};
      if (blob) cambios.imagen_url = await subirFoto(blob);
      if (texto) cambios.descripcion = texto;
      const viejo = productoPorId(pid);
      const { error } = await db.from('productos').update(cambios).eq('id', pid);
      if (error) throw error;
      // Borra la foto anterior para no llenar el espacio
      const rutaVieja = blob && viejo ? rutaDeFoto(viejo.imagen_url) : null;
      if (rutaVieja) db.storage.from(BUCKET).remove([rutaVieja]).catch(() => {});
      ocultarCargando();
      cerrarHoja();
      avisar('✅ Ficha actualizada');
      refrescar();
    }
  } catch (err) {
    console.error(err);
    ocultarCargando();
    avisar('❌ ' + mensajeError(err), 'mal', 5000);
  }
}

function pantallaDescripcion(pid) {
  const p = productoPorId(pid);
  $('hojaContenido').innerHTML = `
    <h3>📝 Descripción</h3>
    <p class="info">${escapar(p.titulo)}</p>
    <textarea id="descEditada" rows="4" maxlength="300" placeholder="De qué trata, en una o dos líneas">${escapar(p.descripcion || '')}</textarea>
    <div class="acciones espacio-arriba">
      <button class="btn-principal" onclick="guardarDescripcion(${Number(pid)})">✅ Guardar</button>
      <button class="accion cerrar" onclick="dibujarHoja(${Number(pid)})">Cancelar</button>
    </div>`;
  $('hoja').scrollTop = 0;
}

async function guardarDescripcion(pid) {
  await actualizarProducto(pid, { descripcion: $('descEditada').value.trim().slice(0, 300) || null }, '📝 Descripción guardada');
}

// =====================================================================
//  STOCK (vista de administración)
// =====================================================================

async function traerProductos() {
  const [prods, series] = await Promise.all([
    db.from('productos').select('*').order('created_at', { ascending: false }),
    db.from('series').select('*').order('nombre', { ascending: true })
  ]);
  if (prods.error) throw prods.error;
  estado.productos = prods.data || [];
  // Si la tabla de colecciones todavía no existe, la app sigue andando sin ellas
  estado.series = series.error ? [] : (series.data || []);
  return estado.productos;
}

function serieDe(id) {
  return estado.series.find(x => Number(x.id) === Number(id));
}

function numerosDeSerie(id, soloEnVenta = false) {
  return (soloEnVenta ? enVenta() : estado.productos).filter(p => Number(p.serie_id) === Number(id));
}

// Ordena "3", "10", "2bis" de forma natural
function compararNumero(a, b) {
  // Los que no tienen número van al final
  if (!a.numero && b.numero) return 1;
  if (a.numero && !b.numero) return -1;
  return String(a.numero || '').localeCompare(String(b.numero || ''), 'es', { numeric: true });
}

// Arma el título que se ve: "Rápido y Furioso N° 12 (Chevrolet Camaro Z28)"
function armarTitulo(base, numero, detalle) {
  let t = String(base || '').trim();
  if (numero) t += ' N° ' + String(numero).trim();
  if (detalle) t += ' (' + String(detalle).trim() + ')';
  return t;
}

// Título sin el número ni el detalle (para editar lo suelto)
function tituloBase(p) {
  let t = String(p.titulo || '');
  if (p.detalle && t.endsWith(' (' + p.detalle + ')')) t = t.slice(0, -(' (' + p.detalle + ')').length);
  if (p.numero && t.endsWith(' N° ' + p.numero)) t = t.slice(0, -(' N° ' + p.numero).length);
  return t.trim();
}

function mostrarTituloFinal() {
  const el = $('vistaTitulo');
  if (!el) return;
  let base = '';
  if (estado.modo === 'serie') {
    const serie = estado.serieElegida && estado.serieElegida !== 'nueva' ? serieDe(estado.serieElegida) : null;
    base = serie ? serie.nombre : $('nombreSerieNueva').value.trim();
  } else {
    base = $('nuevoTitulo').value.trim();
  }
  const t = armarTitulo(base, estado.modo === 'serie' ? $('nuevoNumero').value.trim() : '', $('nuevoDetalle').value.trim());
  el.textContent = t ? 'Así se va a ver: ' + t : '';
}

function portadaDeSerie(serie) {
  if (serie.portada_url) return serie.portada_url;
  const conFoto = numerosDeSerie(serie.id).filter(p => p.imagen_url).sort(compararNumero);
  return conFoto.length ? conFoto[0].imagen_url : '';
}

async function cargarStock() {
  $('listaStock').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    await Promise.all([traerProductos(), traerReservas().catch(() => [])]);
    dibujarStock();
  } catch (err) {
    console.error(err);
    $('listaStock').innerHTML = '<p class="vacio">❌ ' + escapar(mensajeError(err)) +
      '<br><br><button class="btn-sec" onclick="cargarStock()">🔄 Probar de nuevo</button></p>';
  }
}

function elegirFiltro(boton) {
  document.querySelectorAll('.pestanas button').forEach(b => b.classList.remove('activo'));
  boton.classList.add('activo');
  estado.filtro = boton.dataset.filtro;
  dibujarStock();
}

// Texto donde se busca: título, descripción, editorial, categoría y colección.
// Sin importar mayúsculas ni tildes; si escribís varias palabras, tienen que estar todas.
function textoBuscable(p) {
  const serie = p.serie_id ? serieDe(p.serie_id) : null;
  return normalizar([p.titulo, p.descripcion, p.editorial, CATEGORIAS[p.categoria] || p.categoria, serie && serie.nombre, p.numero].filter(Boolean).join(' '));
}

function coincideBusqueda(p, texto) {
  const palabras = normalizar(texto).split(' ').filter(Boolean);
  if (!palabras.length) return true;
  const hay = textoBuscable(p);
  return palabras.every(w => hay.includes(w));
}

function filtrarPorTexto(lista, texto) {
  if (!String(texto || '').trim()) return lista;
  return lista.filter(p => coincideBusqueda(p, texto));
}

function etiquetasDe(p) {
  const cant = cantidadDe(p);
  const res = reservadoDe(p);
  const stock = cant === 0
    ? '<span class="etiqueta agotado">🚫 Sin stock</span>'
    : `<span class="etiqueta cant">📦 ${cant}</span>` + (res ? `<span class="etiqueta res">📌 ${res} reservad${res === 1 ? 'o' : 'os'}</span>` : '');
  const tipo = esNovedad(p)
    ? '<span class="etiqueta nuevo">✨ Nuevo · ' + diasQueQuedan(p) + ' día' + (diasQueQuedan(p) === 1 ? '' : 's') + '</span>'
    : '<span class="etiqueta">📦 Archivo</span>';
  const serie = p.serie_id ? '<span class="etiqueta">📚 Colección</span>' : '';
  return stock + tipo + serie;
}

function listaStockFiltrada() {
  let lista = estado.productos;
  if (estado.filtro === 'novedad') lista = lista.filter(p => esNovedad(p) && cantidadDe(p) > 0);
  if (estado.filtro === 'archivo') lista = lista.filter(p => !esNovedad(p) && cantidadDe(p) > 0);
  if (estado.filtro === 'agotado') lista = lista.filter(p => cantidadDe(p) === 0);
  return filtrarPorTexto(lista, $('buscador').value);
}

function dibujarStock() {
  const lista = listaStockFiltrada();
  seleccion.visibles = lista.map(p => Number(p.id));

  $('contador').textContent = lista.length === 1 ? '1 cosa' : lista.length + ' cosas';
  $('btnElegirVarios').classList.toggle('oculto', seleccion.activa || !lista.length);

  if (lista.length === 0) {
    $('listaStock').innerHTML = '<p class="vacio">No hay nada acá.</p>';
    return;
  }

  $('listaStock').innerHTML = lista.map(p => {
    const elegido = seleccion.activa && seleccion.ids.has(Number(p.id));
    return `
    <button class="item ${cantidadDe(p) === 0 ? 'agotado' : ''} ${elegido ? 'elegido' : ''}" data-id="${Number(p.id)}" onclick="tocarItem(${Number(p.id)})">
      ${seleccion.activa ? `<span class="marca">${elegido ? '✓' : ''}</span>` : ''}
      ${p.imagen_url
        ? `<img src="${escapar(p.imagen_url)}" alt="" loading="lazy">`
        : '<div class="sin-foto">📰</div>'}
      <div class="datos">
        <div class="titulo">${escapar(p.titulo)}</div>
        <div class="precio">${plata(p.precio)}</div>
        <div class="etiquetas">${etiquetasDe(p)}</div>
      </div>
    </button>`;
  }).join('');
}

async function actualizarResumen() {
  try {
    await traerProductos();
    const conStock = estado.productos.filter(p => cantidadDe(p) > 0);
    const total = conStock.length;
    const nuevos = conStock.filter(esNovedad).length;
    const sinStock = estado.productos.length - total;
    $('resumenStock').textContent = estado.productos.length === 0
      ? 'Todavía no cargaste nada'
      : `${total} con stock · ${nuevos} nuevo${nuevos === 1 ? '' : 's'}${sinStock ? ` · ${sinStock} sin stock` : ''}`;
    actualizarResumenReservas();
    marcarConexion(true);
    revisarRafagasPendientes();
  } catch (err) {
    marcarConexion(false, err);
  }
}

function marcarConexion(ok, err) {
  const el = $('estadoConexion');
  el.className = 'estado ' + (ok ? 'ok' : 'mal');
  el.lastElementChild.textContent = ok ? 'Conectado' : mensajeError(err);
}

// ---------- Hoja de acciones de un producto ----------

function productoPorId(id) {
  return estado.productos.find(p => Number(p.id) === Number(id));
}

function dibujarHoja(id) {
  const p = productoPorId(id);
  if (!p) return false;
  const nuevo = esNovedad(p);
  const pedidos = Number(p.visitas) || 0;
  const cant = cantidadDe(p);
  const res = reservadoDe(p);
  const disp = disponible(p);
  const reservas = reservasAbiertasDe(p.id);
  const pid = Number(p.id);

  $('hojaContenido').innerHTML = `
    ${p.imagen_url ? `<img src="${escapar(p.imagen_url)}" alt="">` : ''}
    <h3>${escapar(p.titulo)}</h3>
    ${p.descripcion ? `<p class="descripcion-detalle">${escapar(p.descripcion)}</p>` : ''}
    <p class="info">${plata(p.precio)} · ${escapar(CATEGORIAS[p.categoria] || p.categoria)}
      ${pedidos > 0 ? ' · ⭐ ' + pedidos + ' punto' + (pedidos === 1 ? '' : 's') + ' de interés' : ''}</p>
    <div class="stock-linea">
      <span>📦 Hay ${cant}</span>
      ${res ? `<span>📌 ${res} reservad${res === 1 ? 'o' : 'os'}</span>` : ''}
      <span class="${disp ? 'ok' : 'no'}">${disp ? `✅ ${disp} disponible${disp === 1 ? '' : 's'}` : '🚫 Nada disponible'}</span>
    </div>
    ${reservas.length ? `<div class="mini-reservas"><b>Reservas</b>${reservas.map(r =>
      `${r.estado === 'pendiente' ? '🔔' : '📌'} ${escapar(r.cliente)} · ${r.cantidad} · ${r.pagado ? '💵 pagó' : '⏳ no pagó'}`).join('<br>')}</div>` : ''}
    <div class="grilla-acciones">
      <button class="vender" onclick="pantallaVenta(${pid})" ${disp ? '' : 'disabled'}><span class="ic">🛒</span>Vendí</button>
      <button class="reservar" onclick="pantallaReserva(${pid}, null, 'producto')" ${disp ? '' : 'disabled'}><span class="ic">📌</span>Reservar</button>
      <button onclick="pantallaAjuste(${pid})" ${disp ? '' : 'disabled'}><span class="ic">➖</span>Dar de baja</button>
      <button onclick="pantallaIngreso(${pid})"><span class="ic">➕</span>Llegaron más</button>
    </div>
    <div class="acciones">
      <button class="accion" onclick="pantallaEditar(${pid})">✏️ Editar publicación (título, número, modelo…)</button>
      ${p.serie_id && serieDe(p.serie_id) ? `<button class="accion" onclick="pantallaNombreSerie(${Number(p.serie_id)}, ${pid})">📚 Cambiar el nombre de la colección</button>` : ''}
      <button class="accion" onclick="pantallaPrecio(${pid})">💲 Cambiar el precio</button>
      <button class="accion" onclick="buscarFotoParaProducto(${pid})">🔎 Buscar foto y descripción en internet</button>
      <button class="accion" onclick="pantallaDescripcion(${pid})">📝 ${p.descripcion ? 'Cambiar la descripción' : 'Agregar descripción'}</button>
      ${nuevo
        ? `<button class="accion" onclick="cambiarTipo(${pid}, 'stock')">📦 Pasar al archivo</button>`
        : `<button class="accion" onclick="cambiarTipo(${pid}, 'nuevo')">✨ Marcar como nuevo otra vez</button>`}
      ${disp ? `<button class="accion wa" onclick="compartirProducto(${pid})">📲 Mandar esta por WhatsApp</button>` : ''}
      ${p.serie_id && serieDe(p.serie_id) ? `
        <button class="accion wa" onclick="compartirSerie(${Number(p.serie_id)})">📚 Mandar toda la colección</button>
        ${p.imagen_url ? `<button class="accion" onclick="usarComoPortada(${pid})">🖼️ Usar esta foto de portada de la colección</button>` : ''}` : ''}
      <button class="accion peligro" onclick="pantallaBorrar(${pid})">🗑️ Borrar del todo</button>
      <button class="accion cerrar" onclick="cerrarHoja()">Cerrar</button>
    </div>
  `;
  return true;
}

function abrirHoja(id) {
  if (!dibujarHoja(id)) return;
  $('hoja').classList.remove('oculto');
  $('hoja').scrollTop = 0;
  history.pushState({ hoja: true }, '');
}

function cerrarHoja(volverHistorial = true) {
  if ($('hoja').classList.contains('oculto')) return;
  $('hoja').classList.add('oculto');
  if (volverHistorial && history.state && history.state.hoja) {
    ignorarProximoAtras = true;
    history.back();
  }
}

function pantallaPrecio(id) {
  const p = productoPorId(id);
  $('hojaContenido').innerHTML = `
    <h3>Nuevo precio</h3>
    <p class="info">${escapar(p.titulo)} · antes ${plata(p.precio)}</p>
    <div class="campo-precio" style="margin-bottom:14px">
      <span>$</span>
      <input type="text" id="precioEditado" inputmode="numeric" pattern="[0-9]*" value="${Number(p.precio)}">
    </div>
    <div class="acciones">
      <button class="btn-principal" onclick="guardarPrecio(${Number(p.id)})">✅ Guardar precio</button>
      <button class="accion cerrar" onclick="dibujarHoja(${Number(p.id)})">Cancelar</button>
    </div>
  `;
  const input = $('precioEditado');
  setTimeout(() => { input.focus(); input.select(); }, 150);
}

// Editar todo lo de una publicación ya cargada
let editandoPid = null;

function pantallaEditar(pid) {
  editandoPid = Number(pid);
  const p = productoPorId(pid);
  const serie = p.serie_id ? serieDe(p.serie_id) : null;
  const opcionesSerie = '<option value="">— Ninguna (es algo suelto) —</option>' +
    estado.series.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map(x => `<option value="${Number(x.id)}" ${serie && Number(serie.id) === Number(x.id) ? 'selected' : ''}>${escapar(x.nombre)}</option>`).join('');
  const opcionesCat = Object.keys(CATEGORIAS).map(c => `<option value="${c}" ${p.categoria === c ? 'selected' : ''}>${escapar(CATEGORIAS[c])}</option>`).join('');
  $('hojaContenido').innerHTML = `
    <h3>✏️ Editar publicación</h3>
    <div class="editar-campos">
      <label class="mini" for="edSerie">Colección</label>
      <select id="edSerie" onchange="actualizarEdicion()">${opcionesSerie}</select>

      <div id="edBloqueTitulo" class="${serie ? 'oculto' : ''}">
        <label class="mini" for="edTitulo">Título</label>
        <input type="text" id="edTitulo" value="${escapar(serie ? '' : tituloBase(p))}" autocomplete="off" autocapitalize="sentences" oninput="actualizarEdicion()">
      </div>

      <div id="edBloqueNumero" class="${serie ? '' : 'oculto'}">
        <label class="mini" for="edNumero">Número <span class="opcional">(si lo tiene)</span></label>
        <div class="campo-precio campo-numero">
          <span>N°</span>
          <input type="text" id="edNumero" inputmode="numeric" value="${escapar(p.numero || '')}" autocomplete="off" oninput="actualizarEdicion()">
        </div>
      </div>

      <label class="mini" for="edDetalle">Modelo o detalle <span class="opcional">(opcional)</span></label>
      <input type="text" id="edDetalle" value="${escapar(p.detalle || '')}" placeholder="Ej: Chevrolet Camaro Z28" maxlength="60" autocomplete="off" oninput="actualizarEdicion()">

      <p class="titulo-final" id="edTituloFinal"></p>

      <label class="mini" for="edCategoria">Tipo</label>
      <select id="edCategoria">${opcionesCat}</select>

      <label class="mini" for="edPrecio">Precio</label>
      <div class="campo-precio">
        <span>$</span>
        <input type="text" id="edPrecio" inputmode="numeric" value="${Number(p.precio)}" autocomplete="off">
      </div>
    </div>
    <div class="acciones espacio-arriba">
      <button class="btn-principal" onclick="guardarEdicion(${Number(pid)})">✅ Guardar cambios</button>
      <button class="accion cerrar" onclick="dibujarHoja(${Number(pid)})">Cancelar</button>
    </div>`;
  $('hoja').scrollTop = 0;
  actualizarEdicion();
}

function datosEdicion() {
  const sid = $('edSerie').value ? Number($('edSerie').value) : null;
  const serie = sid ? serieDe(sid) : null;
  const numero = serie ? $('edNumero').value.trim() : '';
  const detalle = $('edDetalle').value.trim().slice(0, 60);
  const base = serie ? serie.nombre : $('edTitulo').value.trim();
  return { sid, serie, numero, detalle, base, titulo: armarTitulo(base, numero, detalle) };
}

function actualizarEdicion() {
  const d = datosEdicion();
  $('edBloqueTitulo').classList.toggle('oculto', !!d.serie);
  $('edBloqueNumero').classList.toggle('oculto', !d.serie);
  // Si se saca de una colección, propone el nombre que tenía como título
  if (!d.serie && !$('edTitulo').value.trim()) {
    const p = productoPorId(editandoPid);
    if (p) $('edTitulo').value = tituloBase(p);
  }
  $('edTituloFinal').textContent = 'Así se va a ver: ' + (datosEdicion().titulo || '—');
}

async function guardarEdicion(pid) {
  const d = datosEdicion();
  if (!d.base) { avisar('Falta el título', 'mal'); $('edTitulo').focus(); return; }
  const precio = soloNumeros($('edPrecio').value);
  if (!precio || precio <= 0) { avisar('Poné un precio válido', 'mal'); $('edPrecio').focus(); return; }
  const cambios = {
    titulo: d.titulo.slice(0, 160),
    serie_id: d.sid,
    numero: d.numero || null,
    detalle: d.detalle || null,
    categoria: $('edCategoria').value,
    precio
  };
  await actualizarProducto(pid, cambios, '✏️ Publicación actualizada');
}

function pantallaNombreSerie(sid, pid) {
  const serie = serieDe(sid);
  const cant = numerosDeSerie(sid).length;
  $('hojaContenido').innerHTML = `
    <h3>📚 Nombre de la colección</h3>
    <p class="info">Cambia en los ${cant} número${cant === 1 ? '' : 's'} cargado${cant === 1 ? '' : 's'}.</p>
    <input type="text" id="serieEditada" value="${escapar(serie.nombre)}" autocomplete="off" autocapitalize="words" style="margin-bottom:14px">
    <div class="acciones">
      <button class="btn-principal" onclick="guardarNombreSerie(${Number(sid)})">✅ Guardar</button>
      <button class="accion cerrar" onclick="dibujarHoja(${Number(pid)})">Cancelar</button>
    </div>`;
  $('hoja').scrollTop = 0;
  setTimeout(() => { $('serieEditada').focus(); $('serieEditada').select(); }, 150);
}

async function guardarNombreSerie(sid) {
  const nombre = $('serieEditada').value.trim().slice(0, 80);
  if (!nombre) { avisar('Escribí el nombre', 'mal'); return; }
  mostrarCargando('Guardando…');
  try {
    const { error } = await db.from('series').update({ nombre }).eq('id', sid);
    if (error) throw error;
    // Actualiza el título de cada número de la colección
    for (const p of numerosDeSerie(sid)) {
      const r = await db.from('productos').update({ titulo: armarTitulo(nombre, p.numero, p.detalle) }).eq('id', p.id);
      if (r.error) throw r.error;
    }
    const serie = serieDe(sid);
    if (serie) serie.nombre = nombre;
    ocultarCargando();
    cerrarHoja();
    avisar('📚 Nombre cambiado');
    refrescar();
  } catch (err) {
    console.error(err);
    ocultarCargando();
    avisar('❌ ' + mensajeError(err), 'mal', 5000);
  }
}

async function guardarPrecio(id) {
  const precio = soloNumeros($('precioEditado').value);
  if (!precio || precio <= 0) { avisar('Poné un precio válido', 'mal'); return; }
  await actualizarProducto(id, { precio }, '✅ Precio cambiado');
}

async function cambiarTipo(id, tipo) {
  // Al volver a "nuevo" reinicia los 7 días
  const cambios = tipo === 'nuevo' ? { tipo, created_at: new Date().toISOString() } : { tipo };
  await actualizarProducto(id, cambios, tipo === 'nuevo' ? '✨ Marcada como nueva' : '📦 Pasó al archivo');
}

async function actualizarProducto(id, cambios, mensajeOk) {
  mostrarCargando('Guardando…');
  const { error } = await db.from('productos').update(cambios).eq('id', id);
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  cerrarHoja();
  avisar(mensajeOk);
  refrescar();
}

async function usarComoPortada(id) {
  const p = productoPorId(id);
  if (!p || !p.serie_id) return;
  mostrarCargando('Guardando…');
  const { error } = await db.from('series').update({ portada_url: p.imagen_url }).eq('id', p.serie_id);
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  const serie = serieDe(p.serie_id);
  if (serie) serie.portada_url = p.imagen_url;
  cerrarHoja();
  avisar('🖼️ Portada cambiada');
}

function pantallaBorrar(id) {
  const p = productoPorId(id);
  const res = reservasAbiertasDe(p.id).length;
  $('hojaContenido').innerHTML = `
    <h3>¿Borrar del todo?</h3>
    <p class="info">${escapar(p.titulo)}<br>Se borra de la app con su foto y no se puede deshacer.
      ${res ? `<br>⚠️ Tiene ${res} reserva${res === 1 ? '' : 's'}: se cancelan.` : ''}
      <br><br>Si la vendiste o se rompió, mejor usá <b>Vendí</b> o <b>Dar de baja</b>, así queda anotado.</p>
    <div class="acciones">
      <button class="accion peligro" style="text-align:center" onclick="borrarProductos([${Number(p.id)}])">🗑️ Sí, borrar</button>
      <button class="accion cerrar" onclick="dibujarHoja(${Number(p.id)})">No, dejala</button>
    </div>
  `;
}

// Borra una o varias publicaciones, sus fotos y las portadas que las usaban
async function borrarProductos(ids) {
  const productos = ids.map(productoPorId).filter(Boolean);
  mostrarCargando('Borrando…');
  const { error } = ids.length === 1
    ? await db.from('productos').delete().eq('id', ids[0])
    : await db.from('productos').delete().in('id', ids);
  if (error) {
    ocultarCargando();
    console.error(error);
    avisar('❌ ' + mensajeError(error), 'mal', 5000);
    return false;
  }
  const urls = productos.map(p => p.imagen_url).filter(Boolean);
  const rutas = urls.map(rutaDeFoto).filter(Boolean);
  if (rutas.length) await db.storage.from(BUCKET).remove(rutas).catch(() => {});
  for (const serie of estado.series.filter(x => x.portada_url && urls.includes(x.portada_url))) {
    await db.from('series').update({ portada_url: '' }).eq('id', serie.id);
    serie.portada_url = '';
  }
  ocultarCargando();
  cerrarHoja();
  avisar(ids.length === 1 ? '🗑️ Borrada' : `🗑️ ${ids.length} borradas`);
  refrescar();
  return true;
}

// =====================================================================
//  INVENTARIO: cantidades, ventas, bajas, ingresos
// =====================================================================

function cantidadDe(p) { return p.cantidad == null ? 1 : Math.max(0, Number(p.cantidad) || 0); }
function reservadoDe(p) { return Math.max(0, Number(p.reservado) || 0); }
function disponible(p) { return Math.max(0, cantidadDe(p) - reservadoDe(p)); }
function enVenta() { return estado.productos.filter(p => disponible(p) > 0); }

function refrescar() {
  if (estado.pantalla === 'stock') cargarStock();
  else if (estado.pantalla === 'reservas') cargarReservas();
  else if (estado.pantalla === 'inicio') actualizarResumen();
}

function mostrarHoja(html) {
  $('hojaContenido').innerHTML = html;
  if ($('hoja').classList.contains('oculto')) {
    $('hoja').classList.remove('oculto');
    history.pushState({ hoja: true }, '');
  }
  $('hoja').scrollTop = 0;
}

// Selector de cantidad grande (− 1 +). Si se pasa precio, muestra el total.
function selectorCantidad(id, valor, max, precio) {
  return `
    <div class="fila-cant">
      <div class="stepper grande">
        <button type="button" onclick="pasoCant('${id}', -1)">−</button>
        <output id="${id}" data-max="${max}" data-precio="${precio || ''}">${valor}</output>
        <button type="button" onclick="pasoCant('${id}', 1)">+</button>
      </div>
      ${precio ? `<span class="total-hoja" id="${id}Total">${plata(valor * precio)}</span>` : ''}
    </div>`;
}

function pasoCant(id, delta) {
  const el = $(id);
  const max = Number(el.dataset.max) || 99;
  const v = Math.max(1, Math.min(max, (Number(el.textContent) || 1) + delta));
  el.textContent = v;
  if (el.dataset.precio && $(id + 'Total')) $(id + 'Total').textContent = plata(v * Number(el.dataset.precio));
  if ($(id + 'Boton')) $(id + 'Boton').dataset.cant = v;
  document.querySelectorAll(`[data-cant-de="${id}"]`).forEach(x => { x.textContent = v; });
}

async function moverStock(pid, delta, tipo, motivo, mensajeOk) {
  mostrarCargando('Guardando…');
  const { data, error } = await db.rpc('mover_stock', { pid, delta, tipo, motivo: motivo || null });
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  cerrarHoja();
  avisar(mensajeOk + (Number(data) === 0 ? ' · quedó sin stock' : ''), 'ok', 3200);
  refrescar();
}

function pantallaVenta(pid) {
  const p = productoPorId(pid);
  const disp = disponible(p);
  $('hojaContenido').innerHTML = `
    <h3>🛒 ¿Cuántos vendiste?</h3>
    <p class="info">${escapar(p.titulo)} · ${plata(p.precio)} c/u · ${disp} disponible${disp === 1 ? '' : 's'}</p>
    ${selectorCantidad('cantHoja', 1, disp, Number(p.precio))}
    <div class="acciones espacio-arriba">
      <button class="btn-principal" onclick="moverStock(${Number(pid)}, -Number($('cantHoja').textContent), 'venta', null, '🛒 Venta anotada')">✅ Vendí <span data-cant-de="cantHoja">1</span></button>
      <button class="accion cerrar" onclick="dibujarHoja(${Number(pid)})">Cancelar</button>
    </div>`;
  $('hoja').scrollTop = 0;
}

function pantallaIngreso(pid) {
  const p = productoPorId(pid);
  $('hojaContenido').innerHTML = `
    <h3>➕ ¿Cuántos llegaron?</h3>
    <p class="info">${escapar(p.titulo)} · ahora hay ${cantidadDe(p)}</p>
    ${selectorCantidad('cantHoja', 1, 99)}
    <div class="acciones espacio-arriba">
      <button class="btn-principal btn-azul" onclick="moverStock(${Number(pid)}, Number($('cantHoja').textContent), 'ingreso', null, '➕ Stock sumado')">➕ Sumar <span data-cant-de="cantHoja">1</span></button>
      <button class="accion cerrar" onclick="dibujarHoja(${Number(pid)})">Cancelar</button>
    </div>`;
  $('hoja').scrollTop = 0;
}

// ---------- Baja por motivo (se rompió, lo regalé…) ----------

async function traerMotivos() {
  const { data, error } = await db.from('motivos').select('*').order('orden', { ascending: true });
  if (error) throw error;
  estado.motivos = data || [];
  return estado.motivos;
}

async function pantallaAjuste(pid) {
  const p = productoPorId(pid);
  const disp = disponible(p);
  try { await traerMotivos(); } catch (e) { console.warn(e); }
  $('hojaContenido').innerHTML = `
    <h3>➖ Dar de baja</h3>
    <p class="info">${escapar(p.titulo)} · ${disp} disponible${disp === 1 ? '' : 's'}</p>
    <p class="mini">¿Cuántos?</p>
    ${selectorCantidad('cantHoja', 1, disp)}
    <p class="mini">¿Por qué?</p>
    <div class="chips-motivos" id="chipsMotivos">
      ${estado.motivos.map(m => `<button type="button" data-motivo="${escapar(m.nombre)}" onclick="elegirMotivo(this)">${escapar(m.nombre)}</button>`).join('')}
    </div>
    <input type="text" id="motivoOtro" placeholder="✏️ Otro motivo (queda guardado)" autocomplete="off" oninput="escribirMotivo()">
    <div class="acciones espacio-arriba">
      <button class="btn-principal btn-azul" onclick="confirmarAjuste(${Number(pid)})">➖ Dar de baja <span data-cant-de="cantHoja">1</span></button>
      <button class="accion cerrar" onclick="dibujarHoja(${Number(pid)})">Cancelar</button>
    </div>`;
  $('hoja').scrollTop = 0;
}

function elegirMotivo(boton) {
  document.querySelectorAll('#chipsMotivos button').forEach(b => b.classList.toggle('activo', b === boton));
  $('motivoOtro').value = '';
}

function escribirMotivo() {
  if ($('motivoOtro').value.trim()) document.querySelectorAll('#chipsMotivos button').forEach(b => b.classList.remove('activo'));
}

async function confirmarAjuste(pid) {
  const escrito = $('motivoOtro').value.trim();
  const chip = document.querySelector('#chipsMotivos button.activo');
  const motivo = escrito || (chip ? chip.dataset.motivo : '');
  if (!motivo) { avisar('Elegí o escribí el motivo', 'mal'); return; }
  // Un motivo nuevo queda guardado para la próxima
  if (escrito && !estado.motivos.some(m => m.nombre.toLowerCase() === escrito.toLowerCase())) {
    const orden = estado.motivos.reduce((a, m) => Math.max(a, Number(m.orden) || 0), 0) + 1;
    await db.from('motivos').insert([{ nombre: escrito.slice(0, 40), orden }]);
  }
  await moverStock(pid, -Number($('cantHoja').textContent), 'ajuste', motivo, '➖ Baja anotada');
}

// =====================================================================
//  RESERVAS
// =====================================================================

async function traerReservas() {
  const hace60 = new Date(Date.now() - 60 * 864e5).toISOString();
  const [abiertas, cerradas] = await Promise.all([
    db.from('reservas').select('*').in('estado', ['pendiente', 'activa']).order('created_at', { ascending: false }),
    db.from('reservas').select('*').in('estado', ['entregada', 'cancelada']).gte('created_at', hace60).order('created_at', { ascending: false })
  ]);
  if (abiertas.error) throw abiertas.error;
  estado.reservas = (abiertas.data || []).concat(cerradas.data || []);
  return estado.reservas;
}

function reservaPorId(id) { return estado.reservas.find(r => Number(r.id) === Number(id)); }

function reservasAbiertasDe(pid) {
  return estado.reservas.filter(r => Number(r.producto_id) === Number(pid) && (r.estado === 'pendiente' || r.estado === 'activa'));
}

// Número para WhatsApp: agrega 549 si hace falta (celulares de Argentina)
function numeroWhatsApp(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) return '549' + d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return '549' + d;
  return d;
}

function telefonoLindo(tel) {
  const d = numeroWhatsApp(tel);
  const m = d.match(/^549(11)(\d{4})(\d{4})$/);
  if (m) return `11 ${m[2]}-${m[3]}`;
  const n = d.match(/^549(\d{3,4})(\d{6,7})$/);
  return n ? `(${n[1]}) ${n[2]}` : '+' + d;
}

function hace(fechaIso) {
  const min = Math.round((Date.now() - new Date(fechaIso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

async function actualizarResumenReservas() {
  const op = $('opcionReservas');
  try {
    await traerReservas();
  } catch (e) {
    $('resumenReservas').textContent = 'Todavía no está activado';
    op.classList.remove('alerta');
    return;
  }
  const pend = estado.reservas.filter(r => r.estado === 'pendiente').length;
  const act = estado.reservas.filter(r => r.estado === 'activa').length;
  op.classList.toggle('alerta', pend > 0);
  $('resumenReservas').textContent = pend
    ? `🔔 ${pend} nueva${pend === 1 ? '' : 's'} para confirmar · ${act} activa${act === 1 ? '' : 's'}`
    : act ? `${act} reserva${act === 1 ? '' : 's'} activa${act === 1 ? '' : 's'}` : 'Nadie reservó todavía';
}

async function cargarReservas() {
  $('listaReservas').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    await Promise.all([traerReservas(), traerProductos()]);
    // Si hay nuevas para confirmar, abre esa pestaña
    if (estado.tabReservas === 'activa' && estado.reservas.some(r => r.estado === 'pendiente') && !cargarReservas.yaMostro) {
      estado.tabReservas = 'pendiente';
      cargarReservas.yaMostro = true;
    }
    dibujarReservas();
  } catch (err) {
    console.error(err);
    $('listaReservas').innerHTML = `<p class="vacio">❌ ${escapar(mensajeError(err))}</p>`;
  }
}

function elegirTabReservas(boton) {
  estado.tabReservas = boton.dataset.tab;
  dibujarReservas();
}

function dibujarReservas() {
  const cuenta = t => estado.reservas.filter(r => t === 'cerrada' ? (r.estado === 'entregada' || r.estado === 'cancelada') : r.estado === t).length;
  const nombres = { pendiente: '🔔 Por confirmar', activa: '📌 Activas', cerrada: '📒 Historial' };
  document.querySelectorAll('#tabsReservas button').forEach(b => {
    const t = b.dataset.tab;
    b.classList.toggle('activo', t === estado.tabReservas);
    const n = cuenta(t);
    b.textContent = nombres[t] + (t !== 'cerrada' && n ? ` (${n})` : '');
  });

  const texto = $('buscadorReservas').value.trim().toLowerCase();
  let lista = estado.reservas.filter(r => estado.tabReservas === 'cerrada'
    ? (r.estado === 'entregada' || r.estado === 'cancelada')
    : r.estado === estado.tabReservas);
  if (texto) {
    lista = lista.filter(r => {
      const p = productoPorId(r.producto_id);
      return String(r.cliente).toLowerCase().includes(texto) || (p && p.titulo.toLowerCase().includes(texto)) || String(r.telefono).includes(texto);
    });
  }
  if (estado.tabReservas !== 'cerrada') lista.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  const vacio = { pendiente: 'No hay reservas nuevas de clientes.', activa: 'No hay reservas activas.', cerrada: 'Todavía no hay reservas cerradas.' };
  $('listaReservas').innerHTML = lista.length ? lista.map(tarjetaReserva).join('') : `<p class="vacio">${vacio[estado.tabReservas]}</p>`;
}

function tarjetaReserva(r) {
  const p = productoPorId(r.producto_id) || { titulo: 'Publicación borrada', precio: 0 };
  const rid = Number(r.id);
  const total = Number(p.precio) * Number(r.cantidad);
  const cerrada = r.estado === 'entregada' || r.estado === 'cancelada';
  let botones = '';
  if (r.estado === 'pendiente') {
    botones = `
      <button class="ok" onclick="confirmarReserva(${rid})">✅ Confirmar</button>
      <button class="no" onclick="pantallaCancelarReserva(${rid})">❌ Rechazar</button>
      <button class="wa" onclick="escribirCliente(${rid})">💬</button>`;
  } else if (r.estado === 'activa') {
    botones = `
      <button class="ok" onclick="pantallaEntregar(${rid})">🛍️ Entregada</button>
      <button onclick="pantallaReserva(${Number(r.producto_id)}, ${rid}, 'reservas')">✏️ Editar</button>
      <button class="no" onclick="pantallaCancelarReserva(${rid})">❌ Cancelar</button>
      <button class="wa" onclick="escribirCliente(${rid})">💬</button>`;
  }
  const fechaCierre = r.cerrada_at ? new Date(r.cerrada_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '';
  return `
    <div class="reserva-card ${r.estado === 'pendiente' ? 'pendiente' : ''} ${cerrada ? 'cerrada' : ''}">
      <div class="reserva-top">
        ${p.imagen_url ? `<img src="${escapar(p.imagen_url)}" alt="">` : '<div class="sin-foto">📰</div>'}
        <div><div class="t">${escapar(p.titulo)}</div><div class="c">${r.cantidad} × ${plata(p.precio)} = ${plata(total)}</div></div>
      </div>
      <div class="reserva-cliente">👤 ${escapar(r.cliente)}<span class="tel">📞 ${escapar(telefonoLindo(r.telefono))}</span></div>
      <div class="reserva-chips">
        ${cerrada
          ? `<span class="estado-cerrada">${r.estado === 'entregada' ? '🛍️ Entregada' : '❌ Cancelada'} ${fechaCierre}</span>`
          : `<button class="chip-pago ${r.pagado ? 'si' : 'no'}" onclick="cambiarPagado(${rid})">${r.pagado ? '💵 Pagó' : '⏳ No pagó'}</button>`}
        ${r.origen === 'cliente' ? '<span class="etiqueta">📱 La hizo el cliente</span>' : ''}
        <span class="etiqueta">${hace(r.created_at)}</span>
      </div>
      ${r.nota ? `<div class="reserva-nota">📝 ${escapar(r.nota)}</div>` : ''}
      ${botones ? `<div class="reserva-botones">${botones}</div>` : ''}
    </div>`;
}

// Formulario de reserva hecho por el puesto (nueva o editar)
function pantallaReserva(pid, rid, desde) {
  const p = productoPorId(pid);
  const r = rid ? reservaPorId(rid) : null;
  const max = disponible(p) + (r ? Number(r.cantidad) : 0);
  if (max < 1) { avisar('No quedan disponibles para reservar', 'mal'); return; }
  const volver = desde === 'producto' ? `dibujarHoja(${Number(pid)})` : 'cerrarHoja()';
  mostrarHoja(`
    <h3>${r ? '✏️ Editar reserva' : '📌 Reservar'}</h3>
    <p class="info">${escapar(p.titulo)} · ${plata(p.precio)} c/u · se pueden reservar ${max}</p>
    <p class="mini">¿Cuántos?</p>
    ${selectorCantidad('cantHoja', r ? Number(r.cantidad) : 1, max, Number(p.precio))}
    <p class="mini">¿Para quién?</p>
    <input type="text" id="resNombre" placeholder="Nombre" value="${r ? escapar(r.cliente) : ''}" autocomplete="off" autocapitalize="words">
    <p class="mini">Teléfono</p>
    <input type="tel" id="resTel" placeholder="11 2345 6789" value="${r ? escapar(telefonoLindo(r.telefono)) : ''}" autocomplete="off">
    <p class="mini">¿Pagó?</p>
    <div class="elegir" id="resPago">
      <button type="button" data-v="no" class="${r && r.pagado ? '' : 'activo'}" onclick="elegirPago(this)">⏳ Todavía no</button>
      <button type="button" data-v="si" class="${r && r.pagado ? 'activo' : ''}" onclick="elegirPago(this)">💵 Ya pagó</button>
    </div>
    <p class="mini">Nota (opcional)</p>
    <input type="text" id="resNota" placeholder="Ej: pasa el sábado" value="${r && r.nota ? escapar(r.nota) : ''}" autocomplete="off">
    <div class="acciones espacio-arriba">
      <button class="btn-principal" onclick="guardarReserva(${Number(pid)}, ${rid ? Number(rid) : 'null'})">${r ? '✅ Guardar cambios' : '📌 Reservar'}</button>
      <button class="accion cerrar" onclick="${volver}">Cancelar</button>
    </div>`);
}

function elegirPago(boton) {
  document.querySelectorAll('#resPago button').forEach(b => b.classList.toggle('activo', b === boton));
}

async function guardarReserva(pid, rid) {
  const cant = Number($('cantHoja').textContent);
  const nombre = $('resNombre').value.trim();
  const tel = $('resTel').value.replace(/\D/g, '');
  const pagado = !!document.querySelector('#resPago button.activo[data-v="si"]');
  const nota = $('resNota').value.trim() || null;
  if (!nombre) { avisar('Falta el nombre', 'mal'); $('resNombre').focus(); return; }
  if (tel.length < 8) { avisar('Falta el teléfono con código de área', 'mal'); $('resTel').focus(); return; }

  mostrarCargando('Guardando…');
  const { error } = rid
    ? await db.rpc('editar_reserva', { rid, cant, nombre, tel, pagado, nota })
    : await db.rpc('crear_reserva', { pid, cant, nombre, tel, pagado, nota });
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  cerrarHoja();
  avisar(rid ? '✅ Reserva cambiada' : `📌 Reservado para ${nombre}`);
  refrescar();
}

async function actualizarReserva(rid, cambios, mensajeOk) {
  mostrarCargando('Guardando…');
  const { error } = await db.from('reservas').update(cambios).eq('id', rid);
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return false; }
  if (mensajeOk) avisar(mensajeOk);
  return true;
}

async function cambiarPagado(rid) {
  const r = reservaPorId(rid);
  if (!r) return;
  if (await actualizarReserva(rid, { pagado: !r.pagado }, r.pagado ? '⏳ Marcada como no pagada' : '💵 Marcada como pagada')) {
    r.pagado = !r.pagado;
    dibujarReservas();
  }
}

async function confirmarReserva(rid) {
  const r = reservaPorId(rid);
  if (!(await actualizarReserva(rid, { estado: 'activa' }))) return;
  r.estado = 'activa';
  dibujarReservas();
  mostrarHoja(`
    <div class="exito">✅</div>
    <h3>Reserva confirmada</h3>
    <p class="info">¿Le avisás a ${escapar(r.cliente)} que se la guardás?</p>
    <div class="acciones">
      <button class="btn-principal btn-wa" onclick="escribirCliente(${Number(rid)}, 'confirmar')">💬 Avisarle por WhatsApp</button>
      <button class="accion cerrar" onclick="cerrarHoja()">Listo</button>
    </div>`);
}

function pantallaCancelarReserva(rid) {
  const r = reservaPorId(rid);
  const p = productoPorId(r.producto_id);
  const rechazo = r.estado === 'pendiente';
  mostrarHoja(`
    <h3>${rechazo ? '¿Rechazar la reserva?' : '¿Cancelar la reserva?'}</h3>
    <p class="info">${escapar(r.cliente)} · ${r.cantidad} × ${escapar(p ? p.titulo : '')}<br>
      ${r.cantidad === 1 ? 'Vuelve a estar disponible' : `Las ${r.cantidad} vuelven a estar disponibles`} para vender.</p>
    <div class="acciones">
      <button class="accion peligro" style="text-align:center" onclick="cancelarReserva(${Number(rid)})">${rechazo ? '❌ Sí, rechazar' : '❌ Sí, cancelar'}</button>
      <button class="accion cerrar" onclick="cerrarHoja()">No</button>
    </div>`);
}

async function cancelarReserva(rid) {
  if (!(await actualizarReserva(rid, { estado: 'cancelada', cerrada_at: new Date().toISOString() }, '↩️ Reserva cancelada, el stock volvió'))) return;
  cerrarHoja();
  cargarReservas();
}

function pantallaEntregar(rid) {
  const r = reservaPorId(rid);
  const p = productoPorId(r.producto_id);
  mostrarHoja(`
    <h3>🛍️ ¿${escapar(r.cliente)} ya retiró?</h3>
    <p class="info">${r.cantidad} × ${escapar(p ? p.titulo : '')} = ${plata((p ? Number(p.precio) : 0) * r.cantidad)}<br>
      Se descuenta${r.cantidad === 1 ? '' : 'n'} del stock y queda anotado como venta.
      ${r.pagado ? '' : '<br>⚠️ Figura que todavía no pagó.'}</p>
    <div class="acciones">
      <button class="btn-principal" onclick="entregarReserva(${Number(rid)})">✅ Sí, la entregué</button>
      <button class="accion cerrar" onclick="cerrarHoja()">No</button>
    </div>`);
}

async function entregarReserva(rid) {
  mostrarCargando('Guardando…');
  const { error } = await db.rpc('entregar_reserva', { rid });
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  cerrarHoja();
  avisar('🛍️ Entregada y anotada como venta');
  cargarReservas();
}

function escribirCliente(rid, motivo) {
  const r = reservaPorId(rid);
  const p = productoPorId(r.producto_id);
  const titulo = p ? p.titulo : '';
  const texto = motivo === 'confirmar'
    ? `Hola ${r.cliente}! 👋 Te confirmamos la reserva en ${estado.nombre}:\n📌 ${r.cantidad} × *${titulo}*${p ? ' — ' + plata(Number(p.precio) * r.cantidad) : ''}\n¡Te esperamos!`
    : `Hola ${r.cliente}! 👋 Te escribo de ${estado.nombre} por tu reserva de ${r.cantidad} × *${titulo}*.`;
  abrirWhatsApp(numeroWhatsApp(r.telefono), texto);
}

// Nueva reserva desde la pantalla de reservas: primero elegir qué
function elegirProductoParaReserva() {
  mostrarHoja(`
    <h3>📌 ¿Qué quiere reservar?</h3>
    <input type="search" id="buscaParaReservar" placeholder="🔎 Buscar por nombre" oninput="dibujarListaParaReservar()" autocomplete="off">
    <div class="lista-elegir" id="listaParaReservar"></div>
    <div class="acciones"><button class="accion cerrar" onclick="cerrarHoja()">Cancelar</button></div>`);
  dibujarListaParaReservar();
}

function dibujarListaParaReservar() {
  const lista = filtrarPorTexto(enVenta(), $('buscaParaReservar').value).slice(0, 40);
  $('listaParaReservar').innerHTML = lista.length ? lista.map(p => `
    <button onclick="pantallaReserva(${Number(p.id)}, null, 'reservas')">
      ${p.imagen_url ? `<img src="${escapar(p.imagen_url)}" alt="">` : '<span class="sin-foto">📰</span>'}
      <span>${escapar(p.titulo)}<small>${plata(p.precio)} · ${disponible(p)} disponible${disponible(p) === 1 ? '' : 's'}</small></span>
    </button>`).join('') : '<p class="vacio">No hay nada disponible con ese nombre.</p>';
}

// =====================================================================
//  SELECCIÓN MÚLTIPLE EN EL STOCK
// =====================================================================

const seleccion = { activa: false, ids: new Set(), visibles: [] };

function entrarSeleccion() {
  seleccion.activa = true;
  seleccion.ids.clear();
  document.body.classList.add('con-barra');
  $('barraSeleccion').classList.remove('oculto');
  dibujarStock();
  actualizarBarraSeleccion();
}

function salirSeleccion() {
  seleccion.activa = false;
  seleccion.ids.clear();
  document.body.classList.remove('con-barra');
  $('barraSeleccion').classList.add('oculto');
  if (estado.pantalla === 'stock') dibujarStock();
}

function tocarItem(id) {
  if (!seleccion.activa) { abrirHoja(id); return; }
  id = Number(id);
  if (seleccion.ids.has(id)) seleccion.ids.delete(id); else seleccion.ids.add(id);
  const boton = document.querySelector(`#listaStock .item[data-id="${id}"]`);
  if (boton) {
    const si = seleccion.ids.has(id);
    boton.classList.toggle('elegido', si);
    const marca = boton.querySelector('.marca');
    if (marca) marca.textContent = si ? '✓' : '';
  }
  actualizarBarraSeleccion();
}

function seleccionarTodos() {
  seleccion.visibles.forEach(id => seleccion.ids.add(id));
  dibujarStock();
  actualizarBarraSeleccion();
}

function seleccionarNinguno() {
  seleccion.ids.clear();
  dibujarStock();
  actualizarBarraSeleccion();
}

function actualizarBarraSeleccion() {
  const n = seleccion.ids.size;
  $('cantElegidos').textContent = n === 1 ? '1 elegido' : `${n} elegidos`;
  document.querySelectorAll('.acciones-sel button').forEach(b => { b.disabled = n === 0; });
}

async function accionMasiva(accion) {
  const ids = Array.from(seleccion.ids);
  if (!ids.length) { avisar('Elegí al menos uno', 'mal'); return; }

  if (accion === 'borrar') {
    const conReserva = ids.filter(id => reservasAbiertasDe(id).length).length;
    mostrarHoja(`
      <h3>¿Borrar ${ids.length === 1 ? 'esta publicación' : `estas ${ids.length} publicaciones`}?</h3>
      <p class="info">Se borran de la app con sus fotos y no se puede deshacer.
        ${conReserva ? `<br>⚠️ ${conReserva} tiene${conReserva === 1 ? '' : 'n'} reservas: se cancelan.` : ''}</p>
      <div class="acciones">
        <button class="accion peligro" style="text-align:center" onclick="borrarSeleccion()">🗑️ Sí, borrar ${ids.length}</button>
        <button class="accion cerrar" onclick="cerrarHoja()">No</button>
      </div>`);
    return;
  }

  const cambios = accion === 'nuevo' ? { tipo: 'nuevo', created_at: new Date().toISOString() } : { tipo: 'stock' };
  mostrarCargando('Guardando…');
  const { error } = await db.from('productos').update(cambios).in('id', ids);
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  avisar(accion === 'nuevo' ? `✨ ${ids.length} pasaron a nuevos` : `📦 ${ids.length} pasaron al archivo`);
  salirSeleccion();
  cargarStock();
}

async function borrarSeleccion() {
  const ids = Array.from(seleccion.ids);
  if (await borrarProductos(ids)) salirSeleccion();
}

// =====================================================================
//  VENTAS Y BAJAS (registro) y MOTIVOS
// =====================================================================

async function cargarMovimientos() {
  $('listaMov').innerHTML = '<p class="vacio">Cargando…</p>';
  const hace60 = new Date(Date.now() - 60 * 864e5).toISOString();
  const { data, error } = await db.from('movimientos').select('*').gte('created_at', hace60).order('created_at', { ascending: false });
  if (error) { console.error(error); $('listaMov').innerHTML = `<p class="vacio">❌ ${escapar(mensajeError(error))}</p>`; $('resumenMov').innerHTML = ''; return; }
  estado.movimientos = data || [];
  dibujarMovimientos();
}

function elegirFiltroMov(boton) {
  estado.filtroMov = boton.dataset.f;
  document.querySelectorAll('#filtrosMov .chip').forEach(c => c.classList.toggle('activo', c === boton));
  dibujarMovimientos();
}

function dibujarMovimientos() {
  const hoy = fechaLocalISO(new Date());
  const hace7 = Date.now() - 7 * 864e5;
  const ventas = estado.movimientos.filter(m => m.tipo === 'venta');
  const sumar = lista => lista.reduce((a, m) => a + Number(m.cantidad) * (Number(m.precio) || 0), 0);
  const ventasHoy = ventas.filter(m => fechaLocalISO(new Date(m.created_at)) === hoy);
  const ventas7 = ventas.filter(m => new Date(m.created_at).getTime() >= hace7);
  const bajas7 = estado.movimientos.filter(m => m.tipo === 'ajuste' && new Date(m.created_at).getTime() >= hace7);
  const unidades = lista => lista.reduce((a, m) => a + Number(m.cantidad), 0);
  $('resumenMov').innerHTML = `
    <div><small>Hoy</small><b>${plata(sumar(ventasHoy))}</b><small>${unidades(ventasHoy)} vendidos</small></div>
    <div><small>7 días</small><b>${plata(sumar(ventas7))}</b><small>${unidades(ventas7)} vendidos</small></div>
    <div><small>Bajas</small><b>${unidades(bajas7)}</b><small>últimos 7 días</small></div>`;

  const lista = estado.movimientos.filter(m => estado.filtroMov === 'todo' || m.tipo === estado.filtroMov);
  if (!lista.length) { $('listaMov').innerHTML = '<p class="vacio">Todavía no hay nada anotado.</p>'; return; }
  const iconos = { venta: '🛒', ajuste: '➖', ingreso: '➕' };
  const nombreDia = iso => {
    const d = new Date(iso);
    const f = fechaLocalISO(d);
    if (f === hoy) return 'Hoy';
    if (f === fechaLocalISO(new Date(Date.now() - 864e5))) return 'Ayer';
    return d.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  };
  let html = '';
  let diaActual = '';
  lista.forEach(m => {
    const dia = nombreDia(m.created_at);
    if (dia !== diaActual) { html += `<p class="dia-mov">${escapar(dia)}</p>`; diaActual = dia; }
    const hora = new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const detalle = m.tipo === 'venta' ? 'Venta' : m.tipo === 'ingreso' ? 'Llegaron más' : 'Baja';
    html += `
      <div class="mov">
        <span class="ic">${iconos[m.tipo] || '•'}</span>
        <span class="d"><b>${escapar(m.titulo || 'Publicación borrada')}</b><small>${detalle}${m.motivo ? ' · ' + escapar(m.motivo) : ''} · ${hora}</small></span>
        <span class="n">${m.tipo === 'ingreso' ? '+' : '−'}${m.cantidad}${m.tipo === 'venta' && m.precio ? `<br><small>${plata(Number(m.precio) * m.cantidad)}</small>` : ''}</span>
      </div>`;
  });
  $('listaMov').innerHTML = html;
}

async function cargarMotivos() {
  $('listaMotivos').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    await traerMotivos();
    dibujarMotivos();
  } catch (err) {
    console.error(err);
    $('listaMotivos').innerHTML = `<p class="vacio">❌ ${escapar(mensajeError(err))}</p>`;
  }
}

function dibujarMotivos() {
  $('listaMotivos').innerHTML = estado.motivos.length ? estado.motivos.map(m => `
    <div class="motivo-fila">
      <span>${escapar(m.nombre)}</span>
      <button onclick="editarMotivo(${Number(m.id)})" aria-label="Cambiar">✏️</button>
      <button onclick="pantallaBorrarMotivo(${Number(m.id)})" aria-label="Borrar">🗑️</button>
    </div>`).join('') : '<p class="vacio">No hay motivos. Agregá el primero.</p>';
}

async function agregarMotivo() {
  const nombre = $('nuevoMotivo').value.trim().slice(0, 40);
  if (!nombre) { avisar('Escribí el motivo', 'mal'); return; }
  const orden = estado.motivos.reduce((a, m) => Math.max(a, Number(m.orden) || 0), 0) + 1;
  const { error } = await db.from('motivos').insert([{ nombre, orden }]);
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  $('nuevoMotivo').value = '';
  avisar('✅ Motivo agregado');
  cargarMotivos();
}

function editarMotivo(id) {
  const m = estado.motivos.find(x => Number(x.id) === Number(id));
  mostrarHoja(`
    <h3>✏️ Cambiar motivo</h3>
    <input type="text" id="motivoEditado" value="${escapar(m.nombre)}" autocomplete="off">
    <div class="acciones espacio-arriba">
      <button class="btn-principal btn-azul" onclick="guardarMotivo(${Number(id)})">✅ Guardar</button>
      <button class="accion cerrar" onclick="cerrarHoja()">Cancelar</button>
    </div>`);
  setTimeout(() => $('motivoEditado').focus(), 150);
}

async function guardarMotivo(id) {
  const nombre = $('motivoEditado').value.trim().slice(0, 40);
  if (!nombre) { avisar('Escribí el motivo', 'mal'); return; }
  const { error } = await db.from('motivos').update({ nombre }).eq('id', id);
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  cerrarHoja();
  avisar('✅ Motivo cambiado');
  cargarMotivos();
}

function pantallaBorrarMotivo(id) {
  const m = estado.motivos.find(x => Number(x.id) === Number(id));
  mostrarHoja(`
    <h3>¿Borrar "${escapar(m.nombre)}"?</h3>
    <p class="info">Deja de aparecer al dar de baja. Lo que ya se anotó con este motivo queda igual.</p>
    <div class="acciones">
      <button class="accion peligro" style="text-align:center" onclick="borrarMotivo(${Number(id)})">🗑️ Sí, borrar</button>
      <button class="accion cerrar" onclick="cerrarHoja()">No</button>
    </div>`);
}

async function borrarMotivo(id) {
  const { error } = await db.from('motivos').delete().eq('id', id);
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  cerrarHoja();
  avisar('🗑️ Motivo borrado');
  cargarMotivos();
}

// =====================================================================
//  AJUSTES (nombre del puesto y WhatsApp de pedidos)
// =====================================================================

function llenarAjustes() {
  $('ajusteNombre').value = estado.nombre;
  $('ajusteWhatsapp').value = estado.whatsapp;
}

async function guardarAjustes() {
  const nombre = $('ajusteNombre').value.trim();
  const whatsapp = $('ajusteWhatsapp').value.replace(/\D/g, '');

  if (!nombre) { avisar('Falta el nombre del puesto', 'mal'); return; }
  if (whatsapp.length < 10) { avisar('El WhatsApp parece incompleto', 'mal'); return; }

  mostrarCargando('Guardando…');
  const { error } = await db.from('ajustes').upsert({ id: 1, nombre, whatsapp });
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }

  estado.nombre = nombre;
  estado.whatsapp = whatsapp;
  guardarAjusteLocal('nombre', nombre);
  guardarAjusteLocal('whatsapp', whatsapp);
  aplicarNombre();
  avisar('✅ Ajustes guardados');
  irA('inicio', false);
  if (history.state && history.state.pantalla) history.back();
}

// =====================================================================
//  RÁFAGAS (publicaciones programadas en redes)
// =====================================================================

const NOMBRES_DIAS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const ICONOS_RED = { whatsapp: '💬', instagram: '📸', facebook: '👍', telegram: '✈️' };
const NOMBRES_RED = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', telegram: 'Telegram' };

const rafagasEstado = { lista: [], historial: [], editando: null, actual: null };

async function traerRafagas() {
  const hace14 = new Date(Date.now() - 14 * 864e5).toISOString();
  const [r, h] = await Promise.all([
    db.from('rafagas').select('*').order('hora', { ascending: true }),
    db.from('publicaciones').select('*').gte('publicado_at', hace14).order('publicado_at', { ascending: false })
  ]);
  if (r.error) throw r.error;
  rafagasEstado.lista = r.data || [];
  rafagasEstado.historial = h.error ? [] : (h.data || []);
}

function fechaLocalISO(d) {
  const z = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

function minutosDe(hora) {
  const [h, m] = String(hora || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function rafagaSaleHoy(r, ahora = new Date()) {
  if (!r.activa) return false;
  if (!(r.dias || []).includes(ahora.getDay())) return false;
  const hoy = fechaLocalISO(ahora);
  if (r.desde && hoy < r.desde) return false;
  if (r.hasta && hoy > r.hasta) return false;
  return true;
}

function rafagaHechaHoy(r, red = 'whatsapp') {
  const hoy = fechaLocalISO(new Date());
  return rafagasEstado.historial.some(x =>
    Number(x.rafaga_id) === Number(r.id) && x.red === red && fechaLocalISO(new Date(x.publicado_at)) === hoy);
}

function estadoRafaga(r) {
  if (!rafagaSaleHoy(r)) return { clase: '', texto: 'Hoy no sale' };
  const ahora = new Date();
  const yaEsHora = minutosDe(r.hora) <= ahora.getHours() * 60 + ahora.getMinutes();
  if (rafagaHechaHoy(r)) return { clase: 'hecha', texto: '✓ Hecha hoy' };
  const sePaso = r.hora_hasta && minutosDe(r.hora_hasta) < ahora.getHours() * 60 + ahora.getMinutes();
  if (sePaso) return { clase: '', texto: 'Se pasó la hora' };
  if (yaEsHora) return { clase: 'pendiente', texto: 'Pendiente' };
  return { clase: '', texto: 'Más tarde' };
}

// ---------- La elección: qué se publica en cada ráfaga ----------

function mezclar(lista) {
  const a = lista.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Tipos de publicación dentro de una ráfaga, en el orden en que se eligen
const TIPOS_RAFAGA = [
  { campo: 'cant_nuevos', id: 'rfNuevos', icono: '✨', nombre: 'nuevos' },
  { campo: 'cant_interes', id: 'rfInteres', icono: '🔥', nombre: 'alto interés' },
  { campo: 'cant_poca_rotacion', id: 'rfPoca', icono: '🐢', nombre: 'poca rotación' },
  { campo: 'cant_colecciones', id: 'rfColecciones', icono: '📚', nombre: 'colecciones' },
  { campo: 'cant_azar', id: 'rfAzar', icono: '🎲', nombre: 'al azar' }
];

// Cantidades de cada tipo (también entiende ráfagas guardadas con el formato viejo)
function cantidades(r) {
  const c = {};
  TIPOS_RAFAGA.forEach(t => { c[t.campo] = Number(r[t.campo]) || 0; });
  const nuevosCampos = TIPOS_RAFAGA.slice(1).some(t => c[t.campo] > 0);
  if (!nuevosCampos && Number(r.cant_stock) > 0) {
    const mapa = { mas_consultados: 'cant_interes', menos_rotacion: 'cant_poca_rotacion', colecciones: 'cant_colecciones', azar: 'cant_azar' };
    c[mapa[r.criterio_stock] || 'cant_azar'] = Number(r.cant_stock);
  }
  return c;
}

function totalRafaga(r) {
  const c = cantidades(r);
  return Object.values(c).reduce((a, b) => a + b, 0);
}

function elegirParaRafaga(r) {
  const ahora = Date.now();
  const diasMin = estado.diasSinRepetir;
  const c = cantidades(r);
  const ultimaVez = {};
  rafagasEstado.historial.forEach(x => {
    const t = new Date(x.publicado_at).getTime();
    if (!ultimaVez[x.producto_id] || t > ultimaVez[x.producto_id]) ultimaVez[x.producto_id] = t;
  });
  const diasDesdeUltima = p => ultimaVez[p.id] ? (ahora - ultimaVez[p.id]) / 864e5 : Infinity;
  const puntos = p => Number(p.visitas) || 0;
  const usados = new Set();
  const marcar = lista => { lista.forEach(p => usados.add(p.id)); return lista; };

  // 1) Nuevos ingresos: se promocionan todos los días durante su semana (no aplica la regla de no repetir).
  //    Solo evita repetir uno que ya salió en las últimas 6 horas. Primero los que hace más que no salen.
  const nuevos = marcar(mezclar(enVenta().filter(esNovedad))
    .filter(p => diasDesdeUltima(p) > 0.25)
    .sort((a, b) => diasDesdeUltima(b) - diasDesdeUltima(a))
    .slice(0, c.cant_nuevos));

  // 2) El resto: SOLO lo que no salió en los últimos N días. Se respeta siempre;
  //    si no alcanza, la ráfaga sale con menos.
  const libres = () => enVenta().filter(p => !esNovedad(p) && !usados.has(p.id) && diasDesdeUltima(p) >= diasMin);
  const grupoDe = (lista, cuantos) => Math.max(cuantos * 2, Math.ceil(lista.length * 0.3));

  // Alto interés: al azar dentro de los que más puntos tienen. Sin puntos todavía: al azar.
  let sinPuntos = false;
  let interes = [];
  if (c.cant_interes) {
    const disp = libres();
    const conPuntos = disp.filter(p => puntos(p) > 0);
    sinPuntos = !conPuntos.length;
    const grupo = mezclar(conPuntos).sort((a, b) => puntos(b) - puntos(a)).slice(0, grupoDe(disp, c.cant_interes));
    interes = mezclar(grupo).slice(0, c.cant_interes);
    if (interes.length < c.cant_interes) {
      interes = interes.concat(mezclar(disp.filter(p => !interes.includes(p))).slice(0, c.cant_interes - interes.length));
    }
    marcar(interes);
  }

  // Poca rotación: al azar dentro de los que menos puntos tienen
  let poca = [];
  if (c.cant_poca_rotacion) {
    const disp = libres();
    const grupo = mezclar(disp).sort((a, b) => puntos(a) - puntos(b)).slice(0, grupoDe(disp, c.cant_poca_rotacion));
    poca = marcar(mezclar(grupo).slice(0, c.cant_poca_rotacion));
  }

  // Colecciones: números de colecciones al azar
  const colecciones = c.cant_colecciones ? marcar(mezclar(libres().filter(p => p.serie_id)).slice(0, c.cant_colecciones)) : [];

  // Al azar: cualquier cosa que quede
  const azar = c.cant_azar ? marcar(mezclar(libres()).slice(0, c.cant_azar)) : [];

  const grupos = [
    { tipo: TIPOS_RAFAGA[0], lista: nuevos },
    { tipo: TIPOS_RAFAGA[1], lista: interes },
    { tipo: TIPOS_RAFAGA[2], lista: poca },
    { tipo: TIPOS_RAFAGA[3], lista: colecciones },
    { tipo: TIPOS_RAFAGA[4], lista: azar }
  ];
  const faltan = grupos
    .map(g => ({ tipo: g.tipo, faltan: c[g.tipo.campo] - g.lista.length }))
    .filter(f => f.faltan > 0);

  return {
    grupos,
    productos: grupos.flatMap(g => g.lista),
    faltan,
    sinPuntos
  };
}

// ---------- Aviso en el inicio para Adrián ----------

async function revisarRafagasPendientes() {
  const caja = $('avisoRafaga');
  try {
    await traerRafagas();
  } catch (e) {
    caja.classList.add('oculto');   // todavía no hay ráfagas configuradas
    return;
  }
  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const pendientes = rafagasEstado.lista
    .filter(r => (r.redes || []).includes('whatsapp'))
    .filter(r => rafagaSaleHoy(r) && minutosDe(r.hora) <= minutosAhora && !rafagaHechaHoy(r))
    .filter(r => !r.hora_hasta || minutosAhora <= minutosDe(r.hora_hasta))
    .sort((a, b) => minutosDe(b.hora) - minutosDe(a.hora));

  if (!pendientes.length) { caja.classList.add('oculto'); return; }
  const r = pendientes[0];
  const total = totalRafaga(r);
  caja.innerHTML = `
    <button class="aviso-rafaga" onclick="abrirCompartir(${Number(r.id)})">
      <span class="icono">📣</span>
      <span><span class="tit">¡Hora de publicar!</span>
      <span class="sub">Ráfaga de las ${escapar(r.hora)}${r.hora_hasta ? ' (hasta las ' + escapar(r.hora_hasta) + ')' : ''} · ${total} historias para tu estado de WhatsApp</span></span>
    </button>`;
  caja.classList.remove('oculto');
}

// ---------- Imagen de historia (1080 × 1920) con tapa, precio y WhatsApp ----------

function cargarImagen(src) {
  return new Promise(resolve => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function partirTexto(ctx, texto, ancho) {
  const palabras = String(texto).split(/\s+/);
  const lineas = [];
  let linea = '';
  palabras.forEach(w => {
    const prueba = linea ? linea + ' ' + w : w;
    if (ctx.measureText(prueba).width > ancho && linea) { lineas.push(linea); linea = w; }
    else linea = prueba;
  });
  if (linea) lineas.push(linea);
  return lineas;
}

function rectRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function generarHistoria(p) {
  const W = 1080, H = 1920;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const fuente = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  // Fondo
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#6f1416');
  g.addColorStop(1, '#9f1d20');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Logo del puesto (si no carga, el nombre en texto)
  ctx.textAlign = 'center';
  const logo = await cargarImagen('logo.png');
  if (logo) ctx.drawImage(logo, W / 2 - 95, 20, 190, 190);
  else {
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 64px ${fuente}`;
    ctx.fillText(estado.nombre, W / 2, 150);
  }

  // Tapa
  const img = await cargarImagen(p.imagen_url);
  const maxW = 760, maxH = 960, topY = 220;
  let w = maxW, h = maxH;
  if (img) {
    const esc = Math.min(maxW / img.width, maxH / img.height);
    w = img.width * esc; h = img.height * esc;
  }
  const x = (W - w) / 2, y = topY + (maxH - h) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
  ctx.fillStyle = '#ffffff';
  rectRedondo(ctx, x - 14, y - 14, w + 28, h + 28, 26);
  ctx.fill();
  ctx.restore();
  if (img) {
    ctx.save();
    rectRedondo(ctx, x, y, w, h, 16);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  } else {
    ctx.font = `200px ${fuente}`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('📰', W / 2, y + h / 2 + 70);
  }

  // Sello "NUEVO"
  if (esNovedad(p)) {
    ctx.save();
    ctx.translate(x + w - 10, y + 40);
    ctx.rotate(0.18);
    ctx.fillStyle = '#facc15';
    rectRedondo(ctx, -150, -55, 300, 110, 55);
    ctx.fill();
    ctx.fillStyle = '#7c2d12';
    ctx.font = `900 62px ${fuente}`;
    ctx.fillText('¡NUEVO!', 0, 22);
    ctx.restore();
  }

  // Título
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 62px ${fuente}`;
  const lineas = partirTexto(ctx, p.titulo, 940).slice(0, 2);
  lineas.forEach((l, i) => ctx.fillText(l, W / 2, 1300 + i * 76));

  // Precio
  const precioTxt = plata(p.precio);
  ctx.font = `900 130px ${fuente}`;
  const pw = ctx.measureText(precioTxt).width + 110;
  const py = 1370 + lineas.length * 76;
  ctx.fillStyle = '#facc15';
  rectRedondo(ctx, (W - pw) / 2, py, pw, 180, 90);
  ctx.fill();
  ctx.fillStyle = '#1e293b';
  ctx.fillText(precioTxt, W / 2, py + 134);

  // Pie con WhatsApp
  ctx.fillStyle = '#16a34a';
  rectRedondo(ctx, 90, H - 196, W - 180, 136, 68);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 52px ${fuente}`;
  ctx.fillText('💬 Pedilo por WhatsApp', W / 2, H - 138);
  ctx.font = `600 42px ${fuente}`;
  ctx.fillText(formatearTelefono(estado.whatsapp), W / 2, H - 84);

  return new Promise(resolve => c.toBlob(b => resolve(b), 'image/jpeg', 0.88));
}

function formatearTelefono(n) {
  const d = String(n || '').replace(/\D/g, '');
  const m = d.match(/^549(11)(\d{4})(\d{4})$/);
  return m ? `11 ${m[2]}-${m[3]}` : '+' + d;
}

// ---------- Pantalla para compartir la ráfaga ----------

async function abrirCompartir(id) {
  const r = rafagasEstado.lista.find(x => Number(x.id) === Number(id));
  if (!r) return;
  irA('compartir');
  await armarRafagaActual(r);
}

async function armarRafagaActual(r) {
  const eleccion = elegirParaRafaga(r);
  const productos = eleccion.productos;
  rafagasEstado.actual = { rafaga: r, productos, blobs: [] };

  $('compartirTexto').textContent = productos.length
    ? `Ráfaga de las ${r.hora}: ${productos.length} historias. Tocá el botón verde, elegí WhatsApp y después "Mi estado".`
    : 'Todavía no hay nada cargado para publicar.';
  $('btnCompartirRafaga').disabled = !productos.length;
  $('historiasPrevia').innerHTML = productos.map(() => '<div class="cargando-hist"></div>').join('');

  const urls = [];
  for (const p of productos) {
    const blob = await generarHistoria(p);
    rafagasEstado.actual.blobs.push(blob);
    urls.push(URL.createObjectURL(blob));
    $('historiasPrevia').innerHTML = urls.map(u => `<img src="${u}" alt="">`).join('') +
      productos.slice(urls.length).map(() => '<div class="cargando-hist"></div>').join('');
  }
}

function cambiarSeleccionRafaga() {
  if (rafagasEstado.actual) armarRafagaActual(rafagasEstado.actual.rafaga);
}

async function compartirRafaga() {
  const a = rafagasEstado.actual;
  if (!a || !a.blobs.length) return;
  if (a.blobs.length < a.productos.length) { avisar('Esperá que terminen de prepararse las fotos', 'info'); return; }

  const archivos = a.blobs.map((b, i) => new File([b], `historia-${i + 1}.jpg`, { type: 'image/jpeg' }));
  if (navigator.canShare && navigator.canShare({ files: archivos })) {
    try {
      await navigator.share({ files: archivos });
      await marcarRafagaPublicada();
    } catch (e) {
      if (e && e.name !== 'AbortError') avisar('No se pudo abrir para compartir', 'mal');
    }
  } else {
    avisar('Este teléfono no permite compartir varias fotos juntas. Llamá a Rodrigo.', 'mal', 5000);
  }
}

async function marcarRafagaPublicada() {
  const a = rafagasEstado.actual;
  if (!a) return;
  const filas = a.productos.map(p => ({ rafaga_id: a.rafaga.id, producto_id: p.id, red: 'whatsapp' }));
  if (filas.length) {
    const { error } = await db.from('publicaciones').insert(filas);
    if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  }
  avisar('✅ ¡Ráfaga publicada!');
  rafagasEstado.actual = null;
  irA('inicio', false);
  if (history.state && history.state.pantalla) history.back();
}

// ---------- Lista y editor de ráfagas (para Rodrigo) ----------

async function cargarRafagas() {
  $('listaRafagas').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    await Promise.all([traerRafagas(), traerProductos()]);
    dibujarRafagas();
  } catch (err) {
    console.error(err);
    $('listaRafagas').innerHTML = '<p class="vacio">Las ráfagas todavía no están activadas en la base. Hay que correr rafagas.sql en Supabase.</p>';
    $('historialRafagas').innerHTML = '';
  }
}

function textoCantidades(r) {
  const c = cantidades(r);
  return TIPOS_RAFAGA.filter(t => c[t.campo] > 0).map(t => `${t.icono} ${c[t.campo]} ${t.nombre}`).join(' + ') || 'vacía';
}

function textoVigencia(r) {
  const f = d => d ? d.split('-').reverse().slice(0, 2).join('/') : '';
  if (r.desde && r.hasta) return `del ${f(r.desde)} al ${f(r.hasta)}`;
  if (r.desde) return `desde el ${f(r.desde)}`;
  return `hasta el ${f(r.hasta)}`;
}

function textoDias(dias) {
  const d = (dias || []).slice().sort();
  if (d.length === 7) return 'Todos los días';
  if (d.join() === '1,2,3,4,5') return 'Lunes a viernes';
  if (d.join() === '0,6') return 'Fines de semana';
  return [1, 2, 3, 4, 5, 6, 0].filter(x => d.includes(x)).map(x => NOMBRES_DIAS[x]).join(' ');
}

async function cambiarDiasSinRepetir(delta) {
  const nuevo = Math.max(1, Math.min(14, estado.diasSinRepetir + delta));
  if (nuevo === estado.diasSinRepetir) return;
  const { error } = await db.from('ajustes').update({ dias_sin_repetir: nuevo }).eq('id', 1);
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  estado.diasSinRepetir = nuevo;
  guardarAjusteLocal('dias_sin_repetir', nuevo);
  $('diasSinRepetir').textContent = nuevo;
}

function dibujarRafagas() {
  $('diasSinRepetir').textContent = estado.diasSinRepetir;
  const lista = rafagasEstado.lista.slice().sort((a, b) => minutosDe(a.hora) - minutosDe(b.hora));
  $('listaRafagas').innerHTML = lista.length ? lista.map(r => {
    const est = estadoRafaga(r);
    const redes = (r.redes || []).map(x => ICONOS_RED[x] || '').join(' ');
    return `
      <button class="rafaga-item ${r.activa ? '' : 'apagada'}" onclick="editarRafaga(${Number(r.id)})">
        <span class="hora">${escapar(r.hora)}</span>
        <span class="datos">
          <span class="estado-rafaga ${est.clase}">${est.texto}</span>
          <span class="nombre">${escapar(r.nombre)}</span>
          <span class="redes-linea">${redes}</span>
          <span class="detalle">${escapar(textoCantidades(r))} · ${escapar(textoDias(r.dias))}${r.hora_hasta ? ' · hasta ' + escapar(r.hora_hasta) : ''}${r.borrar_horas ? ' · dura ' + r.borrar_horas + ' h' : ''}${r.desde || r.hasta ? ' · ' + escapar(textoVigencia(r)) : ''}${r.activa ? '' : ' · apagada'}</span>
        </span>
      </button>`;
  }).join('') : '<p class="vacio">No hay ráfagas. Creá la primera.</p>';

  const hist = rafagasEstado.historial.slice(0, 20);
  $('historialRafagas').innerHTML = hist.length ? hist.map(x => {
    const p = productoPorId(x.producto_id);
    const d = new Date(x.publicado_at);
    const cuando = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return `<div><span>${ICONOS_RED[x.red] || ''} ${escapar(p ? p.titulo : 'Producto borrado')}</span><span>${cuando}</span></div>`;
  }).join('') : '<p class="ayuda-campo">Todavía no se publicó nada.</p>';
}

function marcarChips(contenedor, atributo, valores) {
  document.querySelectorAll(`#${contenedor} button`).forEach(b => {
    const v = b.dataset[atributo];
    b.classList.toggle('activo', valores.map(String).includes(String(v)));
    b.onclick = () => { b.classList.toggle('activo'); };
  });
}

function leerChips(contenedor, atributo, numerico) {
  return Array.from(document.querySelectorAll(`#${contenedor} button.activo`)).map(b => numerico ? Number(b.dataset[atributo]) : b.dataset[atributo]);
}

function sumar(id, delta) {
  const el = $(id);
  el.value = el.textContent = String(Math.max(0, Math.min(30, Number(el.textContent) + delta)));
  actualizarTotalRafaga();
}

function actualizarTotalRafaga() {
  const total = TIPOS_RAFAGA.reduce((a, t) => a + Number($(t.id).textContent), 0);
  $('rfTotal').textContent = `Total: ${total} publicacion${total === 1 ? '' : 'es'} por ráfaga`;
}

function editarRafaga(id) {
  const r = id ? rafagasEstado.lista.find(x => Number(x.id) === Number(id)) : {
    nombre: '', activa: true, hora: '20:00', dias: [0, 1, 2, 3, 4, 5, 6], desde: null, hasta: null,
    hora_hasta: null, cant_nuevos: 2, cant_interes: 4, cant_poca_rotacion: 2, cant_colecciones: 0, cant_azar: 2,
    redes: ['whatsapp'], borrar_horas: null
  };
  rafagasEstado.editando = id || null;
  irA('rafaga');
  $('tituloPantalla').textContent = id ? '✏️ ' + r.nombre : '➕ Nueva ráfaga';
  $('rfNombre').value = r.nombre;
  $('rfActiva').checked = !!r.activa;
  $('rfHora').value = r.hora;
  $('rfDesde').value = r.desde || '';
  $('rfHasta').value = r.hasta || '';
  const cant = cantidades(r);
  TIPOS_RAFAGA.forEach(t => { $(t.id).textContent = cant[t.campo]; });
  $('rfHoraHasta').value = r.hora_hasta || '';
  $('rfBorrar').value = r.borrar_horas ? String(r.borrar_horas) : '';
  marcarChips('rfDias', 'dia', r.dias || []);
  marcarChips('rfRedes', 'red', r.redes || []);
  $('rfBorrarBtn').classList.toggle('oculto', !id);
  actualizarTotalRafaga();
}

function rafagaDelFormulario() {
  const datos = {
    nombre: $('rfNombre').value.trim() || 'Ráfaga ' + $('rfHora').value,
    activa: $('rfActiva').checked,
    hora: $('rfHora').value || '20:00',
    dias: leerChips('rfDias', 'dia', true),
    desde: $('rfDesde').value || null,
    hasta: $('rfHasta').value || null,
    hora_hasta: $('rfHoraHasta').value || null,
    redes: leerChips('rfRedes', 'red', false),
    borrar_horas: $('rfBorrar').value ? Number($('rfBorrar').value) : null,
    cant_stock: 0   // formato viejo: ya no se usa
  };
  TIPOS_RAFAGA.forEach(t => { datos[t.campo] = Number($(t.id).textContent); });
  return datos;
}

async function guardarRafaga() {
  const datos = rafagaDelFormulario();
  if (!datos.dias.length) { avisar('Elegí al menos un día', 'mal'); return; }
  if (!datos.redes.length) { avisar('Elegí al menos una red', 'mal'); return; }
  if (totalRafaga(datos) === 0) { avisar('La ráfaga no publica nada: subí alguna cantidad', 'mal'); return; }
  if (datos.hora_hasta && minutosDe(datos.hora_hasta) <= minutosDe(datos.hora)) { avisar('La hora "hasta" tiene que ser después de "desde"', 'mal'); return; }
  if (datos.desde && datos.hasta && datos.hasta < datos.desde) { avisar('La fecha "hasta" es antes que "desde"', 'mal'); return; }

  mostrarCargando('Guardando…');
  const id = rafagasEstado.editando;
  const { error } = id
    ? await db.from('rafagas').update(datos).eq('id', id)
    : await db.from('rafagas').insert([datos]);
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  avisar('✅ Ráfaga guardada');
  volver();
}

function previsualizarRafaga() {
  const r = rafagaDelFormulario();
  const e = elegirParaRafaga(r);
  const fila = (p, t) => `<div>${p.imagen_url ? `<img src="${escapar(p.imagen_url)}" alt="">` : '📰'}
    <span>${escapar(p.titulo)} <span class="tag">${t.icono} ${escapar(t.nombre)}</span></span></div>`;
  const avisos = e.faltan.map(f => f.tipo.campo === 'cant_nuevos'
    ? `ℹ️ ${f.faltan} nuevo${f.faltan === 1 ? '' : 's'} menos de lo pedido: no hay más lanzamientos esta semana.`
    : `⚠️ Faltan ${f.faltan} de ${f.tipo.nombre}: lo demás ya salió en los últimos ${estado.diasSinRepetir} días. Para no repetir, sale con menos.`);
  if (e.sinPuntos) avisos.push('🎲 Todavía nadie sumó puntos de interés, así que "alto interés" elige al azar.');
  $('hojaContenido').innerHTML = `
    <h3>Si saliera ahora</h3>
    <p class="info">${e.productos.length} publicaciones: ${escapar(e.grupos.filter(g => g.lista.length).map(g => g.tipo.icono + ' ' + g.lista.length + ' ' + g.tipo.nombre).join(' + ') || 'ninguna')}.
      ${avisos.map(a => '<br>' + a).join('')}
      <br>Cada vez que sale, la elección cambia.</p>
    <div class="lista-previa">${e.grupos.map(g => g.lista.map(p => fila(p, g.tipo)).join('')).join('')}</div>
    <div class="acciones">
      <button class="accion" onclick="previsualizarRafaga()">🔄 Probar otra vez</button>
      <button class="accion cerrar" onclick="cerrarHoja()">Cerrar</button>
    </div>`;
  if ($('hoja').classList.contains('oculto')) {
    $('hoja').classList.remove('oculto');
    history.pushState({ hoja: true }, '');
  }
}

function confirmarBorrarRafaga() {
  $('hojaContenido').innerHTML = `
    <h3>¿Borrar esta ráfaga?</h3>
    <p class="info">Deja de publicarse. Lo que ya se publicó queda en el historial.</p>
    <div class="acciones">
      <button class="accion peligro" style="text-align:center" onclick="borrarRafaga()">🗑️ Sí, borrar</button>
      <button class="accion cerrar" onclick="cerrarHoja()">No</button>
    </div>`;
  $('hoja').classList.remove('oculto');
  history.pushState({ hoja: true }, '');
}

async function borrarRafaga() {
  const id = rafagasEstado.editando;
  if (!id) return;
  mostrarCargando('Borrando…');
  const { error } = await db.from('rafagas').delete().eq('id', id);
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  $('hoja').classList.add('oculto');
  avisar('🗑️ Ráfaga borrada');
  history.go(-2);   // saca la hoja y el editor: vuelve a la lista
}

// =====================================================================
//  REDES DEL PUESTO (cuentas y tutorial para crearlas)
// =====================================================================

const REDES = [
  {
    id: 'whatsapp', icono: '💬', nombre: 'WhatsApp',
    campo: null,
    ayuda: 'No hace falta cargar nada: las ráfagas se comparten desde el teléfono de Adrián a su estado, y los pedidos llegan al número de Ajustes.',
    automatica: false
  },
  {
    id: 'instagram', icono: '📸', nombre: 'Instagram',
    campo: 'Usuario', ejemplo: '@lodeadri',
    ayuda: 'El usuario de la cuenta del puesto, con @.',
    url: v => 'https://instagram.com/' + v.replace(/^@/, ''),
    automatica: true
  },
  {
    id: 'facebook', icono: '👍', nombre: 'Facebook',
    campo: 'Página', ejemplo: 'facebook.com/lodeadri',
    ayuda: 'El enlace de la página del puesto (no tu perfil personal).',
    url: v => /^https?:\/\//.test(v) ? v : 'https://' + v.replace(/^\/+/, ''),
    automatica: true
  },
  {
    id: 'telegram', icono: '✈️', nombre: 'Telegram',
    campo: 'Canal', ejemplo: '@lodeadri',
    ayuda: 'El canal público del puesto, con @.',
    url: v => 'https://t.me/' + v.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, ''),
    automatica: true
  },
  {
    id: 'tiktok', icono: '🎵', nombre: 'TikTok',
    campo: 'Usuario', ejemplo: '@lodeadri',
    ayuda: 'Solo se muestra en el catálogo. TikTok no deja publicar historias automáticas.',
    url: v => 'https://www.tiktok.com/@' + v.replace(/^@/, ''),
    automatica: false
  }
];

const TUTORIALES = {
  whatsapp: {
    titulo: '💬 WhatsApp del puesto',
    pasos: [
      'No hace falta crear nada nuevo: se usa el WhatsApp del teléfono de Adrián.',
      'Recomendado: instalar <b>WhatsApp Business</b> (es gratis) con el número del puesto. Permite poner horario, dirección y un mensaje de bienvenida automático.',
      'En la app, en <b>Ajustes</b>, revisá que el número de "WhatsApp para pedidos" sea el del puesto, con 549 adelante (ej: 5491126467210).',
      'Las ráfagas se publican en el estado: cuando llega la hora, a Adrián le aparece el botón naranja "¡Hora de publicar!". Lo toca, elige WhatsApp y después "Mi estado".'
    ],
    nota: 'WhatsApp no permite publicar estados solos desde otra app. Por eso siempre es con un toque de Adrián.'
  },
  instagram: {
    titulo: '📸 Cuenta de Instagram',
    pasos: [
      'Bajá la app <b>Instagram</b> y tocá <b>Crear cuenta nueva</b>. Usá un mail del puesto (no el personal).',
      'Elegí el usuario: algo fácil como <code>lodeadri</code> o <code>lodeadri.diarios</code>.',
      'Foto de perfil: el logo del sello (lo podés bajar del catálogo o pedírselo a Rodrigo).',
      'Pasala a <b>cuenta profesional</b>: Perfil → menú ☰ → <b>Configuración</b> → <b>Tipo de cuenta y herramientas</b> → <b>Cambiar a cuenta profesional</b> → <b>Empresa</b>. Categoría: "Kiosco de revistas" o "Tienda".',
      'En la biografía poné la dirección del puesto, el horario y el link del catálogo.',
      'Vinculala con la página de Facebook del puesto (ver el tutorial de Facebook). Es obligatorio para que más adelante las ráfagas salgan solas.',
      'Volvé acá y cargá el usuario con @.'
    ],
    nota: 'Los nombres de los menús pueden cambiar un poco según la versión de Instagram.'
  },
  facebook: {
    titulo: '👍 Página de Facebook',
    pasos: [
      'Entrá a Facebook con tu cuenta personal (la página queda a tu nombre como administrador, pero se ve como el puesto).',
      'Menú ☰ → <b>Páginas</b> → <b>Crear página</b>.',
      'Nombre: <b>Lo de Adri</b>. Categoría: "Puesto de periódicos" o "Tienda de revistas".',
      'Cargá el logo como foto de perfil, la dirección, el horario y el WhatsApp.',
      'Para vincular Instagram: en la página, <b>Configuración</b> → <b>Cuentas vinculadas</b> → <b>Instagram</b> → <b>Conectar cuenta</b>.',
      'Copiá el enlace de la página (ej: <code>facebook.com/lodeadri</code>) y cargalo acá.'
    ],
    nota: 'Para que las ráfagas salgan solas en Facebook e Instagram, Rodrigo tiene que dar un permiso desde Meta una sola vez. Eso lo hacemos juntos cuando las dos cuentas estén creadas.'
  },
  telegram: {
    titulo: '✈️ Canal de Telegram',
    pasos: [
      'Bajá <b>Telegram</b> y creá una cuenta con tu número.',
      'Tocá el lápiz ✏️ → <b>Nuevo canal</b>. Nombre: <b>Lo de Adri</b>. Descripción: qué vendés y el horario.',
      'Elegí <b>Canal público</b> y el enlace, por ejemplo <code>t.me/lodeadri</code>.',
      'Para que las ráfagas salgan solas: buscá <b>@BotFather</b> (tiene tilde azul), escribile <code>/newbot</code>, poné un nombre (ej: "Lo de Adri ráfagas") y un usuario que termine en <code>bot</code>.',
      'BotFather te da un código largo (la "llave" del bot). <b>No lo publiques ni lo mandes por chat</b>: guardalo para cargarlo en Supabase con Rodrigo.',
      'Entrá al canal → <b>Administradores</b> → <b>Agregar administrador</b> → buscá tu bot → dejá activado <b>Publicar mensajes</b>.',
      'Volvé acá y cargá el canal con @.'
    ],
    nota: 'Telegram es la red más fácil para publicar sola: con el canal y la llave del bot ya funciona.'
  },
  tiktok: {
    titulo: '🎵 Cuenta de TikTok',
    pasos: [
      'Bajá <b>TikTok</b> y creá una cuenta con el mail del puesto.',
      'Perfil → <b>Editar perfil</b>: nombre "Lo de Adri", el logo y el link del catálogo en la biografía.',
      'Opcional: Configuración → <b>Cuenta</b> → <b>Cambiar a cuenta de empresa</b>.',
      'Cargá el usuario acá para que aparezca en el catálogo.'
    ],
    nota: 'TikTok no deja publicar historias automáticas desde otra app, así que no entra en las ráfagas.'
  }
};

function valorRed(id) {
  return String((estado.redes || {})[id] || '').trim();
}

function estadoRed(r) {
  if (!r.campo) return { clase: 'ok', texto: 'Listo' };
  if (!valorRed(r.id)) return { clase: '', texto: 'Sin cargar' };
  return r.automatica ? { clase: 'falta', texto: 'Falta conectar' } : { clase: 'ok', texto: 'Cargada' };
}

function dibujarRedes() {
  $('listaRedes').innerHTML = REDES.map(r => {
    const est = estadoRed(r);
    const v = valorRed(r.id);
    return `
      <div class="red-tarjeta">
        <div class="red-cab"><span class="ic">${r.icono}</span><span class="n">${escapar(r.nombre)}</span><span class="red-estado ${est.clase}">${est.texto}</span></div>
        <p class="ayuda-campo">${escapar(r.ayuda)}</p>
        ${r.campo ? `<label class="mini" for="red-${r.id}">${escapar(r.campo)}</label>
          <input type="text" id="red-${r.id}" value="${escapar(v)}" placeholder="${escapar(r.ejemplo)}" autocomplete="off" autocapitalize="none">` : ''}
        <div class="red-botones">
          <button class="btn-sec" onclick="abrirTutorial('${r.id}')">📖 Cómo se hace</button>
          ${r.campo && v ? `<a class="btn-sec" style="text-align:center;text-decoration:none;color:inherit" href="${escapar(r.url(v))}" target="_blank" rel="noopener">🔗 Ver cuenta</a>` : ''}
        </div>
      </div>`;
  }).join('');
}

function abrirTutorial(id) {
  const t = TUTORIALES[id];
  if (!t) return;
  mostrarHoja(`
    <div class="tutorial">
      <h3>${t.titulo}</h3>
      <ol>${t.pasos.map(p => `<li>${p}</li>`).join('')}</ol>
      ${t.nota ? `<div class="nota">ℹ️ ${t.nota}</div>` : ''}
      <div class="acciones"><button class="accion cerrar" onclick="cerrarHoja()">Entendido</button></div>
    </div>`);
}

function limpiarCuenta(id, v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (id === 'instagram' || id === 'tiktok' || id === 'telegram') {
    v = v.replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com|t\.me)\/@?/i, '').replace(/\/.*$/, '').replace(/^@/, '');
    return v ? '@' + v : '';
  }
  if (id === 'facebook') return v.replace(/^https?:\/\/(www\.|m\.)?/i, '').replace(/\/$/, '');
  return v;
}

async function guardarRedes() {
  const redes = {};
  REDES.filter(r => r.campo).forEach(r => {
    const v = limpiarCuenta(r.id, $('red-' + r.id).value);
    if (v) redes[r.id] = v;
  });
  mostrarCargando('Guardando…');
  const { error } = await db.from('ajustes').update({ redes }).eq('id', 1);
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }
  estado.redes = redes;
  dibujarRedes();
  dibujarRedesCatalogo();
  avisar('✅ Redes guardadas');
}

// En el catálogo: "Seguinos en…"
function dibujarRedesCatalogo() {
  const caja = $('catRedes');
  if (!caja) return;
  caja.innerHTML = REDES.filter(r => r.campo && valorRed(r.id)).map(r =>
    `<a href="${escapar(r.url(valorRed(r.id)))}" target="_blank" rel="noopener">${r.icono} ${escapar(r.nombre)}</a>`).join('');
}

// =====================================================================
//  WHATSAPP
// =====================================================================

function compartirCatalogo() {
  const texto =
    '¡Hola! 👋 Te paso lo que tenemos en ' + estado.nombre + ' 📰\n\n' +
    'Mirá el catálogo con fotos y precios acá:\n' + LINK_CATALOGO + '\n\n' +
    'Si algo te interesa, tocá "Pedir" y te lo guardamos.';
  // Sin número: WhatsApp le pregunta a quién mandarlo
  abrirWhatsApp('', texto);
}

function compartirProducto(id) {
  const p = productoPorId(id);
  if (!p) return;
  let texto = `📰 *${p.titulo}*\n💲 ${plata(p.precio)}\n`;
  if (p.imagen_url) texto += `\n${p.imagen_url}\n`;
  texto += `\nTenemos esto en ${estado.nombre}. ¿Te lo guardo?\n\nVer todo: ${LINK_CATALOGO}`;
  abrirWhatsApp('', texto);
}

function compartirSerie(id) {
  const serie = serieDe(id);
  if (!serie) return;
  const cant = numerosDeSerie(id, true).length;
  abrirWhatsApp('', `📚 *${serie.nombre}*\nTenemos ${cant} número${cant === 1 ? '' : 's'} en ${estado.nombre}.\n\nMirá las tapas acá:\n${LINK_CATALOGO}#serie-${serie.id}`);
}

function pedirAyuda() {
  abrirWhatsApp(NUMERO_SOPORTE, 'Hola Rodrigo, necesito ayuda con la app del puesto.');
}

// =====================================================================
//  CATÁLOGO PÚBLICO (lo que ven los clientes, sin poder modificar nada)
// =====================================================================

// Filtros que elige el cliente
const filtroCliente = { ver: 'todo', orden: 'nuevos', serie: null };

async function arrancarCatalogo() {
  irA('catalogo', false);
  $('catalogo').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    await traerProductos();
    dibujarFiltrosCliente();
    // Link directo a una colección: ...?catalogo#serie-12
    const m = location.hash.match(/^#serie-(\d+)$/);
    if (m && numerosDeSerie(m[1], true).length) abrirSerie(Number(m[1]), false);
    else dibujarCatalogo();
  } catch (err) {
    console.error(err);
    $('catalogo').innerHTML = '<p class="vacio">No se pudo cargar el catálogo. Probá de nuevo en un rato.</p>';
  }
}

// Lo que ve el cliente: cosas sueltas + una tarjeta por colección
function entradasCatalogo(texto) {
  const t = (texto || '').trim().toLowerCase();
  const coincide = p => coincideBusqueda(p, texto);
  const entradas = [];
  const grupos = {};
  enVenta().filter(coincide).forEach(p => {
    const serie = p.serie_id ? serieDe(p.serie_id) : null;
    if (serie) (grupos[serie.id] = grupos[serie.id] || []).push(p);
    else entradas.push({ tipo: 'producto', p, nombre: p.titulo, categoria: p.categoria, precio: Number(p.precio), fecha: p.created_at, nuevo: esNovedad(p) });
  });
  Object.keys(grupos).forEach(id => {
    const serie = serieDe(id);
    const items = grupos[id];
    entradas.push({
      tipo: 'serie', serie, items,
      nombre: serie.nombre,
      categoria: serie.categoria,
      precio: Math.min(...items.map(p => Number(p.precio))),
      fecha: items.map(p => p.created_at).sort().pop(),
      nuevo: items.some(esNovedad)
    });
  });
  return entradas;
}

// Solo muestra los filtros que tienen algo adentro
function dibujarFiltrosCliente() {
  const todas = entradasCatalogo('');
  const opciones = [{ valor: 'todo', texto: 'Todo', cant: todas.length }];
  const nuevos = todas.filter(e => e.nuevo).length;
  if (nuevos) opciones.push({ valor: 'nuevos', texto: '✨ Recién llegados', cant: nuevos });
  Object.keys(CATEGORIAS_PLURAL).forEach(cat => {
    const cant = todas.filter(e => e.categoria === cat).length;
    if (cant) opciones.push({ valor: cat, texto: CATEGORIAS_PLURAL[cat], cant });
  });
  if (!opciones.some(o => o.valor === filtroCliente.ver)) filtroCliente.ver = 'todo';

  $('filtrosCliente').innerHTML = opciones.map(o => `
    <button class="chip ${o.valor === filtroCliente.ver ? 'activo' : ''}" data-valor="${escapar(o.valor)}"
      onclick="elegirFiltroCliente(this)">${escapar(o.texto)} <span>${o.cant}</span></button>
  `).join('');
}

function elegirFiltroCliente(boton) {
  filtroCliente.ver = boton.dataset.valor;
  document.querySelectorAll('#filtrosCliente .chip').forEach(c => c.classList.toggle('activo', c === boton));
  dibujarCatalogo();
}

function elegirOrdenCliente(select) {
  filtroCliente.orden = select.value;
  dibujarCatalogo();
}

function ordenarEntradas(lista) {
  const copia = lista.slice();
  if (filtroCliente.orden === 'barato') copia.sort((a, b) => a.precio - b.precio);
  else if (filtroCliente.orden === 'caro') copia.sort((a, b) => b.precio - a.precio);
  else if (filtroCliente.orden === 'nombre') copia.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));
  else copia.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return copia;
}

function tarjetaCatalogo(p, enSerie) {
  const titulo = enSerie && (p.numero || p.detalle)
    ? (p.numero ? `<div class="numero-grande">N° ${escapar(p.numero)}</div>` : '') +
      (p.detalle ? `<div class="${p.numero ? 'detalle-cat' : 'titulo'}">${escapar(p.detalle)}</div>` : '')
    : `<div class="titulo">${escapar(p.titulo)}</div>`;
  return `
    <div class="producto">
      ${esNovedad(p) ? '<span class="sello-nuevo">Nuevo</span>' : ''}
      <button class="ver-detalle" onclick="verProducto(${Number(p.id)})" aria-label="Ver ${escapar(p.titulo)}">
        ${p.imagen_url
          ? `<img src="${escapar(p.imagen_url)}" alt="${escapar(p.titulo)}" loading="lazy">`
          : '<div class="sin-foto">📰</div>'}
      </button>
      <div class="cuerpo" onclick="if (event.target.tagName !== 'BUTTON') verProducto(${Number(p.id)})">
        ${titulo}
        ${disponible(p) <= 2 && cantidadDe(p) >= 3 ? `<span class="ultimos">¡Quedan ${disponible(p)}!</span>` : ''}
        <div class="precio">${plata(p.precio)}</div>
        <button class="pedir" onclick="abrirPedido(${Number(p.id)})">📌 Reservar</button>
      </div>
    </div>`;
}

function tarjetaSerie(e) {
  const portada = portadaDeSerie(e.serie);
  const cant = e.items.length;
  const precios = new Set(e.items.map(p => Number(p.precio)));
  return `
    <button class="producto es-serie" onclick="abrirSerie(${Number(e.serie.id)})">
      ${e.nuevo ? '<span class="sello-nuevo">Números nuevos</span>' : ''}
      <div class="tapa">
        ${portada ? `<img src="${escapar(portada)}" alt="${escapar(e.serie.nombre)}" loading="lazy">` : '<div class="sin-foto">📚</div>'}
        <span class="sello-cant">📚 ${cant} número${cant === 1 ? '' : 's'}</span>
      </div>
      <div class="cuerpo">
        <div class="titulo">${escapar(e.serie.nombre)}</div>
        <div class="desde">${precios.size > 1 ? 'Desde ' : ''}<span class="precio">${plata(e.precio)}</span></div>
        <div class="ver-numeros">Ver números ›</div>
      </div>
    </button>`;
}

function grillaEntradas(lista) {
  return '<div class="grilla">' + lista.map(e => e.tipo === 'serie' ? tarjetaSerie(e) : tarjetaCatalogo(e.p)).join('') + '</div>';
}

function mostrarControlesCatalogo(visible) {
  ['buscadorCatalogo', 'filtrosCliente', 'barraOrden', 'catalogo'].forEach(id => $(id).classList.toggle('oculto', !visible));
  document.querySelector('.cat-intro').classList.toggle('oculto', !visible);
  $('vistaSerie').classList.toggle('oculto', visible);
}

function dibujarCatalogo() {
  mostrarControlesCatalogo(true);
  let lista = entradasCatalogo($('buscadorCatalogo').value);
  const ver = filtroCliente.ver;
  if (ver === 'nuevos') lista = lista.filter(e => e.nuevo);
  else if (ver !== 'todo') lista = lista.filter(e => e.categoria === ver);
  lista = ordenarEntradas(lista);

  $('contadorCatalogo').textContent = lista.length === 1 ? '1 publicación' : lista.length + ' publicaciones';

  if (lista.length === 0) {
    $('catalogo').innerHTML = '<p class="vacio">No encontramos nada. Probá con otro filtro o nombre.</p>';
    return;
  }

  // Con un filtro elegido o un orden por precio/nombre: una sola grilla
  if (ver !== 'todo' || filtroCliente.orden !== 'nuevos') {
    $('catalogo').innerHTML = grillaEntradas(lista);
    return;
  }

  // Sin filtros: recién llegados arriba y el resto por categoría
  let html = '';
  const novedades = lista.filter(e => e.nuevo);
  if (novedades.length) html += '<h2 class="seccion-tit">✨ Recién llegados</h2>' + grillaEntradas(novedades);

  const resto = lista.filter(e => !e.nuevo);
  Object.keys(CATEGORIAS).concat(['_resto']).forEach(cat => {
    const grupo = cat === '_resto'
      ? resto.filter(e => !CATEGORIAS[e.categoria])
      : resto.filter(e => e.categoria === cat);
    if (!grupo.length) return;
    const nombre = cat === '_resto' ? '📦 Más cosas' : CATEGORIAS_PLURAL[cat];
    html += `<h2 class="seccion-tit">${escapar(nombre)}</h2>` + grillaEntradas(grupo);
  });

  $('catalogo').innerHTML = html;
}

// ---------- Dentro de una colección: todos los números con sus tapas ----------

function abrirSerie(id, agregarHistorial = true) {
  const serie = serieDe(id);
  if (!serie) return;
  filtroCliente.serie = Number(id);
  const items = numerosDeSerie(id, true).sort(compararNumero);
  const portada = portadaDeSerie(serie);

  $('vistaSerie').innerHTML = `
    <button class="btn-todas" onclick="cerrarSerie()">◀ Ver todo el catálogo</button>
    <div class="serie-cabecera">
      ${portada ? `<img src="${escapar(portada)}" alt="">` : '<div class="sin-foto">📚</div>'}
      <div>
        <h2>${escapar(serie.nombre)}</h2>
        <p>${items.length} número${items.length === 1 ? '' : 's'} disponible${items.length === 1 ? '' : 's'}</p>
      </div>
    </div>
    <div class="grilla">${items.map(p => tarjetaCatalogo(p, true)).join('')}</div>
  `;
  mostrarControlesCatalogo(false);
  window.scrollTo(0, 0);
  if (agregarHistorial) history.pushState({ serie: id }, '');
}

function cerrarSerie(volverHistorial = true) {
  filtroCliente.serie = null;
  dibujarCatalogo();
  if (volverHistorial && history.state && history.state.serie) history.back();
}

// Puntos de interés: ver un titular suma 1, pedirlo suma 3.
// Cada persona suma una sola vez por publicación (lo recuerda su navegador).
const PUNTOS_VER = 1;
const PUNTOS_PEDIR = 3;

function sumarInteres(p, tipo, puntos) {
  const clave = 'interes_' + tipo + '_' + p.id;
  try {
    if (localStorage.getItem(clave)) return;
    localStorage.setItem(clave, '1');
  } catch (e) { /* sin memoria del navegador: suma igual */ }
  db.rpc('sumar_interes', { pid: p.id, puntos }).then(r => {
    if (r && r.error) db.rpc('sumar_visita', { pid: p.id }).then(() => {}, () => {});
  }, () => {});
}

function verProducto(id) {
  const p = productoPorId(id);
  if (!p) return;
  sumarInteres(p, 'ver', PUNTOS_VER);
  const disp = disponible(p);
  mostrarHoja(`
    ${p.imagen_url ? `<img src="${escapar(p.imagen_url)}" alt="${escapar(p.titulo)}" class="foto-detalle">` : ''}
    ${esNovedad(p) ? '<span class="etiqueta nuevo">✨ Recién llegado</span>' : ''}
    <h3>${escapar(p.titulo)}</h3>
    <p class="precio-detalle">${plata(p.precio)}</p>
    ${p.descripcion ? `<p class="descripcion-detalle">${escapar(p.descripcion)}</p>` : ''}
    <div class="acciones">
      ${disp
        ? `<button class="btn-principal" onclick="abrirPedido(${Number(p.id)})">📌 Reservar</button>`
        : '<p class="info">Se agotó 😕</p>'}
      <button class="accion wa" onclick="pedirProducto(${Number(p.id)})">💬 Consultar por WhatsApp</button>
      <button class="accion cerrar" onclick="cerrarHoja()">Seguir mirando</button>
    </div>`);
}

// El cliente reserva solo: queda "por confirmar" hasta que el puesto la acepte
function abrirPedido(id) {
  const p = productoPorId(id);
  if (!p) return;
  const disp = disponible(p);
  if (disp < 1) { verProducto(id); return; }
  let nombre = '', tel = '';
  try { nombre = localStorage.getItem('cliente_nombre') || ''; tel = localStorage.getItem('cliente_tel') || ''; } catch (e) {}
  const max = Math.min(disp, 5);
  mostrarHoja(`
    <div class="pedido-cab">
      ${p.imagen_url ? `<img src="${escapar(p.imagen_url)}" alt="">` : ''}
      <div><h3>${escapar(p.titulo)}</h3><p class="precio-detalle chico">${plata(p.precio)}</p></div>
    </div>
    <p class="mini">¿Cuántos querés?</p>
    ${selectorCantidad('cantHoja', 1, max, Number(p.precio))}
    <p class="mini">Tu nombre</p>
    <input type="text" id="cliNombre" value="${escapar(nombre)}" placeholder="Nombre" autocomplete="name" autocapitalize="words">
    <p class="mini">Tu WhatsApp</p>
    <input type="tel" id="cliTel" value="${escapar(tel)}" placeholder="11 2345 6789" autocomplete="tel">
    <p class="ayuda-campo">Te lo guardamos y el puesto te confirma por WhatsApp.</p>
    <div class="acciones espacio-arriba">
      <button class="btn-principal" onclick="reservarCliente(${Number(p.id)})">📌 Reservar <span data-cant-de="cantHoja">1</span></button>
      <button class="accion wa" onclick="pedirProducto(${Number(p.id)})">💬 Prefiero consultar por WhatsApp</button>
      <button class="accion cerrar" onclick="cerrarHoja()">Seguir mirando</button>
    </div>`);
}

let ultimaReservaCliente = null;

async function reservarCliente(id) {
  const p = productoPorId(id);
  const cant = Number($('cantHoja').textContent);
  const nombre = $('cliNombre').value.trim();
  const tel = $('cliTel').value.replace(/\D/g, '');
  if (!nombre) { avisar('Falta tu nombre', 'mal'); $('cliNombre').focus(); return; }
  if (tel.length < 8) { avisar('Falta tu WhatsApp con código de área', 'mal'); $('cliTel').focus(); return; }
  try { localStorage.setItem('cliente_nombre', nombre); localStorage.setItem('cliente_tel', $('cliTel').value.trim()); } catch (e) {}

  mostrarCargando('Reservando…');
  const { error } = await db.rpc('crear_reserva', { pid: p.id, cant, nombre, tel, pagado: false, nota: null });
  ocultarCargando();
  if (error) { console.error(error); avisar('❌ ' + mensajeError(error), 'mal', 5000); return; }

  sumarInteres(p, 'pedir', PUNTOS_PEDIR);
  p.reservado = reservadoDe(p) + cant;
  ultimaReservaCliente = { nombre, cant, titulo: p.titulo, total: cant * Number(p.precio) };
  if (filtroCliente.serie) abrirSerie(filtroCliente.serie, false);
  else { dibujarFiltrosCliente(); dibujarCatalogo(); }

  mostrarHoja(`
    <div class="exito">✅</div>
    <h3>¡Listo, ${escapar(nombre)}!</h3>
    <p class="info">Te reservamos ${cant} × ${escapar(p.titulo)}.<br>El puesto te va a confirmar por WhatsApp.</p>
    <div class="acciones">
      <button class="btn-principal btn-wa" onclick="avisarReserva()">💬 Avisar al puesto por WhatsApp</button>
      <button class="accion cerrar" onclick="cerrarHoja()">Seguir mirando</button>
    </div>`);
}

function avisarReserva() {
  const r = ultimaReservaCliente;
  if (!r) return;
  abrirWhatsApp(estado.whatsapp, `Hola! 👋 Soy ${r.nombre}. Reservé desde el catálogo:\n📌 ${r.cant} × *${r.titulo}* — ${plata(r.total)}\n¿Me confirman?`);
}

function pedirProducto(id) {
  const p = productoPorId(id);
  if (!p) return;
  sumarInteres(p, 'pedir', PUNTOS_PEDIR);
  abrirWhatsApp(estado.whatsapp,
    `Hola! 👋 Me interesa:\n📰 *${p.titulo}* — ${plata(p.precio)}\n¿Lo tienen disponible?`);
}

// =====================================================================
//  ARRANQUE
// =====================================================================

function arrancarAdmin() {
  saludar();
  irA('inicio', false);
}

async function iniciar() {
  aplicarTema(temaGuardado());
  if ($('versionApp')) $('versionApp').textContent = 'Versión ' + VERSION_APP;
  aplicarNombre();
  cargarAjustes();

  if (MODO_CATALOGO) {
    arrancarCatalogo();
    return;
  }

  const { data } = await db.auth.getSession();
  if (data && data.session) {
    arrancarAdmin();
  } else {
    irA('login', false);
  }

  // Si la sesión se pierde por algún motivo, vuelve a pedir el ingreso
  db.auth.onAuthStateChange((evento, sesion) => {
    if (evento === 'SIGNED_OUT' || (!sesion && estado.pantalla !== 'login')) irA('login', false);
  });

  // Enter en el login
  $('loginClave').addEventListener('keydown', e => { if (e.key === 'Enter') ingresar(); });
}

// Service worker: siempre trae la última versión cuando hay internet.
// Revisa al abrir la app y cada vez que se vuelve a ella; si hay versión nueva, recarga sola.
if ('serviceWorker' in navigator) {
  let registro = null;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      registro = reg;
      reg.update();
    }).catch(err => console.warn('SW no registrado', err));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && registro) registro.update().catch(() => {});
  });

  let recargado = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargado) return;
    recargado = true;
    try { avisar('🔄 Actualizando la app…', 'info', 1500); } catch (e) {}
    setTimeout(() => location.reload(), 300);
  });
}

iniciar();
