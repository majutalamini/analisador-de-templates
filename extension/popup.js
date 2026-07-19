// extension/popup.js
let DEFAULT_SCHEMA = null;
const $ = (id) => document.getElementById(id);

async function loadDefaultSchema() {
  const url = chrome.runtime.getURL("reference-schema.json");
  const res = await fetch(url);
  DEFAULT_SCHEMA = await res.json();
}

async function fileToArrayBuffer(file) {
  return await file.arrayBuffer();
}

function setStatus(text) {
  const status = $("status");
  if (!text) {
    status.classList.add("hidden");
    status.textContent = "";
  } else {
    status.classList.remove("hidden");
    status.textContent = text;
  }
}

function renderProblems(problems) {
  const summary = $("summary");
  const list = $("issueList");
  list.innerHTML = "";

  if (problems.length === 0) {
    summary.className = "ok";
    summary.textContent = "Nenhum problema encontrado. ✓";
    list.style.display = "none";
    return;
  }

  summary.className = "err";
  summary.textContent = `${problems.length} problema(s) encontrado(s).`;

  for (const p of problems) {
    const div = document.createElement("div");
    div.className = "item";
    const lineTag = document.createElement("span");
    lineTag.className = "line";
    lineTag.textContent = `linha ~${p.line}`;
    div.appendChild(lineTag);
    const msg = document.createElement("div");
    msg.textContent = p.message;
    div.appendChild(msg);
    const snip = document.createElement("div");
    snip.className = "snippet";
    snip.textContent = `"…${p.snippet}…"`;
    div.appendChild(snip);
    list.appendChild(div);
  }
  list.style.display = "block";
}

async function handleAnalyze() {
  const targetInput = $("targetFile");
  if (!targetInput || !targetInput.files[0]) return;

  $("analyzeBtn").disabled = true;
  setStatus("Analisando...");
  $("summary").className = "";
  $("issueList").style.display = "none";

  try {
    const schema = DEFAULT_SCHEMA;
    const targetBuf = await fileToArrayBuffer(targetInput.files[0]);
    const problems = await TemplateLinter.lintDocxBuffer(targetBuf, schema);

    renderProblems(problems);
    setStatus("Concluído.");
  } catch (err) {
    console.error(err);
    setStatus("Erro ao analisar: " + err.message);
  } finally {
    $("analyzeBtn").disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadDefaultSchema();
  } catch (err) {
    console.error(err);
    setStatus("Erro ao carregar o modelo de referência padrão.");
  }

  const targetInput = $("targetFile");
  if (targetInput) {
    targetInput.addEventListener("change", () => {
      $("analyzeBtn").disabled = !targetInput.files[0];
    });
  }

  $("analyzeBtn").addEventListener("click", handleAnalyze);
});
