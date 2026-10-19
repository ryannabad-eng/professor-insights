importScripts("quick-rate.js");

const POLYRATINGS_API = "https://api-prod.polyratings.org";
const POLYRATINGS_FALLBACK = "https://raw.githubusercontent.com/Polyratings/polyratings-data/data/professor-list.json";
const CACHE_KEY = "professorInsights.polyratingsIndex.v1";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_RESULTS = 20;
const NETWORK_TIMEOUT_MS = 12000;
const CAL_POLY_PORTAL_PERMISSION = "https://cmsweb.pscs.calpoly.edu/*";
const RMP_RESOLVE_CACHE_TTL_MS = 30 * 60 * 1000;
const quickRate = globalThis.__PROFESSOR_INSIGHTS_QUICK_RATE__;

let memoryCache = null;
const detailsCache = new Map();
const rmpResolveCache = new Map();
const rmpSchoolSearchCache = new Map();
const frameContexts = new Map();
const injectingTabs = new Set();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    const portalPermission = await requestPortalPermission(tab);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["quick-rate.js", "albums.js", "content.js"]
    });

    const panelState = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Boolean(window.__professorInsightsAppV2)
    });

    if (!panelState[0]?.result) {
      await stopDetectors(tab.id);
      return;
    }

    if (portalPermission === false) {
      chrome.tabs.sendMessage(tab.id, { type: "PI_PORTAL_ACCESS_MISSING" }, { frameId: 0 }, () => void chrome.runtime.lastError);
    }

    await injectDetectors(tab.id);
  } catch (error) {
    console.warn("Professor Insights could not open on this page.", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === "PI_DETECTOR_CONTEXT") {
    updateFrameContext(sender, message.context);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "PI_DETECTOR_REMOVED") {
    removeFrameContext(sender);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "PI_GET_PAGE_CONTEXT") {
    if (Number.isInteger(sender.tab?.id) && !frameContexts.has(sender.tab.id)) injectDetectors(sender.tab.id).catch(() => {});
    sendResponse({ ok: true, context: aggregateFrameContexts(sender.tab?.id) });
    return;
  }

  if (message.type === "PI_RESCAN_PAGE") {
    rescanDetectors(sender.tab?.id);
    injectDetectors(sender.tab?.id)
      .then(() => sendResponse({ ok: true, context: aggregateFrameContexts(sender.tab?.id) }))
      .catch(() => sendResponse({ ok: true, context: aggregateFrameContexts(sender.tab?.id) }));
    return true;
  }

  if (message.type === "PI_REINJECT_DETECTORS") {
    injectDetectors(sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "PI_PANEL_CLOSED") {
    stopDetectors(sender.tab?.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "PI_OPEN_RMP_RATING") {
    openRmpRatingPage(message.professor, message.school)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "PI_LOOKUP_RMP_PROFESSOR") {
    resolveRmpProfessor(message.professor, message.school)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "PI_SEARCH_RMP_SCHOOLS") {
    searchRmpSchools(message.query)
      .then((schools) => sendResponse({ ok: true, schools }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (!["PI_LOOKUP_PAGE", "PI_SEARCH", "PI_DETAILS"].includes(message.type)) return;

  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  frameContexts.delete(tabId);
  injectingTabs.delete(tabId);
});

async function requestPortalPermission(tab) {
  let hostname = "";
  try { hostname = new URL(tab.url || "").hostname.toLowerCase(); } catch (_error) { return null; }
  if (hostname !== "calpoly.edu" && !hostname.endsWith(".calpoly.edu")) return null;

  const permission = { origins: [CAL_POLY_PORTAL_PERMISSION] };
  try { return await chrome.permissions.request(permission); } catch (_error) { return false; }
}

function cleanPageContext(context) {
  return {
    candidates: cleanStringList(context?.candidates, 200),
    courseCodes: cleanStringList(context?.courseCodes, 75)
  };
}

function updateFrameContext(sender, rawContext) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return;
  const shouldRebuildAllFrames = !frameContexts.has(tabId) && !injectingTabs.has(tabId);
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const tabContexts = frameContexts.get(tabId) || new Map();
  tabContexts.set(frameId, cleanPageContext(rawContext));
  frameContexts.set(tabId, tabContexts);
  notifyTopFrame(tabId);
  if (shouldRebuildAllFrames) injectDetectors(tabId).catch(() => {});
}

function removeFrameContext(sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return;
  const tabContexts = frameContexts.get(tabId);
  if (!tabContexts) return;
  tabContexts.delete(Number.isInteger(sender.frameId) ? sender.frameId : 0);
  if (!tabContexts.size) frameContexts.delete(tabId);
  notifyTopFrame(tabId);
}

function aggregateFrameContexts(tabId) {
  const tabContexts = Number.isInteger(tabId) ? frameContexts.get(tabId) : null;
  const candidates = new Set();
  const courseCodes = new Set();

  tabContexts?.forEach((context) => {
    context.candidates.forEach((candidate) => candidates.add(candidate));
    context.courseCodes.forEach((course) => courseCodes.add(course));
  });

  return {
    candidates: [...candidates].slice(0, 200),
    courseCodes: [...courseCodes].slice(0, 75),
    frameCount: tabContexts?.size || 0
  };
}

function notifyTopFrame(tabId) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(
    tabId,
    { type: "PI_PAGE_CONTEXT_UPDATED", context: aggregateFrameContexts(tabId) },
    { frameId: 0 },
    () => void chrome.runtime.lastError
  );
}

function rescanDetectors(tabId) {
  if (!Number.isInteger(tabId)) return;
  const frameIds = [...(frameContexts.get(tabId)?.keys() || [0])];
  frameIds.forEach((frameId) => {
    chrome.tabs.sendMessage(tabId, { type: "PI_DETECTOR_RESCAN" }, { frameId }, () => void chrome.runtime.lastError);
  });
}

async function injectDetectors(tabId) {
  if (!Number.isInteger(tabId) || injectingTabs.has(tabId)) return;
  injectingTabs.add(tabId);
  frameContexts.delete(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["detector.js"]
    });
  } finally {
    setTimeout(() => injectingTabs.delete(tabId), 750);
  }
}

