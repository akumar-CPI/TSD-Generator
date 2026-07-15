"use strict";
// Rewritten to follow the "Object Specification Design Template Integration"
// (TSD_Interface_INT001_XXXX_V0_1.docx) section structure instead of the
// original 14-section generic layout. Structural facts still come straight
// from the parsed iFlow; the AI only supplies narrative judgment (overview,
// notes, findings, per-step descriptions) — same principle as before.

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, ImageRun, AlignmentType, VerticalAlign,
} = require("docx");

const NAVY = "1F3864";
const HEAD2_BLUE = "2F5496";
const HEAD3_GREEN = "375623";
const BORDER_GREY = "CCCCCC";
const SECRET_KEY_PATTERN = /api[-_]?key|apikey|secret|password|passwd|token|authorization|privatekey|client[-_]?secret/i;

const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GREY },
};

const title = (text) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 120 },
  children: [new TextRun({ text, bold: true, size: 44, color: NAVY })],
});
const subtitle = (text) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 360 },
  children: [new TextRun({ text, bold: true, size: 30, color: HEAD2_BLUE })],
});
const h2 = (text) => new Paragraph({
  spacing: { before: 280, after: 80 },
  children: [new TextRun({ text, bold: true, size: 32, color: HEAD2_BLUE })],
});
const h3 = (text) => new Paragraph({
  spacing: { before: 200, after: 60 },
  children: [new TextRun({ text, bold: true, size: 26, color: HEAD3_GREEN })],
});
const h4 = (text) => new Paragraph({
  spacing: { before: 160, after: 50 },
  children: [new TextRun({ text, bold: true, size: 22, color: "1b2130" })],
});
const body = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text: text || "", size: 22, italics: !!opts.italics })],
});
const mono = (text) => new Paragraph({
  spacing: { after: 20 },
  children: [new TextRun({ text: text || " ", size: 18, font: "Consolas" })],
});
const spacer = () => new Paragraph({ spacing: { after: 80 }, children: [] });
const bullet = (text) => new Paragraph({
  spacing: { after: 60 }, indent: { left: 360 },
  children: [new TextRun({ text: `\u2022 ${text}`, size: 22 })],
});

function headerCell(text, w) {
  return new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    borders: cellBorders,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: NAVY },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 18 })] })],
  });
}
function dataCell(text, w) {
  return new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    borders: cellBorders,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ""), size: 18 })] })],
  });
}
function makeTable(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(100 / headers.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => headerCell(h, w[i])) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => dataCell(c, w[i])) })),
    ],
  });
}
function imageParagraph(buffer, w, h) {
  return new Paragraph({ children: [new ImageRun({ data: buffer, transformation: { width: w, height: h }, type: "png" })] });
}
function redact(key, value) {
  return SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : value;
}
function humanEndpoint(props) {
  return props.httpAddressWithoutQuery || (props.host ? `${props.host}${props.path || ""}` : "\u2014");
}

// ---- Generic "full detail" channel/adapter renderer (used in 3.7 Connectivity) ----
// INTERNAL_KEYS are XML/runtime bookkeeping that never appears in the Integration
// Suite UI (component namespace/version bookkeeping, internal variant URIs, etc.)
// — these are hidden everywhere so the document only shows what a person
// configuring the iFlow in the UI would actually see.
const INTERNAL_KEYS = new Set([
  "activityType", "subActivityType", "cmdVariantUri",
  "ComponentNS", "ComponentSWCVId", "ComponentSWCVName", "componentVersion",
  "wrapContent", "propertyTable", "headerTable", "script",
]);

function friendlyRows(props) {
  return Object.entries(props || {})
    .filter(([k]) => !INTERNAL_KEYS.has(k))
    .map(([k, v]) => [k, redact(k, v)]);
}

