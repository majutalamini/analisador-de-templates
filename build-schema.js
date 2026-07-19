const fs = require("fs");
const { buildSchemaFromDocxBuffer } = require("./core/schema.js");

(async () => {
  const buf = fs.readFileSync("/mnt/user-data/uploads/ESTRUTURA_TEMPLATE.docx");
  const schema = await buildSchemaFromDocxBuffer(buf);
  fs.writeFileSync("core/reference-schema.json", JSON.stringify(schema, null, 2));
  console.log("variaveis:", schema.variables.length);
  console.log("imagem:", schema.imageVariables);
  console.log("condicoes:", schema.rawConditions);
  console.log("loops:", schema.rawLoops);
})();