async function stopDetectors(tabId) {
  if (!Number.isInteger(tabId)) return;
  injectingTabs.delete(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__professorInsightsDetectorV1?.destroy?.(false)
    });
  } catch (_error) { /* Frames can disappear while a panel is closing. */ }
  frameContexts.delete(tabId);
}

async function handleMessage(message) {
  if (message.type === "PI_DETAILS") return getProfessorDetails(message.id);

  const index = await getProfessorIndex(Boolean(message.forceRefresh));
  const courseCodes = cleanStringList(message.courseCodes, 50);

  if (message.type === "PI_SEARCH") {
    const query = String(message.query || "").slice(0, 100);
    return {
      professors: searchProfessors(index.professors, query, courseCodes, 10),
      fetchedAt: index.fetchedAt,
      source: index.source,
      stale: index.stale
    };
  }

  const candidates = cleanStringList(message.candidates, 100);
  return {
    professors: matchPageProfessors(index.professors, candidates, courseCodes),
    fetchedAt: index.fetchedAt,
    source: index.source,
    stale: index.stale
  };
}

function cleanRmpProfessor(professor) {
  const source = professor && typeof professor === "object" && !Array.isArray(professor) ? professor : {};
  return {
    id: String(source.id || "").slice(0, 80),
    name: String(source.name || "").trim().slice(0, 120),
    firstName: String(source.firstName || "").trim().slice(0, 80),
    lastName: String(source.lastName || "").trim().slice(0, 80),
    department: String(source.department || "").trim().slice(0, 100)
  };
}

function cleanRmpSchool(school) {
  return quickRate?.cleanSchool(school) || { id: "", nodeId: "", name: "", city: "", state: "" };
}

async function searchRmpSchools(rawQuery) {
  if (!quickRate) throw new Error("The RMP resolver did not load");
  const query = String(rawQuery || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (query.length < 2) throw new Error("Enter at least two characters for the school");

  const cacheKey = query.toLowerCase();
  const cached = rmpSchoolSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.resolvedAt < RMP_RESOLVE_CACHE_TTL_MS) return cached.schools;

  const response = await fetchWithTimeout(quickRate.buildRmpSchoolSearchUrl(query), {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "text/html,application/xhtml+xml" }
  });
  if (!response.ok) throw new Error(`RMP school search returned ${response.status}`);

  const schools = quickRate.findRmpSchoolsInHtml(await response.text());
  rmpSchoolSearchCache.set(cacheKey, { resolvedAt: Date.now(), schools });
  return schools;
}

