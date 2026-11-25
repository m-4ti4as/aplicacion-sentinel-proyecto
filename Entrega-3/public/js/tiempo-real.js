/* SentinelData - eventos web dinámicos con Socket.IO.
   El servidor publica alertas, eventos de acceso e incidentes; esta capa
   actualiza indicadores, listas y avisos sin recargar la página.
   Todo el contenido recibido se inserta con textContent (nunca innerHTML)
   para impedir XSS aunque un dato venga manipulado. */
(function () {
  'use strict';
  if (typeof io === 'undefined') return;

  var socket = io({ transports: ['websocket', 'polling'] });
  var indicador = document.getElementById('live-indicator');
  var toasts = document.getElementById('toasts');
  var metaZona = document.querySelector('meta[name="zona-horaria"]');
  var metaCsrf = document.querySelector('meta[name="csrf-token"]');

  socket.on('connect', function () { if (indicador) indicador.hidden = false; });
  socket.on('disconnect', function () { if (indicador) indicador.hidden = true; });

  // -------------------------------------------------------------------
  // Utilidades de DOM
  // -------------------------------------------------------------------
  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }
  function fechaHora(iso) {
    // Misma zona horaria que las fechas que arma el servidor.
    var p = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: metaZona ? metaZona.content : undefined, hourCycle: 'h23',
      year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    var h = parseInt(p.hour, 10);
    var suf = h < 12 ? 'a. m.' : 'p. m.';
    return p.day + '-' + p.month + '-' + p.year + ', ' + (h % 12 || 12) + ':' + p.minute + ' ' + suf;
  }
  function claseNivel(n) {
    n = String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (n.indexOf('crit') === 0) return 'critica';
    if (n.indexOf('alt') === 0) return 'alta';
    if (n.indexOf('med') === 0) return 'media';
    return 'baja';
  }
  function sumarKpi(nombre, delta) {
    var n = document.querySelector('[data-kpi="' + nombre + '"]');
    if (!n) return;
    var actual = parseInt(n.textContent.replace(/\D/g, ''), 10) || 0;
    n.textContent = Math.max(0, actual + delta).toLocaleString('es-CL');
    n.classList.remove('kpi-bump');
    void n.offsetWidth; // reinicia la animación
    n.classList.add('kpi-bump');
  }

  /** Aviso emergente que desaparece solo. */
  function aviso(titulo, texto, nivel, enlace) {
    if (!toasts) return;
    var t = el('div', 'toast toast-' + (nivel || 'info'));
    t.appendChild(el('strong', null, titulo));
    if (texto) t.appendChild(el('p', null, texto));
    if (enlace) {
      var a = el('a', null, 'Ver detalle ›');
      a.href = enlace;
      t.appendChild(a);
    }
    var cerrar = el('button', 'toast-close', '×');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar aviso');
    cerrar.addEventListener('click', function () { t.remove(); });
    t.appendChild(cerrar);
    toasts.appendChild(t);
    while (toasts.children.length > 4) toasts.removeChild(toasts.firstChild);
    setTimeout(function () { t.classList.add('toast-out'); }, 7000);
    setTimeout(function () { t.remove(); }, 7600);
  }

  // -------------------------------------------------------------------
  // Alertas (administradores)
  // -------------------------------------------------------------------
  var lista = document.getElementById('lista-alertas');

  function itemAlerta(a) {
    var li = el('li', 'alert-item alert-new');
    li.setAttribute('data-alerta-id', a.id);
    li.appendChild(el('span', 'badge badge-' + claseNivel(a.severidad), a.severidad));
    var cuerpo = el('div', 'alert-body');
    cuerpo.appendChild(el('strong', null, String(a.regla).replace(/_/g, ' ')));
    cuerpo.appendChild(el('p', null, a.descripcion));
    var meta = el('p', 'meta', fechaHora(a.fecha));
    if (a.ip) {
      meta.appendChild(document.createTextNode(' · '));
      var link = el('a', null, 'ver eventos de ' + a.ip);
      link.href = '/admin/eventos?ip=' + encodeURIComponent(a.ip);
      meta.appendChild(link);
    }
    cuerpo.appendChild(meta);
    if (metaCsrf) {
      var form = el('form');
      form.method = 'post';
      form.action = '/admin/alertas/' + encodeURIComponent(a.id) + '/revisar';
      [['_csrf', metaCsrf.content], ['volver', lista.getAttribute('data-volver') || '/admin/alertas']].forEach(function (p) {
        var i = document.createElement('input');
        i.type = 'hidden';
        i.name = p[0];
        i.value = p[1];
        form.appendChild(i);
      });
      var b = el('button', 'btn btn-light btn-sm', 'Marcar revisada');
      b.type = 'submit';
      form.appendChild(b);
      cuerpo.appendChild(form);
    }
    li.appendChild(cuerpo);
    return li;
  }

  socket.on('alerta:nueva', function (a) {
    sumarKpi('alertas', 1);
    if (lista && lista.getAttribute('data-live') === '1') {
      lista.insertBefore(itemAlerta(a), lista.firstChild);
      var max = parseInt(lista.getAttribute('data-max'), 10) || 20;
      while (lista.children.length > max) lista.removeChild(lista.lastChild);
      var vacio = document.querySelector('[data-alertas-vacio]');
      if (vacio) vacio.hidden = true;
    }
    var nivel = claseNivel(a.severidad);
    aviso('Nueva alerta: ' + String(a.regla).replace(/_/g, ' '), a.descripcion,
      nivel === 'critica' || nivel === 'alta' ? 'danger' : 'warn', '/admin/alertas');
  });

  socket.on('alerta:revisada', function (a) {
    sumarKpi('alertas', -1);
    if (!lista) return;
    var li = lista.querySelector('[data-alerta-id="' + a.id + '"]');
    if (li && lista.getAttribute('data-live') === '1') li.remove();
  });

  socket.on('cuenta:bloqueada', function (c) {
    sumarKpi('bloqueadas', 1);
    aviso('Cuenta bloqueada', c.email + ' fue bloqueada por intentos fallidos.', 'danger', '/admin/usuarios?q=' + encodeURIComponent(c.email));
  });

  // -------------------------------------------------------------------
  // Eventos de acceso en vivo (administradores)
  // -------------------------------------------------------------------
  var tbody = document.getElementById('eventos-tbody');
  var MALOS = ['LOGIN_FALLIDO', 'CUENTA_BLOQUEADA', 'ACCESO_DENEGADO'];

  socket.on('evento:nuevo', function (e) {
    sumarKpi('eventos7d', 1);
    if (e.codigo === 'LOGIN_FALLIDO') sumarKpi('fallos24h', 1);
    if (!tbody || tbody.getAttribute('data-live') !== '1') return;

    var tr = el('tr', 'row-new');
    var celdas = [
      ['Fecha', fechaHora(e.fecha), 'nowrap'],
      ['Evento', e.evento, MALOS.indexOf(e.codigo) >= 0 ? 'text-danger' : ''],
      ['Usuario', e.email || '—', ''],
    ];
    celdas.forEach(function (c) {
      var td = el('td', c[2], c[1]);
      td.setAttribute('data-label', c[0]);
      tr.appendChild(td);
    });
    var tdIp = el('td');
    tdIp.setAttribute('data-label', 'IP');
    var a = el('a');
    a.href = '/admin/eventos?ip=' + encodeURIComponent(e.ip);
    a.appendChild(el('code', null, e.ip));
    tdIp.appendChild(a);
    tr.appendChild(tdIp);
    var tdUa = el('td', 'truncate', e.userAgent || '—');
    tdUa.setAttribute('data-label', 'Navegador');
    tdUa.title = e.userAgent || '';
    tr.appendChild(tdUa);

    var vacia = tbody.querySelector('td.empty');
    if (vacia) vacia.parentNode.remove();
    tbody.insertBefore(tr, tbody.firstChild);
    var max = parseInt(tbody.getAttribute('data-max'), 10) || 25;
    while (tbody.children.length > max) tbody.removeChild(tbody.lastChild);
  });

  // -------------------------------------------------------------------
  // Incidentes
  // -------------------------------------------------------------------
  socket.on('incidente:nuevo', function (i) {
    sumarKpi('abiertos', 1);
    aviso('Nuevo incidente ' + i.codigo, i.titulo + ' · ' + i.severidad + ' · reportado por ' + i.reportadoPor, 'info', '/incidentes/' + encodeURIComponent(i.id));
  });

  socket.on('incidente:cerrado', function () {
    sumarKpi('abiertos', -1);
  });

  // Para el colaborador: su incidente cambió.
  socket.on('incidente:actualizado', function (i) {
    var texto = i.cambioEstado
      ? 'Ahora está «' + i.estado + '». Actualizado por ' + i.autor + '.'
      : i.autor + ' agregó un comentario.';
    aviso('Tu incidente ' + i.codigo, texto, 'ok', '/incidentes/' + encodeURIComponent(i.id));
  });
})();
