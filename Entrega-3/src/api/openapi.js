'use strict';

// Especificación OpenAPI 3.0 de la API REST. Se publica en /api/openapi.json
// (importable en Postman, Insomnia o Swagger Editor) y se presenta en /api/docs.

const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema) => ({ 'application/json': { schema } });
const problemaResp = (descripcion) => ({ description: descripcion, content: { 'application/problem+json': { schema: ref('Problema') } } });
const param = (name, descripcion, schema = { type: 'string' }, enDonde = 'query', required = false) => ({
  name, in: enDonde, required, description: descripcion, schema,
});
const id = param('id', 'Identificador', { type: 'integer' }, 'path', true);
const pag = [
  param('pagina', 'Número de página (desde 1)', { type: 'integer', default: 1 }),
  param('por_pagina', 'Elementos por página (máx. 100)', { type: 'integer', default: 20, maximum: 100 }),
];
const comunes = {
  401: problemaResp('No autenticado: falta el token, no es válido o expiró'),
  403: problemaResp('Acceso denegado por perfil (el intento queda registrado)'),
  429: problemaResp('Se superó el límite de solicitudes'),
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'SentinelData API',
    version: '1.0.0',
    description:
      'API REST para la gestión de incidentes de ciberseguridad, inventario de activos y análisis de eventos de acceso de TransLogix Ltda. ' +
      'Obtén un token con POST /api/v1/auth/token y envíalo en la cabecera Authorization: Bearer <token>. ' +
      'Los errores siguen el formato RFC 7807 (application/problem+json).',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'Autenticación' },
    { name: 'Incidentes' },
    { name: 'Activos' },
    { name: 'Monitoreo', description: 'Solo perfil Administrador' },
    { name: 'General' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT HS256, vigencia 15 minutos' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sid', description: 'Sesión del navegador; en POST/PUT/PATCH exige X-CSRF-Token' },
    },
    schemas: {
      Problema: {
        type: 'object',
        properties: {
          type: { type: 'string', example: 'about:blank' },
          title: { type: 'string', example: 'Datos no válidos' },
          status: { type: 'integer', example: 422 },
          detail: { type: 'string' },
          errores: { type: 'object', additionalProperties: { type: 'string' }, example: { titulo: 'Describe el incidente en al menos 5 caracteres' } },
        },
      },
      Paginacion: {
        type: 'object',
        properties: { pagina: { type: 'integer' }, por_pagina: { type: 'integer' }, total: { type: 'integer' }, paginas: { type: 'integer' } },
      },
      Token: {
        type: 'object',
        properties: {
          access_token: { type: 'string' },
          token_type: { type: 'string', example: 'Bearer' },
          expires_in: { type: 'integer', example: 900 },
          usuario: { type: 'object', properties: { id: { type: 'integer' }, nombre: { type: 'string' }, apellido: { type: 'string' }, email: { type: 'string' }, rol: { type: 'string', enum: ['Administrador', 'Colaborador'] } } },
        },
      },
      NuevoIncidente: {
        type: 'object',
        required: ['titulo', 'categoria_id', 'severidad_id', 'fecha_deteccion', 'descripcion'],
        properties: {
          titulo: { type: 'string', minLength: 5, maxLength: 150, example: 'Correo sospechoso solicitando credenciales del ERP' },
          categoria_id: { type: 'integer', example: 1 },
          severidad_id: { type: 'integer', example: 2 },
          fecha_deteccion: { type: 'string', format: 'date-time', example: '2026-11-20T09:15' },
          activo_id: { type: 'integer', nullable: true },
          descripcion: { type: 'string', minLength: 10, maxLength: 5000 },
        },
      },
      Incidente: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, codigo: { type: 'string', example: 'INC-2026-00073' }, titulo: { type: 'string' },
          categoria: { type: 'string' }, severidad: { type: 'string' }, estado: { type: 'string' }, es_final: { type: 'integer' },
          reportado_por: { type: 'string' }, asignado_a: { type: 'string', nullable: true },
          fecha_deteccion: { type: 'string', format: 'date-time' }, creado_en: { type: 'string', format: 'date-time' },
        },
      },
      Seguimiento: {
        type: 'object',
        required: ['comentario'],
        properties: {
          comentario: { type: 'string', minLength: 3, maxLength: 2000 },
          estado_id: { type: 'integer', description: 'Solo Administrador' },
          severidad_id: { type: 'integer', description: 'Solo Administrador' },
          asignado_a: { type: 'integer', nullable: true, description: 'Solo Administrador; id de un administrador activo' },
        },
      },
      Activo: {
        type: 'object',
        required: ['nombre', 'identificador', 'tipo_activo_id', 'area_id', 'criticidad'],
        properties: {
          nombre: { type: 'string', minLength: 3, maxLength: 120 },
          identificador: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{1,59}$', example: 'SRV-ERP-001' },
          tipo_activo_id: { type: 'integer' }, area_id: { type: 'integer' },
          criticidad: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] },
          responsable_id: { type: 'integer', nullable: true }, ubicacion: { type: 'string', maxLength: 120 },
        },
      },
      Alerta: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, regla: { type: 'string', enum: ['FUERZA_BRUTA', 'IP_SOSPECHOSA', 'IP_NUEVA', 'FUERA_HORARIO'] },
          descripcion: { type: 'string' }, severidad: { type: 'string' }, ip: { type: 'string' }, revisada: { type: 'integer' },
          creado_en: { type: 'string', format: 'date-time' },
        },
      },
      Evento: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, codigo: { type: 'string', example: 'LOGIN_FALLIDO' }, evento: { type: 'string' },
          usuario: { type: 'string', nullable: true }, email_intentado: { type: 'string' }, ip: { type: 'string' },
          user_agent: { type: 'string' }, creado_en: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  paths: {
    '/auth/token': {
      post: {
        tags: ['Autenticación'], summary: 'Obtener un token de acceso (JWT)', security: [],
        description: 'Aplica los mismos controles que el inicio de sesión web: bloqueo tras 5 intentos, reglas de detección y registro del evento. Límite de solicitudes por IP.',
        requestBody: { required: true, content: json({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' } } }) },
        responses: { 200: { description: 'Token emitido', content: json(ref('Token')) }, 401: problemaResp('Credenciales inválidas (mensaje genérico)'), 423: problemaResp('Cuenta bloqueada temporalmente'), 429: comunes[429] },
      },
    },
    '/me': { get: { tags: ['General'], summary: 'Usuario autenticado', responses: { 200: { description: 'Datos del usuario' }, 401: comunes[401] } } },
    '/catalogos': { get: { tags: ['General'], summary: 'Catálogos (categorías, severidades, estados, áreas, tipos)', responses: { 200: { description: 'Catálogos' }, 401: comunes[401] } } },
    '/incidentes': {
      get: {
        tags: ['Incidentes'], summary: 'Listar incidentes',
        description: 'El Colaborador solo recibe los incidentes que reportó.',
        parameters: [param('estado', 'Id de estado', { type: 'integer' }), param('severidad', 'Id de severidad', { type: 'integer' }), param('q', 'Busca en código y título'), ...pag],
        responses: { 200: { description: 'Lista paginada', content: json({ type: 'object', properties: { datos: { type: 'array', items: ref('Incidente') }, paginacion: ref('Paginacion') } }) }, 401: comunes[401] },
      },
      post: {
        tags: ['Incidentes'], summary: 'Reportar un incidente',
        requestBody: { required: true, content: json(ref('NuevoIncidente')) },
        responses: { 201: { description: 'Creado; cabecera Location con la URL del recurso' }, 401: comunes[401], 422: problemaResp('Errores de validación por campo') },
      },
    },
    '/incidentes/{id}': {
      get: { tags: ['Incidentes'], summary: 'Detalle con SLA y línea de tiempo', parameters: [id], responses: { 200: { description: 'Incidente' }, 401: comunes[401], 403: comunes[403], 404: problemaResp('No existe') } },
    },
    '/incidentes/{id}/seguimientos': {
      post: {
        tags: ['Incidentes'], summary: 'Registrar seguimiento', parameters: [id],
        description: 'El Colaborador solo agrega comentarios a sus incidentes; el Administrador puede cambiar estado, severidad y responsable. Notifica en tiempo real al reportante.',
        requestBody: { required: true, content: json(ref('Seguimiento')) },
        responses: { 201: { description: 'Seguimiento registrado' }, 403: comunes[403], 404: problemaResp('No existe'), 422: problemaResp('Errores de validación') },
      },
    },
    '/activos': {
      get: { tags: ['Activos'], summary: 'Listar activos', description: 'El Colaborador solo recibe los activos a su cargo.', parameters: [param('q', 'Busca en nombre, identificador y ubicación'), ...pag], responses: { 200: { description: 'Lista paginada' }, 401: comunes[401] } },
      post: { tags: ['Activos'], summary: 'Registrar activo (Administrador)', requestBody: { required: true, content: json(ref('Activo')) }, responses: { 201: { description: 'Creado' }, 403: comunes[403], 422: problemaResp('Errores de validación (p. ej. identificador duplicado)') } },
    },
    '/activos/{id}': {
      put: { tags: ['Activos'], summary: 'Actualizar activo (Administrador)', parameters: [id], requestBody: { required: true, content: json(ref('Activo')) }, responses: { 200: { description: 'Actualizado' }, 403: comunes[403], 404: problemaResp('No existe'), 422: problemaResp('Errores de validación') } },
    },
    '/alertas': {
      get: { tags: ['Monitoreo'], summary: 'Listar alertas', parameters: [param('estado', 'pendientes (defecto) o todas', { type: 'string', enum: ['pendientes', 'todas'] }), ...pag], responses: { 200: { description: 'Lista paginada', content: json({ type: 'object', properties: { datos: { type: 'array', items: ref('Alerta') }, paginacion: ref('Paginacion') } }) }, 403: comunes[403] } },
    },
    '/alertas/{id}': {
      patch: { tags: ['Monitoreo'], summary: 'Marcar alerta como revisada', parameters: [id], requestBody: { required: true, content: json({ type: 'object', properties: { revisada: { type: 'boolean', enum: [true] } } }) }, responses: { 200: { description: 'Revisada' }, 403: comunes[403], 404: problemaResp('No existe o ya estaba revisada') } },
    },
    '/eventos': {
      get: {
        tags: ['Monitoreo'], summary: 'Eventos de acceso (paginación por cursor)',
        description: 'Paginación keyset: usa el valor "siguiente" de la respuesta como antes_de para obtener la página siguiente. El costo no crece con la profundidad del historial.',
        parameters: [param('tipo', 'Id de tipo de evento', { type: 'integer' }), param('email', 'Correo (coincidencia parcial)'), param('ip', 'IP exacta'), param('desde', 'AAAA-MM-DD', { type: 'string', format: 'date' }), param('hasta', 'AAAA-MM-DD', { type: 'string', format: 'date' }), param('antes_de', 'Cursor: id del último evento recibido', { type: 'integer' }), param('limite', 'Máx. 200', { type: 'integer', default: 50, maximum: 200 })],
        responses: { 200: { description: 'Eventos', content: json({ type: 'object', properties: { datos: { type: 'array', items: ref('Evento') }, siguiente: { type: 'integer', nullable: true }, limite: { type: 'integer' } } }) }, 403: comunes[403] },
      },
    },
    '/metricas/panel': { get: { tags: ['Monitoreo'], summary: 'Indicadores y series del panel analítico', responses: { 200: { description: 'KPI, series diarias y por hora, top IPs, incidentes por categoría y tiempos de respuesta (90 días)' }, 403: comunes[403] } } },
  },
};
