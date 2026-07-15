"use strict";
// Node port of the extension's src/iflowParser.js — same logic, swapped to
// Node-friendly libraries (xmldom instead of the browser's DOMParser).

const JSZip = require("jszip");
const { DOMParser } = require("@xmldom/xmldom");

const BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL";
const IFL_NS = "http:///com.sap.ifl.model/Ifl.xsd";

function byLocalName(root, name) {
  const out = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) out.push(all[i]);
  }
  return out;
}
function directChildrenByLocalNames(el, names) {
  const out = [];
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.nodeType === 1 && names.includes(c.localName)) out.push(c);
  }
  return out;
}
function iflType(el) {
  return el.getAttributeNS(IFL_NS, "type") || el.getAttribute("ifl:type") || null;
}
function extensionProps(el) {
  const props = {};
  const ext = directChildrenByLocalNames(el, ["extensionElements"])[0];
  if (!ext) return props;
  const propEls = byLocalName(ext, "property");
  propEls.forEach((p) => {
    const keyEl = directChildrenByLocalNames(p, ["key"])[0];
    const valEl = directChildrenByLocalNames(p, ["value"])[0];
    if (keyEl) props[keyEl.textContent.trim()] = valEl ? valEl.textContent : "";
  });
  return props;
}

function classify(props) {
  const at = props.activityType || "";
  const sub = props.subActivityType || "";
  const cmd = props.cmdVariantUri || "";
  if (at === "Enricher") return "Content Modifier";
  if (at === "Script" && sub === "GroovyScript") return "Groovy Script";
  if (at === "Script") return `Script (${sub || "unknown"})`;
  if (at === "ExternalCall") return "Request-Reply / External Call";
  if (at === "StartErrorEvent") return "Error Start Event";
  if (at === "ErrorEventSubProcessTemplate") return "Error Event Subprocess";
  if (at === "StartTimerEvent") return "Timer Start Event";
  if (/Router/i.test(cmd)) return "Router";
  if (/Splitter/i.test(cmd)) return "Splitter";
  if (/Mapping/i.test(cmd)) return "Message Mapping";
  if (/XmlToJson/i.test(cmd)) return "XML to JSON Converter";
  if (/JsonToXml/i.test(cmd)) return "JSON to XML Converter";
  if (at) return at;
  return "Unknown";
}

function parseTable(xmlLikeString) {
  if (!xmlLikeString) return [];
  const doc = new DOMParser({ onError: () => {} }).parseFromString(`<root>${xmlLikeString}</root>`, "text/xml");
  if (!doc || !doc.getElementsByTagName) return [];
  const rows = Array.from(doc.getElementsByTagName("row"));
  return rows.map((row) => {
    const cells = Array.from(row.getElementsByTagName("cell"));
    const obj = {};
    cells.forEach((c) => (obj[c.getAttribute("id") || "value"] = c.textContent));
    return obj;
  });
}

function walkSequence(nodesById, startIds, flowsBySource) {
  const ordered = [];
  const visited = new Set();
  let frontier = startIds.slice();
  let guard = 0;
  while (frontier.length && guard < 500) {
    guard++;
    const next = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      if (nodesById[id]) ordered.push(nodesById[id]);
      const outs = flowsBySource[id] || [];
      outs.forEach((targetId) => next.push(targetId));
    }
    frontier = next;
  }
  return ordered;
}

function parseProcessLike(procEl) {
  const directTypes = [
    "startEvent", "endEvent", "callActivity", "serviceTask", "task",
    "scriptTask", "exclusiveGateway", "sequenceFlow", "subProcess",
  ];
  const children = directChildrenByLocalNames(procEl, directTypes);

  const nodesById = {};
  const flowsBySource = {};
  const startIds = [];
  const subProcesses = [];

  children.forEach((c) => {
    if (c.localName === "sequenceFlow") {
      const src = c.getAttribute("sourceRef");
      const tgt = c.getAttribute("targetRef");
      (flowsBySource[src] = flowsBySource[src] || []).push(tgt);
      return;
    }
    if (c.localName === "subProcess") {
      subProcesses.push(c);
      return;
    }
    const id = c.getAttribute("id");
    const name = c.getAttribute("name") || "";
    const props = extensionProps(c);
    const node = { id, name, xmlTag: c.localName, props, type: classify(props) };
    nodesById[id] = node;
    if (c.localName === "startEvent") startIds.push(id);
  });

  const steps = walkSequence(nodesById, startIds, flowsBySource);

  const subResults = subProcesses.map((sp) => ({
    id: sp.getAttribute("id"),
    name: sp.getAttribute("name") || "",
    props: extensionProps(sp),
    ...parseProcessLike(sp),
  }));

  return { steps, subProcesses: subResults };
}

