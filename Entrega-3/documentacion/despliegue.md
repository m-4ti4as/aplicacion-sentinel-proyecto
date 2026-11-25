# Despliegue en producción (OE6)

`docker-compose.prod.yml` levanta la aplicación, MySQL 8.4 y Caddy, que obtiene el certificado HTTPS. Solo quedan publicados los puertos 80 y 443.

## 1. Servidor

Una máquina Linux con IP pública, al menos 2 GB de RAM y los puertos 80 y 443 abiertos (Google Compute Engine, DigitalOcean, Hetzner, etc.).

```bash
curl -fsSL https://get.docker.com | sudo sh
git clone https://github.com/GerardoGM14/app-sentinel-data.git
cd app-sentinel-data
```

## 2. Variables

```bash
cp .env.prod.example .env.prod
openssl rand -hex 32     # uno distinto para cada secreto
```

- `DOMINIO`: dominio propio apuntando a la IP o, sin dominio, `<ip-con-guiones>.sslip.io`.
- `SMTP_*`: cuenta SMTP real. Con Brevo: `smtp-relay.brevo.com`, puerto 587 (o 2525), usuario y clave SMTP, y `MAIL_FROM` con un remitente verificado. Google Cloud bloquea el puerto 25, pero no estos.
- `SEED_DEMO=true` carga las cuentas de prueba del README para la evaluación.

## 3. Publicar

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl https://<DOMINIO>/health
```

## 4. Verificar (CP-20)

1. `https://<DOMINIO>` abre con candado y redirige desde HTTP.
2. Iniciar sesión con ambos perfiles.
3. Registrar una cuenta con un correo propio, pedir la recuperación y abrir el enlace recibido.

## Actualizar

```bash
git pull
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## Alternativa con MySQL administrado

Definir `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` y `DB_SSL=true` (y `DB_SSL_CA` si el proveedor entrega su certificado). Antes de elegir un PaaS conviene revisar que permita SMTP saliente: los planes gratuitos de Render y los planes Free, Trial y Hobby de Railway lo bloquean.
