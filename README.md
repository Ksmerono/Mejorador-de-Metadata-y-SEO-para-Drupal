# Drupal SEO / Metadata Improver

Herramienta web para **mejorar la metadata y el contenido SEO** de contenidos de Drupal de forma masiva, generando los meta tags con **IA local, gratuita y 100% libre de servicios de pago** (llama.cpp / LM Studio).

El proyecto fue realizado para dar servicio a una empresa con un problema de extructuracion dentro del contenido, donde no tenian marcado ni generado correctamente los metadatos de sus contenidos: El proyecto muestra cómo integrar la estructura de contenidos de Drupal (exportación del módulo **Node Export**), el módulo **Metatag** y un LLM local para automatizar la optimización SEO de miles de nodos.

> **Sin costes ni dependencia de terceros**: la generación de metadatos se ejecuta con un modelo de lenguaje local en tu propia máquina. No requiere API keys, suscripciones ni servicios en la nube de pago (OpenAI, Claude, etc.). Los contenidos nunca salen de tu equipo.

## Funcionalidades

- **Generar metadatos** (`/`): sube un archivo JSON con nodos de Drupal exportados y la IA genera/mejora automáticamente `meta_title`, `meta_description`, `meta_keywords`, `og_title`, `og_description`, `twitter_title` y `twitter_description` para cada contenido.
- **Validar contenidos** (`/validate`): sube uno o varios archivos JSON y comprueba que título, cuerpo y todos los meta tags están rellenos, mostrando un informe de los nodos con campos vacíos.

## Rutas de la aplicación


| Ruta                 | Descripción                         |
| -------------------- | ------------------------------------ |
| `/`                  | Generador de metadatos SEO           |
| `/validate`          | Validador de contenidos SEO          |
| `POST /api/upload`   | API de subida y procesamiento con IA |
| `POST /api/validate` | API de validación de nodos          |

## Formato de entrada (estructura Drupal)

El programa trabaja con el **JSON de exportación de contenidos de Drupal** generado por el módulo [Node Export](https://www.drupal.org/project/node_export).

Un archivo válido es un **array de nodos** con la estructura nativa de Drupal:

- `nid`, `uuid`, `vid`, `langcode`, `type`, `title`, `status`, `created`, `changed`, `path`, `body`, campos personalizados (`field_*`), etc.
- `metatag`: array de meta tags tal y como los gestiona el módulo **Metatag** de Drupal (`tag` + `attributes.name/property` + `attributes.content`), incluyendo tokens como `[node:title]` o `[node:summary]`.

El programa solo toca el array `metatag` de cada nodo: **nunca modifica el título ni el cuerpo** del contenido.

### Ejemplo

En la carpeta [`examples/`](examples/example_node_export.json) hay un ejemplo completo de cómo es un contenido exportado con Node Export, listo para procesar o validar.

## Requisitos

- Node.js 18+ (usa `fetch` nativo).
- [LM Studio](https://lmstudio.ai/) (u otro servidor compatible con la API de OpenAI) corriendo en `http://127.0.0.1:1234` con un modelo cargado.
- Cualquier modelo descargado gratuitamente en LM Studio: **sin límites de uso, sin cuotas ni coste por token**.

## Instalación y uso

```bash
npm install
npm start
```

Abre `http://localhost:3000`.

1. Exporta tus contenidos con el módulo Node Export de Drupal (formato JSON).
2. Sube el archivo en **Generar metadatos** y procesa con IA.
3. Descarga el JSON mejorado y reimporta los metadatos en Drupal.
4. Usa **Validar contenidos** para comprobar que no queda ningún campo vacío.

## Interfaz

Así de sencilla es la interfaz: solo es necesario arrastrar el JSON exportado desde Drupal para procesarlo.

![Interfaz del procesador de metadata: arrastra el JSON exportado para procesarlo](capturas/Captura%20procesador%20de%20metadata.png)

## Configuración

Los parámetros del LLM se configuran en `server.js`:


| Variable      | Valor por defecto                           | Descripción               |
| ------------- | ------------------------------------------- | -------------------------- |
| `LLAMA_API`   | `http://127.0.0.1:1234/v1/chat/completions` | Endpoint compatible OpenAI |
| `LLAMA_MODEL` | `qwen/qwen3-4b-2507`                        | Modelo a usar              |

## Tecnologías

- **Backend**: Node.js, Express, Multer.
- **Frontend**: HTML/CSS/JS vanilla (sin dependencias).
- **IA**: llama.cpp / LM Studio vía API compatible con OpenAI. **Local y gratuita: sin servicios de pago ni envío de datos a la nube.**
- **Drupal**: integración con la estructura de nodos, el módulo Node Export y el módulo Metatag.
