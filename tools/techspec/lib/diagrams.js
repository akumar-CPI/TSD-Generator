"use strict";
// Node port of src/diagrams.js — identical drawing logic, swapped from the
// browser Canvas2D API to node-canvas. node-canvas's API is close enough to
// the browser's that only canvas creation + buffer extraction differ.

const { createCanvas } = require("canvas");

const NAVY = "#1F3864";
const NAVY_LIGHT = "#dee7f6";
const GREEN = "#375623";
const GREEN_LIGHT = "#e2efda";
const AMBER = "#bf8f00";
const AMBER_LIGHT = "#fff4d6";
const GREY = "#969696";
const GREY_LIGHT = "#ebebeb";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  words.forEach((w) => {
    const test = (cur + " " + w).trim();
    if (ctx.measureText(test).width <= maxWidth) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  });
  if (cur) lines.push(cur);
  return lines;
}

function box(ctx, x, y, w, h, label, { fill = NAVY_LIGHT, stroke = NAVY, fontSize = 13, textColor = "#1b2130" } = {}) {
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, label, w - 16);
  const lineH = fontSize + 5;
  let ty = y + h / 2 - (lines.length * lineH) / 2 + lineH / 2;
  lines.forEach((line) => {
    ctx.fillText(line, x + w / 2, ty);
    ty += lineH;
  });
}

function ellipse(ctx, x, y, w, h, label, { fill = NAVY_LIGHT, stroke = NAVY, fontSize = 11, textColor = "#1b2130" } = {}) {
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, label, w - 12);
  const lineH = fontSize + 4;
  let ty = y + h / 2 - (lines.length * lineH) / 2 + lineH / 2;
  lines.forEach((line) => {
    ctx.fillText(line, x + w / 2, ty);
    ty += lineH;
  });
}

function arrow(ctx, x0, y0, x1, y1, { color = NAVY, width = 2.5, dashed = false } = {}) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const hl = 9, ha = 0.45;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - hl * Math.cos(ang - ha), y1 - hl * Math.sin(ang - ha));
  ctx.lineTo(x1 - hl * Math.cos(ang + ha), y1 - hl * Math.sin(ang + ha));
  ctx.closePath();
  ctx.fill();
}

function styleFor(step) {
  const t = (step.type || "").toLowerCase();
  if (t.includes("request-reply") || t.includes("external call")) return { fill: AMBER_LIGHT, stroke: AMBER };
  if (t.includes("script")) return { fill: NAVY_LIGHT, stroke: NAVY };
  if (t.includes("content modifier")) return { fill: NAVY_LIGHT, stroke: NAVY };
  if (t.includes("error start") || t.includes("error event subprocess")) return { fill: GREEN_LIGHT, stroke: GREEN };
  return { fill: NAVY_LIGHT, stroke: NAVY };
}

function generateHighLevelDiagram(parsed) {
  const mainProc = parsed.processes[0];
  const hasSub = mainProc && mainProc.subProcesses && mainProc.subProcesses.length;
  const chain = [];
  const senders = parsed.participants.filter((p) => (p.type || "").toLowerCase().includes("sender"));
  const receivers = parsed.participants.filter((p) => (p.type || "").toLowerCase().includes("recev") || (p.type || "").toLowerCase().includes("receiv"));

  if (senders.length) chain.push({ label: senders.map((s) => s.name).join(" / ") || "Sender", kind: "endpoint" });
  else chain.push({ label: "Trigger", kind: "endpoint" });

  chain.push({ label: parsed.iflowName || "Integration Process", kind: "process" });

  if (hasSub) {
    mainProc.subProcesses[0].steps.slice(0, 5).forEach((s) => chain.push({ label: s.name || s.type, kind: "step" }));
  } else if (mainProc) {
    mainProc.steps.filter((s) => !["startEvent", "endEvent"].includes(s.xmlTag)).slice(0, 5).forEach((s) =>
      chain.push({ label: s.name || s.type, kind: "step" })
    );
  }

  if (receivers.length) receivers.forEach((r) => chain.push({ label: r.name, kind: "endpoint" }));

  const bw = 190, bh = 110, gap = 30;
  const totalW = chain.length * bw + Math.max(0, chain.length - 1) * gap + 60;
  const H = 220;
  const canvas = createCanvas(totalW, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, H);

  const y = (H - bh) / 2;
  const lefts = [];
  chain.forEach((node, i) => {
    const x = 30 + i * (bw + gap);
    lefts.push(x);
    let style = { fill: NAVY_LIGHT, stroke: NAVY };
    if (node.kind === "process") style = { fill: "#fff4d6", stroke: AMBER };
    if (node.kind === "endpoint") style = { fill: GREY_LIGHT, stroke: GREY };
    box(ctx, x, y, bw, bh, node.label, style);
  });
  for (let i = 0; i < chain.length - 1; i++) {
    arrow(ctx, lefts[i] + bw, y + bh / 2, lefts[i + 1], y + bh / 2);
  }

  return { buffer: canvas.toBuffer("image/png"), width: totalW, height: H };
}

function generateDetailedDiagram(parsed) {
  const mainProc = parsed.processes[0];
  if (!mainProc) return null;
  const subs = mainProc.subProcesses || [];

  const W = 1500;
  const rowH = 130;
  const headerH = 60;
  const mainRowH = mainProc.steps.length ? rowH : 70;
  const H = headerH + mainRowH + subs.reduce((a) => a + rowH + 50, 0) + 60;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, W - 40, H - 40);
  ctx.fillStyle = NAVY;
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(mainProc.name || "Integration Process", 36, 44);

  function drawRow(steps, top, label, labelColor) {
    const bw = 170, gap = 22;
    const n = Math.max(steps.length, 1);
    const totalW = n * bw + (n - 1) * gap;
    let x = Math.max(60, (W - totalW) / 2);
    const y = top;
    let prevCx = null;
    steps.forEach((s) => {
      const isEvent = s.xmlTag === "startEvent" || s.xmlTag === "endEvent";
      const style = styleFor(s);
      if (isEvent) {
        ellipse(ctx, x, y + 15, 60, 60, s.name || s.type, style);
      } else {
        box(ctx, x, y, bw, 90, `${s.name || s.type} \u2014 ${s.type}`, style);
      }
      const cx = x + (isEvent ? 30 : bw / 2);
      if (prevCx !== null) {
        arrow(ctx, prevCx, y + 45, isEvent ? x : x, y + 45);
      }
      prevCx = isEvent ? x + 60 : x + bw;
      x += (isEvent ? 60 : bw) + gap;
    });
    if (label) {
      ctx.fillStyle = labelColor || GREY;
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, 40, top - 10);
    }
  }

  let top = headerH + 20;
  drawRow(mainProc.steps, top, "Main process", NAVY);
  top += mainRowH + 30;

  subs.forEach((sub) => {
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    const boxTop = top - 15;
    const boxH = rowH + 30;
    roundRect(ctx, 36, boxTop, W - 72, boxH, 10);
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = GREEN_LIGHT;
    ctx.fill();
    ctx.restore();
    ctx.stroke();
    ctx.fillStyle = GREEN;
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Exception Subprocess \u2014 "${sub.name}"`, 50, boxTop + 22);
    drawRow(sub.steps, top + 40, null);
    top += rowH + 70;
  });

  return { buffer: canvas.toBuffer("image/png"), width: W, height: H };
}

module.exports = { generateHighLevelDiagram, generateDetailedDiagram };
