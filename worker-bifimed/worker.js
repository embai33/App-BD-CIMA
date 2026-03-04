// ============================================================
// Cloudflare Worker — Proxy BIFIMED
// Extrae datos de financiación del Ministerio de Sanidad
// ============================================================

const BIFIMED_URL = 'https://www.sanidad.gob.es/profesionales/medicamentos.do';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const cn = url.searchParams.get('cn');

    if (!cn || !/^\d+$/.test(cn)) {
      return jsonResponse({ error: 'Parámetro "cn" requerido (numérico)' }, 400);
    }

    try {
      const res = await fetch(`${BIFIMED_URL}?metodo=verDetalle&cn=${cn}`, {
        headers: { 'Accept': 'text/html' },
      });

      if (!res.ok) {
        return jsonResponse({ error: `BIFIMED respondió ${res.status}` }, 502);
      }

      const html = await res.text();
      const data = parseBifimed(html, cn);

      return jsonResponse(data, 200, {
        'Cache-Control': 'public, max-age=86400', // 24h
      });
    } catch (err) {
      return jsonResponse({ error: `Error al consultar BIFIMED: ${err.message}` }, 502);
    }
  },
};

// ── Parsear HTML de BIFIMED ──
function parseBifimed(html, cn) {
  // Extraer pares th/td generales
  const fields = {};
  const thTdRegex = /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  let match;

  while ((match = thTdRegex.exec(html)) !== null) {
    const label = stripHtml(match[1]).trim();
    const value = stripHtml(match[2]).trim();
    if (label) fields[label] = value;
  }

  const financiado = fields['Situación de financiación'] || '';

  // ¿Tiene tabla de indicaciones autorizadas? (procedimiento centralizado)
  const idxIndicaciones = html.indexOf('Indicaciones autorizadas');

  if (idxIndicaciones >= 0) {
    // Medicamento centralizado: extraer tabla de indicaciones
    const indicaciones = parseIndicacionesTable(html, idxIndicaciones);

    return {
      cn,
      financiado,
      centralizado: true,
      indicaciones,
    };
  }

  // Medicamento no centralizado: campos de texto libre
  return {
    cn,
    financiado,
    centralizado: false,
    indicacionesFinanciadas: fields['Indicaciones financiadas'] || '',
    indicacionesNoFinanciadas: fields['Indicaciones no financiadas'] || '',
  };
}

// ── Extraer filas de la tabla de indicaciones autorizadas ──
function parseIndicacionesTable(html, startIdx) {
  const chunk = html.substring(startIdx, startIdx + 30000);
  const tableEnd = chunk.indexOf('</table>');
  if (tableEnd < 0) return [];

  const tableHtml = chunk.substring(0, tableEnd);
  const indicaciones = [];

  // Buscar filas <tr> (saltar la primera que es el header)
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  let isFirstRow = true;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    if (isFirstRow) { isFirstRow = false; continue; }

    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }

    if (cells.length >= 3) {
      indicaciones.push({
        indicacion: cells[0],
        situacion: cells[1],
        resolucion: cells[2],
      });
    }
  }

  return indicaciones;
}

// ── Utilidades ──
function stripHtml(str) {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}