function renderChannel(mf, headingPrefix) {
  const out = [];
  const p = mf.props;
  out.push(h3(`${headingPrefix} ${mf.name || "Channel"} (${p.ComponentType || p.TransportProtocol || "Adapter"} \u2014 ${p.direction || "\u2014"})`));
  const curatedKeys = new Set(["ComponentType", "TransportProtocol", "MessageProtocol", "direction", "Name"]);
  const curatedRows = [
    ["Adapter / Component Type", p.ComponentType || "\u2014"],
    ["Transport Protocol", p.TransportProtocol || "\u2014"],
    ["Message Protocol", p.MessageProtocol || "\u2014"],
    ["Address / Endpoint URL", humanEndpoint(p)],
    ["Direction", p.direction || "\u2014"],
  ];
  const rawRows = friendlyRows(p).filter(([k]) => !curatedKeys.has(k));
  out.push(makeTable(["Property", "Value"], [...curatedRows, ...rawRows], [40, 60]));
  out.push(spacer());
  return out;
}

// ---- Pallet Functions: grouped by type, one heading per type ----
function palletTypeLabel(step) {
  if (step.xmlTag === "startEvent" && step.type === "Error Start Event") return "Exception Sub Process (Start)";
  if (step.xmlTag === "startEvent") return "Start Event";
  if (step.xmlTag === "endEvent") return "End Event";
  return step.type || "Unknown";
}

function attachmentNote(filename) {
  return filename ? `attachments/${filename}` : null;
}

function tableFromRows(label, rows) {
  const out = [h4(label)];
  const cols = ["Action", "Name", "Type", "Datatype", "Value", "Default"];
  const tableRows = rows.map((r) => {
    const name = r.Name || r.name || "";
    const isSecret = SECRET_KEY_PATTERN.test(name);
    return cols.map((c) => (isSecret && c === "Value" ? "[REDACTED]" : (r[c] ?? "")));
  });
  out.push(makeTable(cols, tableRows, [12, 20, 12, 14, 30, 12]));
  out.push(spacer());
  return out;
}

// One instance's fields, rendered according to the fixed layout for its type.
// Returns docx children for a single "General / Name" block onward.
function renderInstance(step, content, parsed) {
  const out = [];
  out.push(h4(`Name: ${step.name || "(unnamed)"}`));
  const desc = (content.stepDescriptions || {})[step.id];
  if (desc) out.push(body(desc));

  const type = step.type;

  if (type === "Content Modifier") {
    if (step.headerTable && step.headerTable.length) out.push(...tableFromRows("Message Header \u2014 Headers", step.headerTable));
    if (step.propertyTable && step.propertyTable.length) out.push(...tableFromRows("Exchange Property \u2014 Properties", step.propertyTable));
    const bodyType = step.props?.bodyType;
    const bodyValue = step.props?.body;
    if (bodyType || bodyValue) {
      out.push(h4("Message Body"));
      out.push(body(`Type: ${bodyType || "\u2014"}`));
      out.push(body(`Body: ${bodyValue || "\u2014"}`));
    }
    out.push(spacer());
    return out;
  }

  if (type === "Groovy Script" || /^Script/.test(type)) {
    const file = attachmentNote(step.scriptFile);
    out.push(body(file ? `Attachment: ${file}` : "No script file reference found for this step.", { italics: !file }));
    out.push(spacer());
    return out;
  }

  if (type === "Message Mapping") {
    const mappingFile = step.props?.mappinguri ? attachmentNote(step.props.mappinguri.split("/").pop()) : null;
    out.push(body(mappingFile ? `Attachment: ${mappingFile}` : "Mapping resource not found in the export \u2014 verify manually in the Integration Suite UI.", { italics: !mappingFile }));
    out.push(spacer());
    return out;
  }

  if (type === "Request-Reply / External Call") {
    out.push(body("See Section 3.7 Connectivity for the adapter/endpoint configuration this call uses.", { italics: true }));
    out.push(spacer());
    return out;
  }

  // Generic fallback for any other pallet function type (Router, Splitter,
  // Filter, Converters, Timer, etc.) — only UI-visible fields, no internal keys.
  const rows = friendlyRows(step.props);
  if (rows.length) {
    out.push(makeTable(["Property", "Value"], rows, [40, 60]));
  }
  out.push(spacer());
  return out;
}

