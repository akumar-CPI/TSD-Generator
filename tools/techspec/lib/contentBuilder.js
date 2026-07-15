"use strict";
// Builds all narrative/descriptive content for the TSD purely by templating
// over the parsed iFlow data — no external calls, no third-party model,
// nothing leaves this machine. Every field here is either a direct fact
// pulled from the XML or a simple derived summary (counts, detected auth
// methods, redacted-secret findings), never a guess.

const SECRET_KEY_PATTERN = /api[-_]?key|apikey|secret|password|passwd|token|authorization|privatekey|client[-_]?secret/i;

function stepDescription(step) {
  const t = step.type || "";
  if (t === "Content Modifier") {
    const h = (step.headerTable || []).length;
    const p = (step.propertyTable || []).length;
    if (!h && !p) return "Content Modifier step (no headers or exchange properties configured).";
    const parts = [];
    if (h) parts.push(`${h} header${h === 1 ? "" : "s"}`);
    if (p) parts.push(`${p} exchange propert${p === 1 ? "y" : "ies"}`);
    return `Content Modifier step that sets ${parts.join(" and ")}.`;
  }
  if (t === "Groovy Script" || /^Script/.test(t)) {
    return step.scriptFile ? `Custom transformation logic implemented in ${step.scriptFile}.` : "Custom script step (no script file reference found).";
  }
  if (t === "Request-Reply / External Call") return "Calls an external system via the adapter configured in Section 3.7 Connectivity.";
  if (t === "Router") return "Routes the message down one of several branches based on configured conditions.";
  if (t === "Splitter") return "Splits the message into multiple parts for individual downstream processing.";
  if (t === "Message Mapping") return "Transforms the message using a graphical message mapping.";
  if (t === "Error Start Event") return "Entry point for this exception subprocess; catches runtime errors raised during processing.";
  if (t === "Timer Start Event") return "Starts the process on a schedule.";
  if (step.xmlTag === "startEvent") return "Marks the start of the process.";
  if (step.xmlTag === "endEvent") return "Marks the end of the process.";
  return `Step of type "${t}".`;
}

function collectAllSteps(proc) {
  const out = [];
  proc.steps.forEach((s) => out.push(s));
  (proc.subProcesses || []).forEach((sub) => out.push(...collectAllSteps(sub)));
  return out;
}

function buildContent(parsed) {
  const mainProc = parsed.processes[0];
  const allSteps = mainProc ? collectAllSteps(mainProc) : [];
  const subCount = mainProc ? (mainProc.subProcesses || []).length : 0;

  // ---- stepDescriptions ----
  const stepDescriptions = {};
  allSteps.forEach((s) => (stepDescriptions[s.id] = stepDescription(s)));

  // ---- highLevelSummary ----
  const channelSummary = parsed.messageFlows
    .map((mf) => `${mf.name || mf.props.ComponentType || "channel"} (${mf.props.ComponentType || mf.props.TransportProtocol || "?"}, ${mf.props.direction || "?"})`)
    .join(", ");
  const highLevelSummary = `This iFlow contains ${allSteps.length} step(s) across ${subCount} subprocess(es). ` +
    (channelSummary ? `Configured channels: ${channelSummary}.` : "No adapter channels are configured.");

  // ---- security ----
  const authMethods = new Set();
  parsed.messageFlows.forEach((mf) => {
    const a = mf.props.authenticationMethod || mf.props.authentication;
    if (a) authMethods.add(a);
  });
  const securityNote = authMethods.size
    ? `Authentication method(s) detected across configured channels: ${[...authMethods].join(", ")}.`
    : "No authentication configuration was detected on the configured channels.";
  const securityRows = parsed.messageFlows.map((mf) => [
    mf.name || mf.props.ComponentType || "Channel",
    mf.props.authenticationMethod || mf.props.authentication || "\u2014",
    "Automatically detected from iFlow configuration \u2014 verify at deployment.",
  ]);

  // ---- monitoring ----
  const errorSteps = allSteps.filter((s) => s.type === "Error Start Event" || s.type === "Error Event Subprocess");
  const monitoringNote = errorSteps.length
    ? `${errorSteps.length} exception subprocess entry point(s) were found in this iFlow.`
    : "No exception subprocess was found in this iFlow \u2014 verify error handling is configured as expected.";
  const errorHandlingBullets = errorSteps.length
    ? errorSteps.map((s) => `"${s.name || s.id}" catches exceptions raised during message processing.`)
    : ["No explicit exception subprocess was found in this iFlow."];

  // ---- connectivity ----
  const connectivityNote = parsed.messageFlows.length
    ? `This iFlow has ${parsed.messageFlows.length} configured channel(s): ${channelSummary}.`
    : "No adapter channels are configured in this iFlow.";

  // ---- test plan (generic, structurally-derived, not fabricated business scenarios) ----
  const testPlanRows = [
    ["Verify successful processing of a valid message end-to-end", "Inside SAP (IS)"],
    ...errorSteps.map((s) => [`Verify error handling behavior when "${s.name || s.id}" is triggered`, "Inside SAP (IS)"]),
    ...parsed.messageFlows.map((mf) => [`Verify connectivity/authentication for channel "${mf.name || mf.props.ComponentType}"`, "Both (BO)"]),
  ];

  // ---- review: only objectively-detectable findings (e.g. redacted secrets), no subjective judgment ----
  const reviewRows = [];
  allSteps.forEach((s) => {
    [...(s.headerTable || []), ...(s.propertyTable || [])].forEach((row) => {
      const name = row.Name || row.name || "";
      if (SECRET_KEY_PATTERN.test(name)) {
        reviewRows.push(["\ud83d\udd34 High", "Security", `Hardcoded credential-like value found in step "${s.name}" (property "${name}").`, "Externalize as a Secure Parameter / User Credential and reference it via a property placeholder."]);
      }
    });
  });

  const appendixBullets = [
    "This document was generated automatically from the iFlow export \u2014 no external services were called and no data left this pipeline. Narrative fields are templated from the parsed configuration only; review and expand manually where deeper business context is needed.",
  ];

  return {
    stepDescriptions,
    highLevelSummary,
    securityNote,
    securityRows,
    monitoringNote,
    errorHandlingBullets,
    connectivityNote,
    testPlanRows,
    reviewRows,
    appendixBullets,
  };
}

module.exports = { buildContent };
