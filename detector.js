(() => {
  const DETECTOR_KEY = "__professorInsightsDetectorV1";
  const TEST_API_KEY = "__PROFESSOR_INSIGHTS_DETECTOR_TEST_API__";

  function extractPageContext(rootDocument = document) {
    const candidates = new Set();
    const courseCodes = new Set();
    const roots = [rootDocument];
    let inspectedElements = 0;

    for (let rootIndex = 0; rootIndex < roots.length && rootIndex < 20; rootIndex += 1) {
      const root = roots[rootIndex];
      let everyElement = [];
      try { everyElement = [...root.querySelectorAll("*")]; } catch (_error) { /* Ignore unusual document roots. */ }

      for (const element of everyElement) {
        inspectedElements += 1;
        if (inspectedElements > 20000) break;
        if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
      }

      const selectors = [
        '[id*="MTG_INSTR" i]',
        '[id*="INSTRUCTOR" i]',
        '[id*="INSTR_LONG" i]',
        '[name*="MTG_INSTR" i]',
        '[name*="INSTRUCTOR" i]',
        '[data-label*="instructor" i]',
        '[data-field*="instructor" i]',
        '[data-testid*="instructor" i]',
        '[aria-label*="instructor" i]',
        '[title*="instructor" i]',
        '[header*="instructor" i]',
        '[headers*="instructor" i]',
        '[class*="instructor" i]',
        '[class*="faculty-name" i]'
      ];

      try {
        root.querySelectorAll(selectors.join(",")).forEach((element) => {
          const nestedNames = element.querySelectorAll
            ? [...element.querySelectorAll('p, a, [data-testid*="instructor" i]')].filter((nested) => readElementText(nested))
            : [];

          if (nestedNames.length > 1) nestedNames.forEach((nested) => addCandidate(candidates, readElementText(nested)));
          else addCandidate(candidates, readElementText(element));

          ["aria-label", "data-label", "title", "value"].forEach((attribute) => {
            const attributeValue = element.getAttribute?.(attribute);
            if (attributeValue && /(?:instructor|professor|faculty|teacher)/i.test(attributeValue)) addCandidate(candidates, attributeValue);
          });
        });
      } catch (_error) { /* The flattened-text fallback below still runs. */ }

      try {
        root.querySelectorAll("dt").forEach((label) => {
          if (/^(?:instructor(?:\(s\)|s)?|professor(?:s)?|faculty|teacher)\s*:?$/i.test(readElementText(label))) {
            addCandidate(candidates, readElementText(label.nextElementSibling));
          }
        });
      } catch (_error) { /* Not every root implements full selector APIs. */ }

      try {
        root.querySelectorAll("table").forEach((table) => collectTableInstructorCells(table, candidates));
      } catch (_error) { /* Table extraction is an optional enhancement. */ }

      const rootText = root === rootDocument
        ? rootDocument.body?.innerText || rootDocument.documentElement?.innerText || ""
        : root.textContent || "";
      collectTextContext(rootText, candidates, courseCodes);
    }

    return {
      candidates: [...candidates].slice(0, 200),
      courseCodes: [...courseCodes].slice(0, 75)
    };
  }

  function collectTextContext(rawText, candidates, courseCodes) {
    const text = String(rawText || "");
    const lines = text.split(/\r?\n/).map((line) => line.replace(/[\t ]+/g, " ").trim()).filter(Boolean);
    let nextLineMayBeName = false;

    for (const line of lines) {
      if (/^(?:instructor(?:\(s\)|s)?|professor(?:s)?|faculty|teacher)\s*:?$/i.test(line)) {
        nextLineMayBeName = true;
        continue;
      }
      if (nextLineMayBeName) {
        addCandidate(candidates, line);
        nextLineMayBeName = false;
      }

      const prefixed = line.match(/\b(?:professor|prof\.?|instructor(?:\(s\)|s)?|faculty|teacher)\s*:?\s+([^|·•–—]{3,100})/i);
      if (prefixed) addCandidate(candidates, prefixed[1]);

      const suffixed = line.match(/^([^|·•–—]{3,80}?)\s*(?:\(|[-–—])\s*(?:professor|instructor|faculty|teacher)\b/i);
      if (suffixed) addCandidate(candidates, suffixed[1]);
    }

    for (const match of text.matchAll(/\b([A-Z]{2,6})\s*-?\s*(\d{3,4}[A-Z]?)\b/g)) {
      courseCodes.add(`${match[1]} ${match[2]}`);
    }
  }

  function collectTableInstructorCells(table, candidates) {
    const rows = [...(table.rows || table.querySelectorAll?.("tr") || [])];
    if (!rows.length) return;

    let instructorColumns = [];
    for (const row of rows.slice(0, 3)) {
      const cells = [...(row.cells || row.querySelectorAll?.("th, td") || [])];
      const found = cells.reduce((indexes, cell, index) => {
        if (/^(?:instructor(?:\(s\)|s)?|professor(?:s)?|faculty|teacher)\b/i.test(readElementText(cell))) indexes.push(index);
        return indexes;
      }, []);
      if (found.length) {
        instructorColumns = found;
        break;
      }
    }

    if (!instructorColumns.length) return;
    rows.slice(1).forEach((row) => {
      const cells = [...(row.cells || row.querySelectorAll?.("th, td") || [])];
      instructorColumns.forEach((index) => addCandidate(candidates, readElementText(cells[index])));
    });
  }

  function readElementText(element) {
    if (!element) return "";
    return String(element.innerText || element.textContent || "").trim();
  }

  function addCandidate(collection, rawValue) {
    const source = String(rawValue || "").replace(/\u00a0/g, " ").trim();
    if (!source) return;

    const fragments = source.split(/\r?\n|\s*;\s*|\s+[|·•]\s+/).map((part) => part.trim()).filter(Boolean);
    if (fragments.length > 1) {
      fragments.forEach((part) => addCandidate(collection, part));
      return;
    }

    const commaParts = source.split(/\s*,\s*/).filter(Boolean);
    if (commaParts.length > 1 && commaParts.every((part) => part.split(/\s+/).length >= 2)) {
      commaParts.forEach((part) => addCandidate(collection, part));
      return;
    }

    let value = source.replace(/[\t ]+/g, " ").trim();
    value = value.replace(/^(?:professor|prof\.?|instructor(?:\(s\)|s)?|faculty|teacher)\s*(?:name)?\s*:?\s*/i, "");
    value = value.replace(/\s+(?:email|office|room|section|meeting|schedule|days?|times?|units?|dates?)\s*:?\s.*$/i, "");
    value = value.replace(/\s+(?:[-–—]\s*)?(?:primary|secondary|instructor|professor|faculty|teacher)\s*$/i, "");
    value = value.replace(/\([^)]*\)/g, " ");
    value = value.replace(/(?:,?\s+)(?:Ph\.?D\.?|Ed\.?D\.?|M\.?D\.?|D\.?Sc\.?|J\.?D\.?)\s*$/i, "");
    value = value.replace(/\b(?:M|T|W|Th|F|Sa|Su)(?:\s*\/\s*(?:M|T|W|Th|F|Sa|Su))+\b.*$/i, "");
    value = value.replace(/^[\s,:-]+|[\s,:-]+$/g, "").replace(/\s+/g, " ").trim();

    if (value.length < 3 || value.length > 90 || /\d|@|https?:|\b(?:staff|tba|arranged|none|instructor|professor|faculty|teacher)\b/i.test(value)) return;
    if (!/^[\p{L}][\p{L}'’.\-\s,]+$/u.test(value)) return;

    const words = value.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 7) return;
    collection.add(value);
  }

  if (globalThis.__PROFESSOR_INSIGHTS_TEST__) {
    globalThis[TEST_API_KEY] = { extractPageContext, addCandidate };
    return;
  }

  const existing = window[DETECTOR_KEY];
  if (existing?.destroy) existing.destroy(false);

  const state = { destroyed: false, fingerprint: "", timer: null, observer: null, observedFrames: new Set() };

  function publish(force = false) {
    if (state.destroyed) return;
    const context = extractPageContext();
    const fingerprint = JSON.stringify(context);
    if (!force && fingerprint === state.fingerprint) return;
    state.fingerprint = fingerprint;
    window.__PROFESSOR_INSIGHTS_FRAME_CONTEXT__ = context;

    if (globalThis.chrome?.runtime?.id) {
      chrome.runtime.sendMessage({ type: "PI_DETECTOR_CONTEXT", context }, () => void chrome.runtime.lastError);
    }
  }

  function schedulePublish() {
    watchEmbeddedFrames();
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => publish(false), 250);
  }

  function handleMessage(message) {
    if (message?.type === "PI_DETECTOR_RESCAN") publish(true);
    if (message?.type === "PI_DETECTOR_STOP") destroy(true);
  }

  function watchEmbeddedFrames() {
    let removedFrame = false;
    state.observedFrames.forEach((frame) => {
      if (frame.isConnected) return;
      frame.removeEventListener("load", handleEmbeddedFrameLoad);
      state.observedFrames.delete(frame);
      removedFrame = true;
    });
    document.querySelectorAll("iframe, frame").forEach((frame) => {
      if (state.observedFrames.has(frame)) return;
      state.observedFrames.add(frame);
      frame.addEventListener("load", handleEmbeddedFrameLoad);
    });
    if (removedFrame) requestDetectorReinjection();
  }

  function handleEmbeddedFrameLoad() {
    requestDetectorReinjection();
  }

  function requestDetectorReinjection() {
    if (globalThis.chrome?.runtime?.id) {
      chrome.runtime.sendMessage({ type: "PI_REINJECT_DETECTORS" }, () => void chrome.runtime.lastError);
    }
  }

  function destroy(notify = true) {
    if (state.destroyed) return;
    state.destroyed = true;
    state.observer?.disconnect();
    state.observedFrames.forEach((frame) => frame.removeEventListener("load", handleEmbeddedFrameLoad));
    state.observedFrames.clear();
    window.clearTimeout(state.timer);
    window.removeEventListener("load", schedulePublish);
    window.removeEventListener("pageshow", schedulePublish);
    globalThis.chrome?.runtime?.onMessage?.removeListener(handleMessage);
    if (notify && globalThis.chrome?.runtime?.id) {
      chrome.runtime.sendMessage({ type: "PI_DETECTOR_REMOVED" }, () => void chrome.runtime.lastError);
    }
    delete window[DETECTOR_KEY];
  }

  window[DETECTOR_KEY] = { destroy, rescan: () => publish(true) };
  globalThis.chrome?.runtime?.onMessage?.addListener(handleMessage);
  watchEmbeddedFrames();
  window.addEventListener("load", schedulePublish);
  window.addEventListener("pageshow", schedulePublish);
  state.observer = new MutationObserver(schedulePublish);
  const observationRoot = document.documentElement || document.body;
  if (observationRoot) state.observer.observe(observationRoot, { childList: true, subtree: true, characterData: true, attributes: true });
  publish(true);
})();
