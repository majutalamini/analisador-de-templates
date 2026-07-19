// core/schema.js
// Lê um DOCX de referência (ex.: ESTRUTURA_TEMPLATE.docx) e extrai tudo que é
// considerado "válido": nomes de variáveis, condições de <<if>>, laços de
// <<foreach>> e variáveis de <<image>>. É a única fonte da verdade usada
// pelo analisador — não corrige nada, só serve de gabarito para comparação.

const JSZip = require("jszip");

// Reconhece: <<[Var]>>  <<if [...]>>  <</if>>  <<foreach [...]>>  <</foreach>>  <<image [Var]>>
const TAG_RE = /<<\s*(\/?)(if|foreach|image)?\s*(?:\[([^\]]*)\])?\s*>>/g;

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Lê TODAS as tags <w:t> de word/document.xml em ordem sequencial no XML,
 * inserindo quebra de linha a cada </w:p>. Não depende de recortar
 * "parágrafo por parágrafo" com regex (isso quebra quando há caixas de
 * texto/formas flutuantes com <w:p> aninhado). O `\b` depois de "w:t" é
 * essencial: sem ele, o regex também casaria com <w:tbl>, <w:tab/>, <w:tcPr>,
 * <w:tr> (tabelas/tabulações), fazendo XML bruto vazar como texto.
 */
function extractLogicalText(documentXml) {
  const withBreaks = documentXml.replace(/<\/w:p>/g, "\u2029");
  let out = "";
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\u2029/g;
  let m;
  while ((m = re.exec(withBreaks))) {
    if (m[0] === "\u2029") out += "\n";
    else out += decodeXmlEntities(m[1]);
  }
  return out;
}

function extractIdentifiers(expr) {
  if (!expr) return [];
  const ids = expr.match(/[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/g) || [];
  return ids.filter((id) => id !== "in");
}

function buildSchemaFromText(text) {
  const schema = {
    variables: new Set(),      // <<[X]>>
    imageVariables: new Set(), // <<image [X]>>
    rawConditions: new Set(),  // texto exato dentro de <<if [...]>>
    rawLoops: new Set(),       // texto exato dentro de <<foreach [...]>>
    conditionFields: new Set(),// identificadores usados em condições (para checagem por campo)
    loopVars: new Set(),
    loopCollections: new Set(),
    allIdentifiers: new Set(), // união de tudo, útil para diagnósticos
  };

  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    const isClose = m[1] === "/";
    const kind = m[2];
    const inner = (m[3] || "").trim();
    if (isClose) continue;

    if (kind === "if") {
      schema.rawConditions.add(inner);
      extractIdentifiers(inner).forEach((id) => {
        schema.conditionFields.add(id);
        schema.allIdentifiers.add(id);
      });
    } else if (kind === "foreach") {
      schema.rawLoops.add(inner);
      const mm = inner.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_.]*)$/);
      if (mm) {
        schema.loopVars.add(mm[1]);
        schema.loopCollections.add(mm[2]);
        schema.allIdentifiers.add(mm[1]);
        schema.allIdentifiers.add(mm[2]);
      }
    } else if (kind === "image") {
      if (inner) {
        schema.imageVariables.add(inner);
        schema.allIdentifiers.add(inner);
      }
    } else if (inner) {
      schema.variables.add(inner);
      schema.allIdentifiers.add(inner);
      inner.split(".").forEach((p) => schema.allIdentifiers.add(p));
    }
  }

  return schema;
}

function setsToArrays(schema) {
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = [...v].sort();
  return out;
}

async function buildSchemaFromDocxBuffer(bufferOrArrayBuffer) {
  const zip = await JSZip.loadAsync(bufferOrArrayBuffer);
  const documentXml = await zip.file("word/document.xml").async("string");
  return setsToArrays(buildSchemaFromText(extractLogicalText(documentXml)));
}

async function buildMergedSchema(buffers) {
  const merged = {};
  for (const buf of buffers) {
    const s = await buildSchemaFromDocxBuffer(buf);
    for (const [k, v] of Object.entries(s)) merged[k] = new Set([...(merged[k] || []), ...v]);
  }
  const out = {};
  for (const [k, v] of Object.entries(merged)) out[k] = [...v].sort();
  return out;
}

module.exports = {
  TAG_RE,
  extractLogicalText,
  extractIdentifiers,
  buildSchemaFromText,
  buildSchemaFromDocxBuffer,
  buildMergedSchema,
};