function collectAllSteps(proc) {
  const out = [];
  proc.steps.forEach((s) => out.push(s));
  (proc.subProcesses || []).forEach((sub) => out.push(...collectAllSteps(sub)));
  return out;
}

function renderPalletFunctionsSection(allSteps, content, parsed, sectionPrefix) {
  const out = [];
  const groups = new Map(); // type label -> steps, in first-seen order
  allSteps.forEach((step) => {
    const label = palletTypeLabel(step);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(step);
  });

  let i = 1;
  groups.forEach((steps, label) => {
    out.push(h3(`${sectionPrefix}.${i} ${label}`));
    i++;
    steps.forEach((step) => out.push(...renderInstance(step, content, parsed)));
  });
  return out;
}

async function build({ parsed, content, diagrams, docTitle, documentMetadata = {} }) {
  const meta = {
    domain: documentMetadata.domain || "XXXX",
    interfaceId: documentMetadata.interfaceId || "I<xxx>",
    level3Id: documentMetadata.level3Id || "\u2014",
    author: documentMetadata.author || "\u2014",
    sapVersion: documentMetadata.sapVersion || "\u2014",
    interfacePattern: documentMetadata.interfacePattern || "\u2014",
    companyName: documentMetadata.companyName || "",
  };
  const today = new Date().toISOString().slice(0, 10);
  const mainProc = parsed.processes[0];
  const allSteps = mainProc ? collectAllSteps(mainProc) : [];

  const children = [];

  children.push(title("Technical Specification"));
  children.push(subtitle(`Interface INT_${meta.domain}${meta.interfaceId}_${parsed.iflowName || "Untitled"}`));
  children.push(spacer());

  children.push(h2("Document Identification"));
  children.push(makeTable(
    ["Field", "Value"],
    [
      ["Interface ID", meta.interfaceId],
      ["Title", docTitle && docTitle.trim() ? docTitle.trim() : parsed.iflowName || "\u2014"],
      ["Version", parsed.bundleVersion || "\u2014"],
      ["Level3 ID", meta.level3Id],
      ["Author", meta.author],
      ["SAP Version", meta.sapVersion],
      ["Interface Pattern", meta.interfacePattern],
    ],
    [35, 65]
  ));
  children.push(spacer());

  children.push(h2("Revision History"));
  children.push(makeTable(
    ["Version", "Author Of Revision", "Creation Date", "Comments", "Incident/CR Number"],
    [["1.0", "CI Pipeline", today, "Auto-generated from iFlow artifact via GitHub Actions", "\u2014"]],
    [10, 20, 15, 40, 15]
  ));
  children.push(spacer(), spacer());

  children.push(h2("1. Detailed Functional Design"));
  children.push(body(
    "This section captures the functional requirements of the interface. It is not derivable from the iFlow export and must be completed manually (link the FSD / mapping sheet).",
    { italics: true }
  ));
  children.push(spacer());

  children.push(h2("2. Detailed Technical Design Specifications"));
  children.push(body(
    "This section covers ABAP-side development (custom objects, enhancements, function modules). It is out of scope for automated generation from an iFlow export — complete manually if this interface includes ABAP-side components.",
    { italics: true }
  ));
  children.push(spacer());

  children.push(h2("3. BTP-IS Technical Information"));
  children.push(body("Covers SAP BTP Integration Suite components, configurations, and security details."));
  children.push(spacer());

  children.push(h3("3.1 Package Details"));
  children.push(makeTable(
    ["Field", "Value"],
    [
      ["Package / Bundle Name", (parsed.manifest && parsed.manifest["Bundle-Name"]) || parsed.iflowName || "\u2014"],
      ["Bundle Version", parsed.bundleVersion || "\u2014"],
      ["Bundle SymbolicName", (parsed.manifest && parsed.manifest["Bundle-SymbolicName"]) || "\u2014"],
    ],
    [35, 65]
  ));
  children.push(spacer());

  children.push(h4("3.1.1 Integration Flow Details"));
  const mainProcProps = (mainProc && mainProc.props) || {};
  children.push(makeTable(
    ["Field", "Value"],
    [
      ["Name", parsed.iflowName || "\u2014"],
      ["ID", (mainProc && mainProc.id) || "\u2014"],
      ["Description", mainProcProps.description || "\u2014"],
      ["Namespace Mapping", mainProcProps.namespaceMapping || "\u2014"],
      ["Allowed Header(s)", mainProcProps.allowedHeaders || "\u2014"],
      ["Return Exception to Sender", mainProcProps.returnExceptionToSender || "\u2014"],
    ],
    [35, 65]
  ));
  children.push(spacer());

  const scriptEntries = Object.keys(parsed.scripts || {});
  children.push(h4("Resources"));
  if (scriptEntries.length) {
    children.push(makeTable(["Name", "Type", "Action"], scriptEntries.map((s) => [s, "Script", "Included in iFlow"]), [40, 30, 30]));
  } else {
    children.push(body("No script/resource files found in this iFlow.", { italics: true }));
  }
  children.push(spacer());

  children.push(h4("Externalized Parameters"));
  if (parsed.parametersDefined && parsed.parametersDefined.length) {
    children.push(makeTable(["Name", "Value"], parsed.parametersDefined.map((p) => [p.name, "\u2014"]), [50, 50]));
  } else {
    children.push(body("No externalized parameters are defined in this iFlow.", { italics: true }));
  }
  children.push(spacer(), spacer());

  children.push(h3("3.2 Cloud Connector Configuration"));
  children.push(body(
    "Details connectivity between on-premise and cloud systems. Not derivable from the iFlow export — complete manually if this interface uses the Cloud Connector (e.g. an On-Premise proxy type appears in Section 3.7).",
    { italics: true }
  ));
  children.push(spacer());

  children.push(h3("3.3 Pallet Functions"));
  children.push(h4("Participants"));
  if (parsed.participants.length) {
    children.push(makeTable(["Name", "Type"], parsed.participants.map((p) => [p.name || "\u2014", p.type || "\u2014"]), [50, 50]));
  } else {
    children.push(body("No participants found.", { italics: true }));
  }
  children.push(spacer());

  if (allSteps.length) {
    children.push(...renderPalletFunctionsSection(allSteps, content, parsed, "3.3"));
  } else {
    children.push(body("No process steps found in this iFlow.", { italics: true }));
  }

  if (diagrams.highLevel) {
    children.push(h4("High-Level Design"));
    children.push(imageParagraph(diagrams.highLevel.buffer, 500, Math.round(500 * (diagrams.highLevel.height / diagrams.highLevel.width))));
    children.push(spacer());
  }
  if (diagrams.detailed) {
    children.push(h4("Message Flow Diagram"));
    children.push(imageParagraph(diagrams.detailed.buffer, 500, Math.round(500 * (diagrams.detailed.height / diagrams.detailed.width))));
    children.push(spacer());
  }
  if (content.highLevelSummary) children.push(body(content.highLevelSummary));
  children.push(spacer(), spacer());

  children.push(h3("3.4 Security"));
  children.push(body("Details authentication, encryption, and access controls."));
  if (content.securityNote) children.push(body(content.securityNote));
  children.push(spacer());

  const securityMaterialRows = [];
  parsed.messageFlows.forEach((mf) => {
    const p = mf.props;
    if (p.privateKeyAlias || p.username) {
      securityMaterialRows.push([p.privateKeyAlias || p.username, p.authenticationMethod || p.authentication || "Key/Certificate", "\u2014 verify at deployment", "\u2014", "\u2014"]);
    }
  });
  children.push(h4("Security Material"));
  if (securityMaterialRows.length) {
    children.push(makeTable(["Name", "Type", "Status", "Deployed By", "Deployed On"], securityMaterialRows, [24, 24, 20, 16, 16]));
  } else {
    children.push(body("No named credentials/keystore aliases were found in this iFlow's adapter configuration.", { italics: true }));
  }
  children.push(spacer());

  if (content.securityRows && content.securityRows.length) {
    children.push(h4("Security Observations"));
    children.push(makeTable(["Area", "Configuration", "Observation"], content.securityRows, [20, 38, 42]));
  }
  children.push(spacer(), spacer());

  children.push(h3("3.5 Manage Stores"));
  children.push(body("Describes message persistence mechanisms (Data Store, Variables, Number Ranges)."));
  const storeSteps = allSteps.filter((step) => /datastore|variable|numberrange|persist/i.test(`${step.type} ${(step.props && step.props.activityType) || ""}`));
  if (storeSteps.length) {
    storeSteps.forEach((step) => children.push(...renderInstance(step, content, parsed)));
  } else {
    children.push(body("No Data Store, Variable, or Number Range operations were found in this iFlow.", { italics: true }));
  }
  children.push(spacer());

  children.push(h3("3.6 Monitoring and Error Handling"));
  children.push(body("Captures error logging and alert mechanisms."));
  children.push(h4("Log Configuration"));
  children.push(body(
    mainProcProps.log
      ? `Log Level: ${mainProcProps.log}`
      : "Log level is not explicitly configured in the iFlow XML — uses the tenant default; verify in the Monitor before go-live.",
    { italics: !mainProcProps.log }
  ));
  if (content.monitoringNote) children.push(body(content.monitoringNote));
  (content.errorHandlingBullets || []).forEach((b) => children.push(bullet(b)));
  children.push(spacer(), spacer());

  children.push(h3("3.7 Connectivity"));
  children.push(body("Defines network, proxy, and API configurations."));
  if (content.connectivityNote) children.push(body(content.connectivityNote));
  children.push(spacer());
  if (parsed.messageFlows.length) {
    parsed.messageFlows.forEach((mf, i) => children.push(...renderChannel(mf, `3.7.${i + 1}`)));
  } else {
    children.push(body("No adapter channels detected.", { italics: true }));
  }
  children.push(spacer(), spacer());

  children.push(h2("4. Event Mesh Technical Information"));
  const hasEventMesh = parsed.messageFlows.some((mf) => /event\s*mesh|amqp/i.test(mf.props.ComponentType || ""));
  children.push(body(
    hasEventMesh
      ? "Event Mesh-related components were detected — complete the namespace, topic, schema, and QoS details manually."
      : "No Event Mesh components were detected in this iFlow. Section left for manual completion if applicable.",
    { italics: true }
  ));
  children.push(spacer());

  children.push(h2("5. APIM Technical Information"));
  const hasApim = parsed.messageFlows.some((mf) => /apim|api\s*management/i.test(mf.props.ComponentType || ""));
  children.push(body(
    hasApim
      ? "API Management-related components were detected — complete the API proxy, policy, and rate-limiting details manually."
      : "No API Management components were detected in this iFlow. Section left for manual completion if applicable.",
    { italics: true }
  ));
  children.push(spacer());

  children.push(h2("6. Test Cases"));
  children.push(body("Identify the test scenarios to be used to test the development with. (Mandatory)"));
  children.push(spacer());
  if (content.testPlanRows && content.testPlanRows.length) {
    children.push(makeTable(
      ["Test Considerations", "Scope of Testing (IS / OS / BO)", "Target Test Date"],
      content.testPlanRows.map((r) => [r[0], r[1], "TBD"]),
      [50, 30, 20]
    ));
  } else {
    children.push(body("No test scenarios were generated.", { italics: true }));
  }
  children.push(spacer(), spacer());

  children.push(h2("Appendix A: Automated Review Findings"));
  children.push(body("Supplementary AI-generated review — not part of the standard TSD template, kept for convenience.", { italics: true }));
  children.push(spacer());
  if (content.reviewRows && content.reviewRows.length) {
    children.push(makeTable(["Severity", "Area", "Finding", "Recommendation"], content.reviewRows, [10, 14, 38, 38]));
  }
  children.push(spacer());
  (content.appendixBullets || []).forEach((b) => children.push(bullet(b)));

  if (meta.companyName) {
    children.push(spacer(), spacer());
    children.push(body(`Generated for ${meta.companyName}.`, { italics: true }));
  }

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { build };
