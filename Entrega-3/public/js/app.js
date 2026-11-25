/* SentinelData - interactividad del cliente, sin dependencias.
   La validación aquí solo mejora la experiencia: el servidor
   vuelve a validar todo. */
(function () {
  'use strict';

  // -------------------------------------------------------------------
  // Menú lateral en móviles
  // -------------------------------------------------------------------
  var menuBtn = document.getElementById('menu-btn');
  var overlay = document.getElementById('overlay');
  function setMenu(abierto) {
    document.body.classList.toggle('nav-open', abierto);
    if (overlay) overlay.hidden = !abierto;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  }
  if (menuBtn) menuBtn.addEventListener('click', function () { setMenu(!document.body.classList.contains('nav-open')); });
  if (overlay) overlay.addEventListener('click', function () { setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  // -------------------------------------------------------------------
  // Mostrar / ocultar contraseña
  // -------------------------------------------------------------------
  document.querySelectorAll('[data-toggle-password]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-toggle-password'));
      if (!input) return;
      var mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      btn.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  });

  // -------------------------------------------------------------------
  // Indicador de fortaleza de contraseña
  // -------------------------------------------------------------------
  function puntaje(v) {
    var p = 0;
    if (v.length >= 8) p++;
    if (v.length >= 12) p++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) p++;
    if (/\d/.test(v)) p++;
    if (/[^A-Za-z0-9]/.test(v)) p++;
    return p; // 0..5
  }
  var colores = ['#dc2626', '#dc2626', '#f97316', '#eab308', '#22c55e', '#16a34a'];
  document.querySelectorAll('[data-strength]').forEach(function (input) {
    var field = input.closest('.field');
    var barra = field && field.querySelector('.strength span');
    if (!barra) return;
    input.addEventListener('input', function () {
      var p = input.value ? Math.max(1, puntaje(input.value)) : 0;
      barra.style.width = (p * 20) + '%';
      barra.style.backgroundColor = colores[p];
    });
  });

  // -------------------------------------------------------------------
  // Contador de caracteres
  // -------------------------------------------------------------------
  document.querySelectorAll('textarea[data-counter]').forEach(function (ta) {
    var out = document.querySelector('[data-counter-for="' + ta.id + '"]');
    var max = ta.getAttribute('maxlength');
    function act() { if (out) out.textContent = ta.value.length + ' / ' + max + ' caracteres'; }
    ta.addEventListener('input', act);
    act();
  });

  // -------------------------------------------------------------------
  // Validación de formularios al salir de cada campo y al enviar
  // -------------------------------------------------------------------
  var POLITICA = 'Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo';
  // La hora la fija el servidor (hora de Chile): se compara con el atributo max más
  // el tiempo que lleva abierta la página, sin depender de la zona horaria del equipo.
  var CARGA = Date.now();
  function esFutura(el, v) {
    var tope = new Date(el.getAttribute('max') || Date.now()).getTime() + (Date.now() - CARGA) + 5 * 60000;
    return new Date(v).getTime() > tope;
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function mensaje(el) {
    var v = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value.trim();
    if (el.required && !v) {
      return el.getAttribute('data-msg-required') || 'Este campo es obligatorio';
    }
    if (!v) return '';
    if (el.type === 'email' && !EMAIL_RE.test(v)) return 'El formato no es válido';
    var min = el.getAttribute('minlength');
    if (min && v.length < Number(min)) {
      return el.getAttribute('data-msg-minlength') || ('Debe tener al menos ' + min + ' caracteres');
    }
    var pat = el.getAttribute('pattern');
    if (pat && !new RegExp('^(?:' + pat + ')$').test(v)) {
      return el.getAttribute('data-msg-pattern') || 'El formato no es válido';
    }
    if (el.hasAttribute('data-password-policy')) {
      var raw = el.value;
      if (raw.length < 8 || !/[a-z]/.test(raw) || !/[A-Z]/.test(raw) || !/\d/.test(raw) || !/[^A-Za-z0-9]/.test(raw)) {
        return POLITICA;
      }
    }
    var match = el.getAttribute('data-match');
    if (match) {
      var otro = document.getElementById(match);
      if (otro && otro.value !== el.value) return 'Las contraseñas no coinciden';
    }
    if (el.hasAttribute('data-max-now') && esFutura(el, v)) {
      return el.getAttribute('data-msg-max') || 'La fecha no puede ser futura';
    }
    return '';
  }

  function mostrar(el, msg) {
    var field = el.closest('.field');
    var out = field && field.querySelector('[data-error-for="' + el.name + '"]');
    if (el.type !== 'checkbox') el.classList.toggle('invalid', !!msg);
    if (out) {
      out.textContent = msg;
      out.hidden = !msg;
    }
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  }

  document.querySelectorAll('form[data-validate]').forEach(function (form) {
    var campos = form.querySelectorAll('input:not([type=hidden]), select, textarea');
    // Al pulsar un botón no se valida el campo que pierde el foco: el mensaje de error
    // movería el botón y el clic se perdería. El envío valida todos los campos.
    var pulsando = false;
    form.addEventListener('pointerdown', function (e) { pulsando = !!e.target.closest('button, a'); });
    document.addEventListener('pointerup', function () { pulsando = false; });
    campos.forEach(function (el) {
      el.addEventListener('blur', function () { if (!pulsando) mostrar(el, mensaje(el)); });
      el.addEventListener('change', function () { if (el.classList.contains('invalid') || el.type === 'checkbox') mostrar(el, mensaje(el)); });
      el.addEventListener('input', function () { if (el.classList.contains('invalid')) mostrar(el, mensaje(el)); });
    });
    form.addEventListener('submit', function (e) {
      var primero = null;
      campos.forEach(function (el) {
        var m = mensaje(el);
        mostrar(el, m);
        if (m && !primero) primero = el;
      });
      if (primero) {
        e.preventDefault();
        primero.focus();
      }
    });
  });
})();
