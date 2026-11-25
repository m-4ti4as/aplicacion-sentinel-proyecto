'use strict';

// Reglas de validación del servidor, compartidas por los formularios web
// y la API REST (mismos nombres de campo en ambos canales).

const { body } = require('express-validator');
const catalogos = require('./services/catalogos');

const enCatalogo = (lista) => (val) => catalogos.get()[lista].some((x) => x.id === Number(val));

const incidente = [
  body('titulo').isString().withMessage('Indica un título').bail().trim()
    .isLength({ min: 5 }).withMessage('Describe el incidente en al menos 5 caracteres')
    .bail().isLength({ max: 150 }).withMessage('El título admite hasta 150 caracteres'),
  body('categoria_id').custom(enCatalogo('categorias')).withMessage('Selecciona una categoría'),
  body('severidad_id').custom(enCatalogo('severidades')).withMessage('Selecciona la severidad percibida'),
  body('fecha_deteccion')
    .isISO8601({ strict: false }).withMessage('Indica la fecha y hora de detección')
    .bail()
    .custom((val) => new Date(val).getTime() <= Date.now() + 5 * 60000)
    .withMessage('La fecha de detección no puede ser futura')
    .bail()
    .custom((val) => new Date(val).getTime() >= Date.now() - 365 * 86400000)
    .withMessage('La fecha de detección no puede tener más de un año'),
  body('activo_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Activo no válido'),
  body('descripcion').isString().withMessage('Describe lo ocurrido').bail().trim()
    .isLength({ min: 10 }).withMessage('Describe lo ocurrido en al menos 10 caracteres')
    .bail().isLength({ max: 5000 }).withMessage('La descripción admite hasta 5000 caracteres'),
];

const seguimiento = [
  body('comentario').isString().withMessage('Escribe un comentario').bail().trim()
    .isLength({ min: 3 }).withMessage('Escribe un comentario de al menos 3 caracteres')
    .bail().isLength({ max: 2000 }).withMessage('El comentario admite hasta 2000 caracteres'),
];

const activo = [
  body('nombre').isString().withMessage('Ingresa el nombre').bail().trim()
    .isLength({ min: 3 }).withMessage('El nombre debe tener al menos 3 caracteres')
    .bail().isLength({ max: 120 }).withMessage('El nombre admite hasta 120 caracteres'),
  body('identificador').isString().withMessage('Ingresa el identificador').bail().trim()
    .notEmpty().withMessage('Ingresa el identificador')
    .bail()
    .matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,59}$/)
    .withMessage('Usa entre 2 y 60 caracteres: letras, números, punto, guion, dos puntos o guion bajo'),
  body('tipo_activo_id').custom(enCatalogo('tiposActivo')).withMessage('Selecciona el tipo'),
  body('area_id').custom(enCatalogo('areas')).withMessage('Selecciona el área'),
  body('criticidad').isIn(catalogos.CRITICIDADES).withMessage('Selecciona la criticidad'),
  body('ubicacion').optional({ values: 'null' }).isString().bail().trim()
    .isLength({ max: 120 }).withMessage('La ubicación admite hasta 120 caracteres'),
];

module.exports = { incidente, seguimiento, activo };
