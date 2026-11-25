/* SentinelData - gráficos del panel de seguridad (Chart.js 4).
   Los datos llegan como JSON en <script type="application/json">,
   compatible con la política CSP que prohíbe scripts en línea. */
(function () {
  'use strict';
  var nodo = document.getElementById('panel-data');
  if (!nodo || typeof Chart === 'undefined') return;
  var datos = JSON.parse(nodo.textContent);

  var TEAL = '#0f766e';
  var ORANGE = '#f97316';
  var RED = '#dc2626';
  var CATEGORIAS = ['#0f766e', '#2563eb', '#f97316', '#dc2626', '#7c3aed', '#64748b', '#0891b2'];

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.locale = 'es-CL';
  Chart.defaults.color = '#475569';
  Chart.defaults.maintainAspectRatio = false;

  new Chart(document.getElementById('chart-diario'), {
    type: 'bar',
    data: {
      labels: datos.diario.etiquetas,
      datasets: [
        { label: 'Exitosos', data: datos.diario.exitosos, backgroundColor: TEAL },
        { label: 'Fallidos', data: datos.diario.fallidos, backgroundColor: ORANGE },
      ],
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } },
    },
  });

  new Chart(document.getElementById('chart-categorias'), {
    type: 'doughnut',
    data: {
      labels: datos.categorias.etiquetas,
      datasets: [{ data: datos.categorias.valores, backgroundColor: CATEGORIAS, borderColor: '#fff', borderWidth: 2 }],
    },
    options: { cutout: '58%', plugins: { legend: { position: 'bottom' } } },
  });

  var horas = [];
  for (var h = 0; h < 24; h++) horas.push((h < 10 ? '0' : '') + h + 'h');
  new Chart(document.getElementById('chart-horas'), {
    type: 'line',
    data: {
      labels: horas,
      datasets: [{
        label: 'Intentos fallidos',
        data: datos.horas,
        borderColor: RED,
        backgroundColor: 'rgba(220, 38, 38, .12)',
        fill: true,
        tension: .35,
        pointRadius: 2,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
    },
  });
})();
