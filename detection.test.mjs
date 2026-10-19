import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(testDirectory, "..");
const fixtureDirectory = path.join(testDirectory, "fixtures");
const detectorSource = fs.readFileSync(path.join(projectDirectory, "detector.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(projectDirectory, "background.js"), "utf8");

const fixtures = [
  {
    name: "PeopleSoft classic MTG_INSTR field",
    file: "peoplesoft-classic.html",
    candidates: ["Jenkin, Bryce"],
    courseCodes: ["CSC 101"]
  },
  {
    name: "PeopleSoft fluid label/value layout",
    file: "peoplesoft-fluid.html",
    candidates: ["Bryce Jenkin"],
    courseCodes: ["MATH 221"]
  },
  {
    name: "accessible instructor-labelled class card",
    file: "accessible-card.html",
    candidates: ["Chris Carr"],
    courseCodes: ["BUS 304"]
  },
  {
    name: "multiple instructors in one PeopleSoft field",
    file: "peoplesoft-multiple-instructors.html",
    candidates: ["Bryce Jenkin", "Jane Smith"],
    courseCodes: ["CSC 202"]
  },
  {
    name: "modern portal Faculty/data-testid markup",
    file: "modern-registration-card.html",
    candidates: ["Jonathan Wilson"],
    courseCodes: ["HIST 201"]
  },
  {
    name: "current Cal Poly Material UI instructor grid",
    file: "calpoly-mui-grid.html",
    candidates: ["Bryce Jenkin", "Jane Smith"],
    courseCodes: ["CSC 202"]
  },
  {
    name: "ARIA-only instructor control",
    file: "aria-only-instructor.html",
    candidates: ["Jonathan Wilson"],
    courseCodes: ["HIST 201"]
  }
];

for (const fixture of fixtures) {
  test(fixture.name, () => {
    const html = fs.readFileSync(path.join(fixtureDirectory, fixture.file), "utf8");
    const result = runDetector(html);
    assert.deepEqual(sorted(result.candidates), sorted(fixture.candidates));
    assert.deepEqual(sorted(result.courseCodes), sorted(fixture.courseCodes));
  });
}

test("toolbar click scans child frames used by PeopleSoft target content", () => {
  const shell = fs.readFileSync(path.join(fixtureDirectory, "peoplesoft-iframe-shell.html"), "utf8");
  assert.match(shell, /<iframe\b[^>]+id=["']ptifrmtgtframe["']/i);

  // PeopleSoft's delivered portal template places the transaction page in
  // ptifrmtgtframe. Some all-frame discovery/injection is therefore required;
  // the current top-frame-only executeScript call cannot see its instructors.
  const reachesChildFrames = /target\s*:\s*\{[^}]*\ballFrames\s*:\s*true[^}]*\}/s.test(backgroundSource)
    || /\b(?:contentDocument|contentWindow)\b/.test(`${backgroundSource}\n${detectorSource}`);
  assert.ok(reachesChildFrames, "the extension does not inspect or inject PeopleSoft child frames");
});

function runDetector(html) {
  const document = createDocumentFacade(html);
  const context = vm.createContext({ document, __PROFESSOR_INSIGHTS_TEST__: true });
  new vm.Script(detectorSource).runInContext(context);
  return context.__PROFESSOR_INSIGHTS_DETECTOR_TEST_API__.extractPageContext(document);
}

function createDocumentFacade(html) {
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch?.[1] || html;
  return {
    body: { innerText: htmlToInnerText(bodyHtml) },
    querySelectorAll(selector) {
      if (selector === "*" || selector === "dt" || selector === "table") return [];
      assert.match(selector, /MTG_INSTR/); // Guard against silently stale tests.
      return findInstructorElements(bodyHtml);
    }
  };
}

function findInstructorElements(html) {
  const results = [];
  const openingTag = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let match;
  while ((match = openingTag.exec(html))) {
    const [opening, tagName, rawAttributes] = match;
    if (opening.startsWith("</") || !matchesProductionInstructorSelector(rawAttributes)) continue;
    const close = new RegExp(`</${escapeRegex(tagName)}\\s*>`, "gi");
    close.lastIndex = match.index + opening.length;
    const closingMatch = close.exec(html);
    const innerHtml = closingMatch ? html.slice(match.index + opening.length, closingMatch.index) : "";
    // textContent does not add a separator for <br>, while innerText does.
    // Supplying both lets the production parser intentionally choose either.
    const attributes = parseAttributes(rawAttributes);
    results.push({
      textContent: decodeEntities(innerHtml.replace(/<[^>]*>/g, "")),
      innerText: htmlToInnerText(innerHtml),
      querySelectorAll() { return []; },
      getAttribute(name) { return attributes[name.toLowerCase()] ?? null; }
    });
  }
  return results;
}

function matchesProductionInstructorSelector(rawAttributes) {
  const attributes = parseAttributes(rawAttributes);
  return ["MTG_INSTR", "INSTRUCTOR", "INSTR_LONG"].some((token) => attributes.id?.toUpperCase().includes(token))
    || [attributes.name, attributes["data-label"], attributes["data-field"], attributes["data-testid"], attributes["aria-label"], attributes.title, attributes.header, attributes.headers, attributes.class]
      .some((value) => /instructor|faculty-name/i.test(value || ""));
}

function parseAttributes(source) {
  const attributes = {};
  const attribute = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = attribute.exec(source))) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return attributes;
}

function htmlToInnerText(html) {
  return decodeEntities(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}