function parseManifest(text) {
  if (!text) return {};
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n /g, "");
  const lines = unfolded.split("\n").filter(Boolean);
  const out = {};
  lines.forEach((line) => {
    const idx = line.indexOf(":");
    if (idx > -1) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  return out;
}
function parseProps(text) {
  if (!text) return {};
  const out = {};
  text.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#")) return;
    const idx = line.indexOf("=");
    if (idx > -1) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  return out;
}

async function parseZipBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const fileNames = Object.keys(zip.files);

  const iflwName = fileNames.find((n) => n.toLowerCase().endsWith(".iflw"));
  if (!iflwName) throw new Error("No .iflw file found inside the uploaded zip.");
  const iflwText = await zip.files[iflwName].async("text");
  const xml = new DOMParser({
    onError: (level, msg) => {
      if (level === "fatalError") throw new Error(`XML parse error: ${msg}`);
    },
  }).parseFromString(iflwText, "text/xml");

  const iflowNameGuess = iflwName.split("/").pop().replace(/\.iflw$/i, "");

  const participants = byLocalName(xml, "participant").map((p) => ({
    id: p.getAttribute("id"),
    name: p.getAttribute("name") || "",
    type: iflType(p),
  }));

  const messageFlows = byLocalName(xml, "messageFlow").map((mf) => ({
    id: mf.getAttribute("id"),
    name: mf.getAttribute("name") || "",
    sourceRef: mf.getAttribute("sourceRef"),
    targetRef: mf.getAttribute("targetRef"),
    props: extensionProps(mf),
  }));

  const processEls = byLocalName(xml, "process");
  const processes = processEls.map((p) => ({
    id: p.getAttribute("id"),
    name: p.getAttribute("name") || "",
    props: extensionProps(p),
    ...parseProcessLike(p),
  }));

  function enrichNode(n) {
    if (n.props.propertyTable) n.propertyTable = parseTable(n.props.propertyTable);
    if (n.props.headerTable) n.headerTable = parseTable(n.props.headerTable);
    if (n.props.script) n.scriptFile = n.props.script;
    return n;
  }
  function walkEnrich(proc) {
    proc.steps.forEach(enrichNode);
    proc.subProcesses.forEach(walkEnrich);
  }
  processes.forEach(walkEnrich);

  const scriptFiles = fileNames.filter((n) => /\/script\/.*\.(groovy|js)$/i.test(n));
  const scripts = {};
  for (const sf of scriptFiles) {
    scripts[sf.split("/").pop()] = await zip.files[sf].async("text");
  }

  // Message mapping / XSLT / schema resources — these get attached as files
  // rather than parsed for content (mmap files are their own mini-archives).
  const resourceFiles = fileNames.filter((n) => /\/(mapping|xslt|xsd)\/.*\.(mmap|xsl|xslt|xsd)$/i.test(n));
  const resources = {};
  for (const rf of resourceFiles) {
    resources[rf.split("/").pop()] = await zip.files[rf].async("nodebuffer");
  }

  let metainfo = {};
  let manifest = {};
  let parametersProp = "";
  let parametersDefined = [];
  const metaFile = fileNames.find((n) => n.endsWith("metainfo.prop"));
  const manifestFile = fileNames.find((n) => n.endsWith("MANIFEST.MF"));
  const paramPropFile = fileNames.find((n) => n.endsWith("parameters.prop"));
  const paramDefFile = fileNames.find((n) => n.endsWith("parameters.propdef"));

  if (metaFile) metainfo = parseProps(await zip.files[metaFile].async("text"));
  if (manifestFile) manifest = parseManifest(await zip.files[manifestFile].async("text"));
  if (paramPropFile) parametersProp = await zip.files[paramPropFile].async("text");
  if (paramDefFile) {
    const t = await zip.files[paramDefFile].async("text");
    const doc = new DOMParser({ onError: () => {} }).parseFromString(t, "text/xml");
    parametersDefined = Array.from(doc.getElementsByTagName("param")).map((p) => ({
      name: p.getAttribute("name") || p.textContent,
    }));
  }

  return {
    iflowName: manifest["Bundle-Name"] || iflowNameGuess,
    bundleVersion: manifest["Bundle-Version"] || "",
    manifest,
    metainfo,
    participants,
    messageFlows,
    processes,
    scripts,
    resources,
    parametersProp,
    parametersDefined,
  };
}

module.exports = { parseZipBuffer };
