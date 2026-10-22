> Encuadre de la visión. El portal publicado está en [el estado actual](../portail-actuel.md).

# SmartBadge — estructura

Universidad IRGIB-AFRICA, curso 2025-2026. El alumno rellena el formulario, administración valida la solicitud y solo entonces recibe el aviso para descargar el PDF e imprimirlo.

Estimación: 20 semanas, 6 fases, 6 roles, 8 dominios. Dos personas que ya trabajan con Next.js y NestJS.

**Qué entra en esas 20 semanas.** Formulario del alumno, validación, PDF horizontal, aviso por correo, mensaje y notificación, QR híbrido, llegada al portal una vez al día, lista de clase, fichas, bloqueo, biblioteca y panel de administración.

NFC en puertas y reserva de salas o material quedan para una segunda entrega.

## Del formulario a la impresora del alumno

La solicitud y el carnet son dos cosas distintas. Enviar el formulario guarda los datos. Validar crea la matrícula, el QR y el PDF. El enlace de descarga sale en los tres canales a la vez.

| Paso | Quién | Qué queda guardado |
|---|---|---|
| 1. Rellenar y enviar | Alumno | Solicitud en estado En revisión, con foto y datos |
| 2. Revisar la cola | Administración | Validada, o Devuelta con un comentario |
| 3. Corregir y reenviar | Alumno | La misma solicitud, otra vez En revisión |
| 4. Generar el documento | Sistema, al validar | Matrícula IRGIB-…, QR estático y PDF |
| 5. Avisar | Correo, mensaje en la app y push | Enlace de descarga y fecha del aviso |
| 6. Descargar e imprimir | Alumno | Registro de la descarga |

Lo escribe el alumno: foto, apellidos, nombre, nacimiento, sexo, nacionalidad, teléfono y correo. Filière y nivel se eligen de una lista. El correo no se imprime.

Lo pone el sistema al validar: matrícula, QR, año académico, cabecera y pie. Si administración devuelve la solicitud, el PDF sigue sin existir hasta la validación.

## El carnet

Formato horizontal. Cabecera con la universidad y el curso, banda CARTE D'ÉTUDIANT, foto a la izquierda, apellidos grandes, nombre debajo, campos en dos columnas, matrícula bajo la foto, QR a la derecha, pie con filière, nivel y año.

| Zona | Dato |
|---|---|
| Cabecera | Nombre de la universidad y año académico |
| Banda | CARTE D'ÉTUDIANT |
| Foto | Archivo del estudiante, a la izquierda |
| Nombre grande | Apellidos, y debajo el nombre de uso |
| Columna izquierda | Nacimiento, nacionalidad, filière |
| Columna derecha | Sexo, nivel, teléfono |
| Bajo la foto | Matrícula, formato IRGIB-3424F |
| Cuadrado derecho | QR estático del impreso |
| Pie | Filière, nivel y año |

## Dominios

Acceso a clase, asistencia, biblioteca y préstamo consultan la misma política: inscrito en el año, al día en la scolarité, no dado de baja y con el QR todavía vigente.

| Dominio | Módulo API | Entrega |
|---|---|---|
| Académico | academic | Datos mínimos en la fase 1, gestión completa en la 5 |
| Personas | students, auth | Ficha en la fase 1, roles finos en la 5 |
| Carnet | submissions, badges, packages/card | Formulario y validación en la fase 1 |
| QR y acceso | qr, access | Fases 1 a 3 |
| Asistencia | attendance, sheets | Llegada al portal y lista de clase en la fase 2 |
| Biblioteca | library | Fase 4 |
| Avisos | notifications | Correo, mensaje en la app y push, desde la fase 1 |
| Administración | imports, reports | Excel, estadísticas y exportes en la fase 5 |

## Llegada al portal y lista de clase

Son dos registros. El portal guarda la hora de llegada, una sola vez al día. La clase guarda si esa persona estuvo en esa sesión. Año y carrera salen del carnet ya validado.

