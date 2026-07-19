# Analisador de Templates DOCX (só aponta, não corrige)

Sistema novo e mais simples: analisa um template `.docx` contra um modelo de
referência e **aponta cada linha com problema** — nome de variável errado,
`<<if>>`/`<<foreach>>`/`<<image>>` inválido ou mal fechado. **Não edita o
arquivo em nenhuma hipótese.** Baseado inteiramente em regras (regex +
pilha de aninhamento), sem IA e sem chave de API.

## Como funciona

1. **Schema de referência** (`reference-schema.json`): extraído do
   `ESTRUTURA_TEMPLATE.docx` que você enviou — a lista de variáveis válidas,
   as condições válidas de `<<if>>`, os laços válidos de `<<foreach>>` e as
   variáveis válidas de `<<image>>`.

2. **Analisador** (`core/linter.js` no Node, `extension/linter.browser.js` no
   navegador — mesma lógica): para cada tag `<<...>>` encontrada no template
   do cliente, verifica:
   - **Variável** (`<<[Nome]>>`): o nome existe no modelo de referência?
   - **Imagem** (`<<image [Nome]>>`): existe na lista de variáveis de imagem?
   - **Condição** (`<<if [...]>>`): os campos usados na condição existem no
     modelo de referência? (aceita qualquer operador/valor — `> 0`, `== 1`,
     etc. — só o **nome do campo** precisa ser válido)
   - **Laço** (`<<foreach [item in Colecao]>>`): o nome do item e da coleção
     existem no modelo de referência?
   - **Sintaxe**: tag sem colchetes (`<<Nome>>`) ou com colchete simples
     (`<[Nome]>`) é sinalizada.
   - **Aninhamento**: todo `<<if>>`/`<<foreach>>` aberto precisa fechar com o
     tipo certo (uma pilha percorre o documento inteiro nessa ordem).

   **O texto entre as tags nunca é analisado** — só o que está dentro de
   `<<...>>`. Cláusulas, parágrafos e qualquer prosa livre no meio do
   contrato não geram problema nenhum.

3. **Saída**: uma lista de problemas, cada um com:
   - linha aproximada (baseada em parágrafos do documento — não é
     necessariamente igual à numeração de linha visível no Word, então cada
     problema também vem com um **trecho de texto** para localizar com
     Ctrl+F);
   - a explicação exata do que está errado.

   Nada é corrigido, nenhum arquivo novo é gerado.

## Estrutura

```
core/
  schema.js              → extrai o schema de referência de um docx
  linter.js               → motor de análise (só leitura, não corrige)
  reference-schema.json   → schema já gerado a partir do ESTRUTURA_TEMPLATE.docx
build-schema.js           → regera reference-schema.json a partir de um novo modelo
extension/                → EXTENSÃO DE NAVEGADOR (Chrome/Edge, Manifest V3)
  manifest.json
  popup.html / popup.js
  linter.browser.js       → motor de análise no navegador (mesma lógica de core/)
  jszip.min.js            → biblioteca para ler .docx (zip) no navegador
  reference-schema.json   → schema padrão embutido na extensão
```

## Instalar a extensão

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `extension/`.

## Usar

1. Clique no ícone da extensão.
2. (Opcional) Envie um novo modelo de referência `.docx` — se não enviar, usa
   o schema padrão já embutido (gerado a partir do `ESTRUTURA_TEMPLATE.docx`
   que você me enviou).
3. Envie o template do cliente a analisar.
4. Clique em **Analisar template**.
5. Veja a lista de problemas — cada um com a linha aproximada, a explicação e
   um trecho de texto para localizar no Word.

Tudo roda localmente no navegador — nenhum arquivo é enviado para nenhum
servidor.

## Testar via linha de comando (Node)

```bash
npm install
node build-schema.js   # regera core/reference-schema.json a partir do modelo de referência
node -e "
const fs = require('fs');
const { lintDocxBuffer } = require('./core/linter.js');
const schema = JSON.parse(fs.readFileSync('core/reference-schema.json'));
(async () => {
  const problems = await lintDocxBuffer(fs.readFileSync('CAMINHO/DO/ARQUIVO.docx'), schema);
  for (const p of problems) console.log('linha ~'+p.line, '|', p.message);
})();
"
```

## Atualizando o modelo de referência

Sempre que o modelo mudar, rode `node build-schema.js` (ajustando o caminho
do arquivo no início do script) e copie o `core/reference-schema.json`
gerado para `extension/reference-schema.json` — ou simplesmente envie o novo
modelo direto na extensão, no campo "Modelo de referência (opcional)".