async function resolveRmpProfessor(rawProfessor, rawSchool) {
  if (!quickRate) throw new Error("The RMP resolver did not load");
  const professor = cleanRmpProfessor(rawProfessor);
  const school = cleanRmpSchool(rawSchool);
  const displayName = quickRate.professorName(professor);
  if (!displayName) throw new Error("A professor name is required");
  if (!school.id || !school.nodeId) throw new Error("Choose a school before opening RMP");

  const cacheKey = `${school.id}|${professor.firstName}|${professor.lastName}|${displayName}`.toLowerCase();
  const cached = rmpResolveCache.get(cacheKey);
  if (cached && Date.now() - cached.resolvedAt < RMP_RESOLVE_CACHE_TTL_MS) return cached.result;

  const searchUrl = quickRate.buildRmpSearchUrl(professor, school);
  const response = await fetchWithTimeout(searchUrl, {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "text/html,application/xhtml+xml" }
  });
  if (!response.ok) throw new Error(`RMP search returned ${response.status}`);

  const result = quickRate.resolveRmpSearchHtml(await response.text(), professor, school);
  rmpResolveCache.set(cacheKey, { resolvedAt: Date.now(), result });
  return result;
}

async function openRmpRatingPage(professor, school) {
  const result = await resolveRmpProfessor(professor, school);
  if (result.match !== "exact" || !result.ratingUrl) return { ...result, opened: false };
  await chrome.tabs.create({ url: result.ratingUrl, active: true });
  return { ...result, opened: true };
}

async function getProfessorIndex(forceRefresh = false) {
  if (!forceRefresh && memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return { ...memoryCache, stale: false };
  }

  const stored = await chrome.storage.local.get(CACHE_KEY);
  const saved = stored[CACHE_KEY];
  const savedIsUsable = isValidCache(saved);

  if (!forceRefresh && savedIsUsable && Date.now() - saved.fetchedAt < CACHE_TTL_MS) {
    memoryCache = saved;
    return { ...saved, stale: false };
  }

  try {
    const live = await fetchLiveIndex();
    memoryCache = live;
    await chrome.storage.local.set({ [CACHE_KEY]: live });
    return { ...live, stale: false };
  } catch (primaryError) {
    try {
      const fallback = await fetchFallbackIndex();
      memoryCache = fallback;
      await chrome.storage.local.set({ [CACHE_KEY]: fallback });
      return { ...fallback, stale: false };
    } catch (fallbackError) {
      if (savedIsUsable) {
        memoryCache = saved;
        return { ...saved, stale: true };
      }
      throw new Error(`PolyRatings is unavailable (${primaryError.message}; ${fallbackError.message})`);
    }
  }
}

async function fetchLiveIndex() {
  const response = await fetchWithTimeout(`${POLYRATINGS_API}/professors.all`, { cache: "no-store" });
  if (!response.ok) throw new Error(`API returned ${response.status}`);

  const payload = await response.json();
  const professors = payload?.result?.data;
  if (!Array.isArray(professors) || professors.length < 100) throw new Error("API returned an unexpected response");

  return { professors, fetchedAt: Date.now(), source: "PolyRatings API" };
}

async function fetchFallbackIndex() {
  const response = await fetchWithTimeout(POLYRATINGS_FALLBACK, { cache: "no-store" });
  if (!response.ok) throw new Error(`fallback returned ${response.status}`);

  const professors = await response.json();
  if (!Array.isArray(professors) || professors.length < 100) throw new Error("fallback returned an unexpected response");

  return { professors, fetchedAt: Date.now(), source: "PolyRatings open-data backup" };
}

function isValidCache(value) {
  return Boolean(value && Number.isFinite(value.fetchedAt) && Array.isArray(value.professors) && value.professors.length > 100);
}

function cleanStringList(value, limit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim().slice(0, 120)).filter(Boolean))].slice(0, limit);
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(?:professor|prof|instructor|dr)\.?\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function scoreName(query, professor) {
  const candidate = normalize(query);
  if (!candidate) return 0;

  const first = normalize(professor.firstName);
  const last = normalize(professor.lastName);
  const full = `${first} ${last}`.trim();
  const reverse = `${last} ${first}`.trim();

  if (candidate === full || candidate === reverse) return 100;

  const candidateTokens = candidate.split(" ").filter(Boolean);
  const nameTokens = new Set(full.split(" ").filter(Boolean));
  if (candidateTokens.length >= 2 && candidateTokens.every((token) => nameTokens.has(token))) return 92;
  const ignoredSuffixes = new Set(["jr", "sr", "ii", "iii", "iv"]);
  const meaningfulTokens = candidateTokens.filter((token) => token.length > 1 && !ignoredSuffixes.has(token));
  if (meaningfulTokens.length >= 2 && meaningfulTokens.every((token) => nameTokens.has(token))) return 94;
  const candidateWithoutSuffix = candidateTokens.filter((token) => !ignoredSuffixes.has(token));
  const firstToken = first.split(" ")[0] || "";
  const givenNameMatches = (token) => token === firstToken || (token.length === 1 && firstToken.startsWith(token));
  if (candidateWithoutSuffix.length >= 2) {
    const leading = candidateWithoutSuffix[0];
    const trailing = candidateWithoutSuffix[candidateWithoutSuffix.length - 1];
    if ((trailing === last && givenNameMatches(leading)) || (leading === last && givenNameMatches(trailing))) return 93;
  }
  if (full.includes(candidate) || reverse.includes(candidate)) return 82;
  if (candidateTokens.length === 1 && candidate === last) return 70;
  return 0;
}

