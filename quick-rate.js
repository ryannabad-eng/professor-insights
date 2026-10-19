(() => {
  "use strict";

  const RMP_ORIGIN = "https://www.ratemyprofessors.com";
  const CAL_POLY_SCHOOL = Object.freeze({
    id: "153",
    nodeId: "U2Nob29sLTE1Mw==",
    name: "California Polytechnic State University",
    city: "San Luis Obispo",
    state: "CA"
  });

  function cleanString(value) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    return String(value).trim();
  }

  function professorName(professor) {
    const explicitName = cleanString(professor?.name || professor?.professorName);
    if (explicitName) return explicitName;
    return [cleanString(professor?.firstName), cleanString(professor?.lastName)].filter(Boolean).join(" ");
  }

  function normalizeNamePart(value) {
    return cleanString(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(?:professor|prof|instructor|doctor|dr|mr|mrs|ms)\.?\b/gi, " ")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase();
  }

  function nameParts(professor) {
    const explicitFirst = normalizeNamePart(professor?.firstName);
    const explicitLast = normalizeNamePart(professor?.lastName).replace(/\s+(?:jr|sr|ii|iii|iv)$/i, "");
    if (explicitFirst && explicitLast) return { first: explicitFirst, last: explicitLast };

    const rawName = professorName(professor);
    const commaParts = rawName.split(",").map((part) => normalizeNamePart(part)).filter(Boolean);
    if (commaParts.length >= 2) {
      return {
        first: commaParts.slice(1).join(" "),
        last: commaParts[0].replace(/\s+(?:jr|sr|ii|iii|iv)$/i, "")
      };
    }

    const tokens = normalizeNamePart(rawName).split(" ").filter(Boolean);
    while (tokens.length > 2 && /^(?:jr|sr|ii|iii|iv)$/.test(tokens.at(-1))) tokens.pop();
    return { first: tokens[0] || "", last: tokens.at(-1) || "" };
  }

  function givenNamesMatch(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    const leftTokens = left.split(" ").filter(Boolean);
    const rightTokens = right.split(" ").filter(Boolean);
    if (leftTokens[0] !== rightTokens[0]) return false;
    const extras = leftTokens.length > rightTokens.length ? leftTokens.slice(rightTokens.length) : rightTokens.slice(leftTokens.length);
    return extras.length > 0 && extras.every((token) => token.length === 1);
  }

  function professorInitials(name) {
    const parts = nameParts({ name });
    if (parts.first && parts.first === parts.last) return parts.first[0].toLocaleUpperCase();
    return `${parts.first[0] || ""}${parts.last[0] || ""}`.toLocaleUpperCase() || "?";
  }

  function professorSearchName(professor) {
    const explicit = [cleanString(professor?.firstName), cleanString(professor?.lastName)].filter(Boolean).join(" ");
    if (explicit) return explicit;
    const raw = professorName(professor);
    const commaParts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    return commaParts.length >= 2 ? `${commaParts.slice(1).join(" ")} ${commaParts[0]}`.trim() : raw;
  }

  function validLegacyId(value) {
    const id = String(value ?? "").trim();
    return /^\d{1,12}$/.test(id) && Number(id) > 0 ? id : "";
  }

  function finiteMetric(value, minimum = 0, maximum = Infinity) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
  }

  function cleanSchool(school) {
    const source = school && typeof school === "object" && !Array.isArray(school) ? school : { id: school };
    return {
      id: validLegacyId(source.id || source.legacyId),
      nodeId: cleanString(source.nodeId || source.relayId),
      name: cleanString(source.name).slice(0, 160),
      city: cleanString(source.city).slice(0, 100),
      state: cleanString(source.state).slice(0, 60)
    };
  }

  function buildRmpSchoolSearchUrl(query) {
    return `${RMP_ORIGIN}/search/schools?q=${encodeURIComponent(cleanString(query))}`;
  }

  function buildRmpSearchUrl(professor, school = CAL_POLY_SCHOOL) {
    const schoolId = cleanSchool(school).id;
    if (!schoolId) return "";
    return `${RMP_ORIGIN}/search/professors/${schoolId}?q=${encodeURIComponent(professorSearchName(professor))}`;
  }

  function buildRmpProfileUrl(legacyId) {
    const id = validLegacyId(legacyId);
    return id ? `${RMP_ORIGIN}/professor/${id}` : "";
  }

  function buildRmpRatingUrl(legacyId) {
    const id = validLegacyId(legacyId);
    return id ? `${RMP_ORIGIN}/add/professor-rating/${id}` : "";
  }

  function extractRelayStore(html) {
    const source = String(html || "");
    const marker = "window.__RELAY_STORE__";
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) throw new Error("RMP search data was not found");

    const assignmentIndex = source.indexOf("=", markerIndex + marker.length);
    const start = source.indexOf("{", assignmentIndex + 1);
    if (assignmentIndex < 0 || start < 0) throw new Error("RMP search data was incomplete");

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) return JSON.parse(source.slice(start, index + 1));
      }
    }
    throw new Error("RMP search data was incomplete");
  }

  function findRmpSchools(store) {
    const seen = new Set();
    return Object.values(store || {}).flatMap((record) => {
      if (!record || record.__typename !== "School") return [];
      const school = cleanSchool({
        id: record.legacyId,
        nodeId: record.id || record.__id,
        name: record.name,
        city: record.city,
        state: record.state
      });
      if (!school.id || !school.nodeId || !school.name || seen.has(school.id)) return [];
      seen.add(school.id);
      return [school];
    }).slice(0, 8);
  }

  function findRmpSchoolsInHtml(html) {
    return findRmpSchools(extractRelayStore(html));
  }

  function belongsToSchool(teacher, store, selectedSchool) {
    const school = cleanSchool(selectedSchool);
    const schoolReference = cleanString(teacher?.school?.__ref);
    if (!school.id || !schoolReference) return false;
    if (school.nodeId && schoolReference === school.nodeId) return true;
    return Number(store?.[schoolReference]?.legacyId) === Number(school.id);
  }

  function findExactProfessorMatch(store, professor, selectedSchool = CAL_POLY_SCHOOL) {
    const school = cleanSchool(selectedSchool);
    const searchUrl = buildRmpSearchUrl(professor, school);
    if (!school.id) return { match: "not-found", reason: "invalid-school", searchUrl };

    const target = nameParts(professor);
    if (!target.first || !target.last) return { match: "not-found", reason: "invalid-name", searchUrl };

    const matches = Object.values(store || {}).filter((record) => {
      if (!record || record.__typename !== "Teacher" || !validLegacyId(record.legacyId)) return false;
      if (!belongsToSchool(record, store, school)) return false;
      const candidate = nameParts({ firstName: record.firstName, lastName: record.lastName });
      return candidate.last === target.last && givenNamesMatch(candidate.first, target.first);
    });

    if (matches.length !== 1) {
      return { match: matches.length > 1 ? "ambiguous" : "not-found", reason: matches.length > 1 ? "multiple-matches" : "no-match", searchUrl };
    }

    const teacher = matches[0];
    const legacyId = validLegacyId(teacher.legacyId);
    return {
      match: "exact",
      legacyId,
      name: [cleanString(teacher.firstName), cleanString(teacher.lastName)].filter(Boolean).join(" "),
      department: cleanString(teacher.department),
      avgRating: finiteMetric(teacher.avgRating, 0, 5),
      avgDifficulty: finiteMetric(teacher.avgDifficulty, 0, 5),
      numRatings: finiteMetric(teacher.numRatings, 0),
      wouldTakeAgainPercent: finiteMetric(teacher.wouldTakeAgainPercent, 0, 100),
      school,
      profileUrl: buildRmpProfileUrl(legacyId),
      ratingUrl: buildRmpRatingUrl(legacyId),
      searchUrl
    };
  }

  function resolveRmpSearchHtml(html, professor, selectedSchool = CAL_POLY_SCHOOL) {
    return findExactProfessorMatch(extractRelayStore(html), professor, selectedSchool);
  }

  globalThis.__PROFESSOR_INSIGHTS_QUICK_RATE__ = Object.freeze({
    RMP_ORIGIN,
    CAL_POLY_SCHOOL,
    professorName,
    professorInitials,
    cleanSchool,
    buildRmpSchoolSearchUrl,
    buildRmpSearchUrl,
    buildRmpProfileUrl,
    buildRmpRatingUrl,
    extractRelayStore,
    findRmpSchools,
    findRmpSchoolsInHtml,
    findExactProfessorMatch,
    resolveRmpSearchHtml
  });
})();
