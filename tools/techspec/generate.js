#!/usr/bin/env node
"use strict";
// No external API calls of any kind. Everything in the generated document
// comes from parsing the iFlow export itself — see lib/contentBuilder.js.

const fs = require("fs");
const path = require("path");

const { parseZipBuffer } = require("./lib/iflowParser");
const Diagrams = require("./lib/diagrams");
const { buildContent } = require("./lib/contentBuilder");
const DocBuilder = require("./lib/docBuilder");

function loadConfig() {
  const configPath = path.join(__dirname, "..", "..", "techspec.config.json");
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
  return { documentMetadata: fileConfig.documentMetadata || {} };
}

async function main() {
  const [, , inputZipPath, outputDocxPath] = process.argv;
  if (!inputZipPath || !outputDocxPath) {
    console.error("Usage: node generate.js <input-iflow.zip> <output-techspec.docx>");
    process.exit(1);
  }

  const { documentMetadata } = loadConfig();
  console.log(`[techspec] Input:  ${inputZipPath}`);
  console.log(`[techspec] Output: ${outputDocxPath}`);

  console.log("[techspec] Parsing iFlow zip…");
  const zipBuffer = fs.readFileSync(inputZipPath);
  const parsed = await parseZipBuffer(zipBuffer);

  console.log("[techspec] Generating diagrams…");
  const highLevel = Diagrams.generateHighLevelDiagram(parsed);
  const detailed = Diagrams.generateDetailedDiagram(parsed);

  console.log("[techspec] Building document content…");
  const content = buildContent(parsed);

  const stepDescMap = content.stepDescriptions || {};
  function annotate(proc) {
    proc.steps.forEach((s) => (s.aiDescription = stepDescMap[s.id] || ""));
    (proc.subProcesses || []).forEach(annotate);
  }
  parsed.processes.forEach(annotate);

  console.log("[techspec] Assembling .docx…");
  const buffer = await DocBuilder.build({ parsed, content, diagrams: { highLevel, detailed }, docTitle: "", documentMetadata });

  fs.mkdirSync(path.dirname(outputDocxPath), { recursive: true });
  fs.writeFileSync(outputDocxPath, buffer);
  console.log(`[techspec] Wrote ${outputDocxPath} (${buffer.length} bytes)`);

  // Write scripts + mapping/XSLT/schema resources as real files next to the
  // doc, so the document can reference "attachments/<file>" instead of
  // dumping source inline.
  const baseName = path.basename(outputDocxPath).replace(/\.docx$/i, "");
  const attachmentsDir = path.join(path.dirname(outputDocxPath), `${baseName}_attachments`);
  const attachmentFiles = { ...parsed.scripts, ...Object.fromEntries(Object.entries(parsed.resources || {})) };
  if (Object.keys(attachmentFiles).length) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    for (const [filename, fileContent] of Object.entries(attachmentFiles)) {
      fs.writeFileSync(path.join(attachmentsDir, filename), fileContent);
    }
    console.log(`[techspec] Wrote ${Object.keys(attachmentFiles).length} attachment(s) to ${attachmentsDir}`);
  }
}

main().catch((err) => {
  console.error("[techspec] FAILED:", err.stack || err.message);
  process.exit(1);
});
