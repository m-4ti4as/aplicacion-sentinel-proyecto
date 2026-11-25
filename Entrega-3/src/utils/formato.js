'use strict';

// Utilidades de formato usadas por las vistas EJS.

const pad = (n) => String(n).padStart(2, '0');

/** 24-10-26, 9:37 p. m. (formato de las capturas del informe) */
function fechaHora(d) {
  if (!d) return '—';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  let h = x.getHours();
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}-${String(x.getFullYear()).slice(2)}, ${h}:${pad(x.getMinutes())} ${sufijo}`;
}

function fecha(d) {
  if (!d) return '—';
  const x = d instanceof Date ? d : new Date(d);
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}-${x.getFullYear()}`;
}

/** Valor para <input type="datetime-local"> en hora local. */
function inputDateTime(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

const numero = (n) => Number(n || 0).toLocaleString('es-CL');

/** Clase CSS del badge de severidad o criticidad. */
function claseNivel(nombre) {
  const n = String(nombre || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.startsWith('crit')) return 'critica';
  if (n.startsWith('alt')) return 'alta';
  if (n.startsWith('med')) return 'media';
  return 'baja';
}

function claseEstado(estado, esFinal) {
  if (esFinal) return 'cerrado';
  if (estado === 'Reportado') return 'nuevo';
  return 'curso';
}

/** FUERA_HORARIO -> FUERA HORARIO */
const regla = (r) => String(r || '').replace(/_/g, ' ');

const nombreCompleto = (u) => (u ? `${u.nombre} ${u.apellido}`.trim() : '—');

/** Construye una URL de listado conservando los filtros actuales. */
function qs(base, params, cambios = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...cambios })) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

const ZONA = process.env.TZ || 'America/Santiago';

module.exports = { ZONA, fechaHora, fecha, inputDateTime, numero, claseNivel, claseEstado, regla, nombreCompleto, qs };
