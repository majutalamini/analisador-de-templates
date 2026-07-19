const JSZip = require("jszip");
const { extractLogicalText, extractIdentifiers, TAG_RE } = require("./schema.js");

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function snippetAround(text, index, len, radius = 40) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + len + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * Analisa o texto lógico (já extraído) do documento contra o schema de
 * referência. Retorna uma lista de problemas: { line, snippet, message }.
 */
function toSet(v) {
  return v instanceof Set ? v : new Set(v || []);
}

function normalizeSchema(schema) {
  return {
    variables: toSet(schema.variables),
    imageVariables: toSet(schema.imageVariables),
    rawConditions: toSet(schema.rawConditions),
    rawLoops: toSet(schema.rawLoops),
    conditionFields: toSet(schema.conditionFields),
    loopVars: toSet(schema.loopVars),
    loopCollections: toSet(schema.loopCollections),
    allIdentifiers: toSet(schema.allIdentifiers),
  };
}

function lintText(text, rawSchema) {
  const schema = normalizeSchema(rawSchema);
  const problems = [];

  const validIdentifiers = new Set([
    ...schema.variables,
    ...schema.conditionFields,
    ...schema.loopVars,
    ...schema.loopCollections,
  ]);

  // ---- 1) valida cada tag reconhecida (variável / if / foreach / image) ----
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text))) {
    const isClose = m[1] === "/";
    const kind = m[2];
    const inner = (m[3] || "").trim();
    const line = lineOf(text, m.index);
    const snippet = snippetAround(text, m.index, m[0].length);

    if (isClose) continue; // fechamentos são checados na validação de aninhamento (item 5)

    if (kind === "if") {
      const ids = extractIdentifiers(inner);
      const unknown = ids.filter((id) => !validIdentifiers.has(id));
      if (unknown.length) {
        problems.push({
          line,
          snippet,
          message: `Condição "<<if [${inner}]>>" usa "${unknown.join('", "')}", que não existe no modelo de referência.`,
        });
      }
    } else if (kind === "foreach") {
      const mm = inner.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_.]*)$/);
      if (!mm) {
        problems.push({ line, snippet, message: `Laço "<<foreach [${inner}]>>" não segue o formato "item in Colecao".` });
      } else {
        const [, itemVar, coll] = mm;
        if (!schema.loopVars.has(itemVar)) {
          problems.push({ line, snippet, message: `Laço "<<foreach [${inner}]>>" usa o item "${itemVar}", que não existe no modelo de referência.` });
        }
        if (!schema.loopCollections.has(coll)) {
          problems.push({ line, snippet, message: `Laço "<<foreach [${inner}]>>" usa a coleção "${coll}", que não existe no modelo de referência.` });
        }
      }
    } else if (kind === "image") {
      if (!schema.imageVariables.has(inner)) {
        problems.push({ line, snippet, message: `Tag de imagem "<<image [${inner}]>>" não existe no modelo de referência.` });
      }
    } else {
      // variável simples
      if (!inner) {
        problems.push({ line, snippet, message: `Tag "<<...>>" sem nome de variável dentro dos colchetes.` });
      } else if (!schema.variables.has(inner)) {
        problems.push({ line, snippet, message: `Variável "<<[${inner}]>>" não existe no modelo de referência.` });
      }
    }
  }

  // ---- 2) sintaxe malformada: tags que "quase" parecem certas mas não batem no TAG_RE ----
  // tag sem colchetes: <<Nome>>  (mas não <<if ...>>, <<foreach ...>>, <</if>>, <</foreach>>)
  const noBracketRe = /<<(?!\/|if\b|foreach\b|image\b)\s*[A-Za-z_][A-Za-z0-9_.]*\s*>>/g;
  while ((m = noBracketRe.exec(text))) {
    problems.push({
      line: lineOf(text, m.index),
      snippet: snippetAround(text, m.index, m[0].length),
      message: `Tag "${m[0]}" sem colchetes — o formato correto é "<<[${m[0].replace(/<</, "").replace(/>>/, "").trim()}]>>".`,
    });
  }
  // colchete simples: <[Nome]>
  const singleBracketRe = /(?<!<)<\[[^\]]+\]>(?!>)/g;
  while ((m = singleBracketRe.exec(text))) {
    problems.push({
      line: lineOf(text, m.index),
      snippet: snippetAround(text, m.index, m[0].length),
      message: `Tag "${m[0]}" com colchete simples — o formato correto usa "<<" e ">>" duplicados.`,
    });
  }

  // ---- 3) aninhamento de <<if>>/<<foreach>> (pilha) ----
  const stack = [];
  const nestRe = /<<\s*(\/?)(if|foreach)\b\s*(?:\[[^\]]*\])?\s*>>/g;
  while ((m = nestRe.exec(text))) {
    const isClose = m[1] === "/";
    const kind = m[2];
    const line = lineOf(text, m.index);
    const snippet = snippetAround(text, m.index, m[0].length);
    if (!isClose) {
      stack.push({ kind, line, snippet, raw: m[0] });
    } else if (stack.length === 0) {
      problems.push({ line, snippet, message: `Fechamento "<</${kind}>>" sem nenhuma abertura correspondente antes dele.` });
    } else {
      const top = stack[stack.length - 1];
      if (top.kind !== kind) {
        problems.push({
          line,
          snippet,
          message: `Fechamento "<</${kind}>>" encontrado, mas a tag aberta mais recente (linha ~${top.line}: "${top.raw}") é um <<${top.kind}>> — falta fechar essa antes, ou este fechamento deveria ser "<</${top.kind}>>".`,
        });
      } else {
        stack.pop();
      }
    }
  }
  for (const remaining of stack) {
    problems.push({
      line: remaining.line,
      snippet: remaining.snippet,
      message: `A tag "${remaining.raw}" nunca é fechada com "<</${remaining.kind}>>".`,
    });
  }

  // ordena por posição no documento (linha)
  problems.sort((a, b) => a.line - b.line);
  return problems;
}

async function lintDocxBuffer(bufferOrArrayBuffer, schema) {
  const zip = await JSZip.loadAsync(bufferOrArrayBuffer);
  const documentXml = await zip.file("word/document.xml").async("string");
  const text = extractLogicalText(documentXml);
  return lintText(text, schema);
}

module.exports = { lintText, lintDocxBuffer };