| Registro | Cómo se hace | Qué ve administración |
|---|---|---|
| Llegada, con sereno | El sereno escanea el QR del teléfono o del papel | Foto, nombre, año, carrera y la hora de la primera lectura |
| Llegada, sin sereno | El alumno escanea el QR del portal, que cambia cada pocos minutos, y confirma su propia llegada | La misma hora. Un segundo intento el mismo día no la cambia |
| Lista de clase | Modo A: el responsable escanea al alumno. Modo B: el alumno escanea el QR del aula y elige su curso | Presente o ausente en cada sesión, con su hora |

## QR híbrido

| QR | Dónde vive | Duración | Si se pierde o se da de baja |
|---|---|---|---|
| Estático | PDF y papel | El curso, o hasta revocarlo | Se invalida ese token y el carnet nuevo lleva otro |
| Dinámico | PWA del estudiante | 30 a 60 segundos | Deja de emitirse cuando el carnet queda bloqueado |
| De portal | Pantalla en la entrada | Unos minutos | Una llegada por alumno y día |
| De sala | Aula, labo o biblioteca | Fijo | El alumno elige su curso después de escanear |

## Roles

| Rol | Ruta | Hace |
|---|---|---|
| Estudiante | /etudiant | Envía el formulario, descarga el PDF y, si el portal no tiene sereno, confirma su llegada |
| Sereno | /sereno | Escanea el carnet en el portal. La primera lectura del día fija la hora |
| Responsable de clase | /responsable | Escanea, verifica, cierra la sesión y genera la ficha |
| Profesor | /professeur | Recibe la ficha y consulta el historial |
| Biblioteca | /bibliotheque | Registra entrada y préstamo de material |
| Administración | /admin | Valida solicitudes y consulta llegadas, horas y listas de clase |

## Monorepo

```text
badge/
├── apps/
│   ├── web/                         Next.js, TypeScript, Tailwind, PWA
│   │   └── src/app/
│   │       ├── (auth)/login
│   │       ├── etudiant/demande     formulario
│   │       ├── etudiant/carnet      estado y descarga del PDF
│   │       ├── etudiant/llegada     confirmar la propia llegada, una vez al día
│   │       ├── sereno               escaneo en el portal
│   │       ├── responsable          escaneo, cierre, ficha
│   │       ├── professeur           fichas y alertas
│   │       ├── bibliotheque         entrada y préstamos
│   │       ├── admin/demandes       validar o devolver
│   │       └── admin/presencia      llegadas del día y listas
│   └── api/                         NestJS
│       └── src/
│           ├── auth, academic, students
│           ├── submissions, badges, qr, access
│           ├── attendance, sheets, library
│           ├── notifications, imports, reports
├── packages/
│   ├── database/                    Prisma + PostgreSQL
│   ├── shared/                      roles y estados
│   └── card/                        el carnet horizontal a PDF
└── infra/docker-compose.yml
```

## Fases

| Fase | Contenido | Semanas |
|---|---|---|
| 1. Solicitud y carnet | Formulario, cola de validación, PDF al aprobar, correo, mensaje y push | 4 |
| 2. Asistencia | Llegada al portal una vez al día, lista en modos A y B, panel de presencia | 4 |
| 3. Fichas y bloqueo | Ficha al profesor, bloqueo, carnet perdido, renovación, alerta de faltas | 3 |
| 4. Biblioteca | Entrada y préstamo | 3 |
| 5. Administración | Facultades, Excel, duplicados, estadísticas, exportes, permisos | 4 |
| 6. Lanzamiento | Pruebas y formación | 2 |

Segunda entrega: apertura NFC, reserva de salas, reserva de material, offline con conflictos.

## Otro proyecto

Cursos, exámenes y quiz. No forma parte de SmartBadge. El documento propio es [autre-projet.md](../autre-projet.md).