function compactCourse(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function courseScore(professor, courseCodes) {
  const wanted = new Set(courseCodes.map(compactCourse));
  return (professor.courses || []).some((course) => wanted.has(compactCourse(course))) ? 5 : 0;
}

function chooseCourse(professor, courseCodes) {
  const wanted = new Set(courseCodes.map(compactCourse));
  const matches = (professor.courses || []).filter((course) => wanted.has(compactCourse(course)));
  if (matches.length) return matches.slice(0, 3).join(" · ");
  return professor.courses?.[0] || "Course not listed";
}

function matchPageProfessors(professors, candidates, courseCodes) {
  const matches = new Map();

  for (const candidate of candidates) {
    let best = null;
    for (const professor of professors) {
      const score = scoreName(candidate, professor) + courseScore(professor, courseCodes);
      if (!best || score > best.score) best = { professor, score, candidate };
    }
    if (best && best.score >= 92 && !matches.has(best.professor.id)) matches.set(best.professor.id, best);
  }

  return [...matches.values()]
    .sort((a, b) => b.score - a.score || (b.professor.numEvals || 0) - (a.professor.numEvals || 0))
    .slice(0, MAX_RESULTS)
    .map(({ professor, candidate }) => makeSummary(professor, courseCodes, candidate));
}

function searchProfessors(professors, query, courseCodes, limit) {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];

  return professors
    .map((professor) => ({ professor, score: scoreName(query, professor) + courseScore(professor, courseCodes) }))
    .filter(({ score }) => score >= 70)
    .sort((a, b) => b.score - a.score || (b.professor.numEvals || 0) - (a.professor.numEvals || 0))
    .slice(0, limit)
    .map(({ professor }) => makeSummary(professor, courseCodes, query));
}

function makeSummary(professor, courseCodes, matchedText) {
  const name = `${professor.firstName || ""} ${professor.lastName || ""}`.trim();
  const tags = Object.entries(professor.tags || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 2)
    .map(([tag]) => tag);

  return {
    id: professor.id,
    name,
    firstName: professor.firstName || "",
    lastName: professor.lastName || "",
    matchedText,
    department: professor.department || "Department not listed",
    course: chooseCourse(professor, courseCodes),
    courses: Array.isArray(professor.courses) ? professor.courses.slice(0, 30) : [],
    rating: finiteOrNull(professor.overallRating),
    reviews: Number(professor.numEvals) || 0,
    clarity: finiteOrNull(professor.materialClear),
    studentSupport: finiteOrNull(professor.studentDifficulties),
    lastRatingDate: professor.lastRatingDate || null,
    tags,
    links: {
      polyratings: `https://polyratings.dev/professor/${encodeURIComponent(professor.id)}`,
      reddit: `https://www.reddit.com/r/CalPoly/search/?q=${encodeURIComponent(`"${name}"`)}&restrict_sr=1&sort=relevance&t=all`
    }
  };
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getProfessorDetails(id) {
  const cleanId = String(id || "");
  if (!/^[0-9a-f-]{36}$/i.test(cleanId)) throw new Error("Invalid professor id");
  if (detailsCache.has(cleanId)) return detailsCache.get(cleanId);

  const input = encodeURIComponent(JSON.stringify({ id: cleanId }));
  const response = await fetchWithTimeout(`${POLYRATINGS_API}/professors.get?input=${input}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Review request returned ${response.status}`);

  const payload = await response.json();
  const professor = payload?.result?.data;
  if (!professor || !professor.reviews) throw new Error("No review details were returned");

  const reviews = Object.entries(professor.reviews)
    .flatMap(([course, items]) => (Array.isArray(items) ? items.map((review) => ({ course, ...review })) : []))
    .sort((a, b) => new Date(b.postDate || 0) - new Date(a.postDate || 0))
    .slice(0, 3)
    .map((review) => ({
      course: String(review.course || "Course not listed").slice(0, 40),
      text: String(review.rating || "No written comment.").replace(/\s+/g, " ").trim().slice(0, 350),
      date: review.postDate || null,
      rating: finiteOrNull(review.overallRating)
    }));

  const result = { reviews };
  detailsCache.set(cleanId, result);
  return result;
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return message.slice(0, 240);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
