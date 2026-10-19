(() => {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "professorInsights.albums.v1";
  const LIMITS = Object.freeze({
    albums: 30,
    professorsPerAlbum: 100,
    totalProfessors: 1000,
    albumNameLength: 60,
    professorNameLength: 120,
    departmentLength: 120,
    courseLength: 80,
    schoolNameLength: 160,
    schoolLocationLength: 80,
    identifierLength: 160,
    urlLength: 2048
  });

  let generatedIdSequence = 0;

  function emptyLibrary() {
    return { version: VERSION, albums: [] };
  }

  function cleanText(value, maxLength) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    return String(value)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function normalizeText(value) {
    return cleanText(value, 500)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase();
  }

  function validTimestamp(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
  }

  function nowValue(value) {
    return validTimestamp(value, Date.now());
  }

  function cleanIdentifier(value) {
    return cleanText(value, LIMITS.identifierLength).replace(/[^a-zA-Z0-9._:-]/g, "");
  }

  function cleanAlbumId(value) {
    const id = cleanIdentifier(value);
    return id && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id) ? id : "";
  }

  function cleanProfessorKey(value) {
    const key = cleanIdentifier(value).toLowerCase();
    return key && /^(?:rmp|poly|name):/.test(key) ? key : "";
  }

  function safeHttpsUrl(value) {
    const raw = cleanText(value, LIMITS.urlLength);
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      return parsed.protocol === "https:" ? parsed.href : "";
    } catch (_error) {
      return "";
    }
  }

  function finiteMetric(value, minimum, maximum = Number.POSITIVE_INFINITY, integer = false) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
    return integer ? Math.trunc(number) : number;
  }

  function cleanSchool(raw) {
    const school = raw && typeof raw === "object" ? raw : {};
    return {
      id: cleanIdentifier(school.id || school.legacyId),
      name: cleanText(school.name, LIMITS.schoolNameLength),
      city: cleanText(school.city, LIMITS.schoolLocationLength),
      state: cleanText(school.state, LIMITS.schoolLocationLength)
    };
  }

  function normalizeRmp(raw) {
    const nested = raw?.rmp && typeof raw.rmp === "object" ? raw.rmp : {};
    const legacyId = cleanIdentifier(nested.legacyId ?? raw?.rmpLegacyId ?? raw?.legacyId);
    const result = {
      legacyId,
      avgRating: finiteMetric(nested.avgRating ?? raw?.rmpRating ?? raw?.avgRating, 0, 5),
      numRatings: finiteMetric(nested.numRatings ?? raw?.rmpRatings ?? raw?.numRatings, 0, Number.POSITIVE_INFINITY, true),
      avgDifficulty: finiteMetric(nested.avgDifficulty ?? raw?.rmpDifficulty ?? raw?.avgDifficulty, 0, 5),
      wouldTakeAgainPercent: finiteMetric(nested.wouldTakeAgainPercent ?? raw?.rmpWouldTakeAgain ?? raw?.wouldTakeAgainPercent, 0, 100),
      profileUrl: safeHttpsUrl(nested.profileUrl ?? raw?.rmpProfileUrl),
      ratingUrl: safeHttpsUrl(nested.ratingUrl ?? raw?.rmpRatingUrl),
      searchUrl: safeHttpsUrl(nested.searchUrl ?? raw?.rmpSearchUrl)
    };
    return Object.values(result).some((value) => value !== "" && value !== null) ? result : null;
  }

  function normalizePolyRatings(raw) {
    const nested = raw?.polyratings && typeof raw.polyratings === "object" ? raw.polyratings : {};
    const nestedPresent = Boolean(raw?.polyratings && typeof raw.polyratings === "object");
    const linkedProfile = raw?.links?.polyratings;
    const looksLikePolyRatings = nestedPresent || Boolean(linkedProfile) || Boolean(raw?.polyId);
    if (!looksLikePolyRatings) return null;
    const result = {
      id: cleanIdentifier(nested.id ?? raw?.polyId ?? raw?.id),
      rating: finiteMetric(nested.rating ?? raw?.polyRating ?? raw?.rating, 0, 4),
      reviews: finiteMetric(nested.reviews ?? raw?.polyReviews ?? raw?.reviews, 0, Number.POSITIVE_INFINITY, true),
      profileUrl: safeHttpsUrl(nested.profileUrl ?? raw?.polyProfileUrl ?? linkedProfile)
    };
    return Object.values(result).some((value) => value !== "" && value !== null) ? result : null;
  }

  function schoolIdentity(school) {
    return cleanIdentifier(school?.id).toLowerCase() || normalizeText(school?.name).replace(/\s+/g, "-") || "unknown";
  }

  function professorKey(raw) {
    const existing = cleanProfessorKey(raw?.key);
    if (existing) return existing;
    const school = cleanSchool(raw?.school);
    const rmp = normalizeRmp(raw);
    if (rmp?.legacyId) return `rmp:${schoolIdentity(school)}:${rmp.legacyId.toLowerCase()}`;
    const polyratings = normalizePolyRatings(raw);
    if (polyratings?.id) return `poly:${polyratings.id.toLowerCase()}`;
    const name = cleanText(raw?.name || [raw?.firstName, raw?.lastName].filter(Boolean).join(" "), LIMITS.professorNameLength);
    const normalizedName = normalizeText(name).replace(/\s+/g, "-");
    return normalizedName ? `name:${schoolIdentity(school)}:${normalizedName}` : "";
  }

  function normalizeProfessor(raw, options = {}) {
    if (!raw || typeof raw !== "object") return null;
    const timestamp = nowValue(options.now);
    const name = cleanText(raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(" "), LIMITS.professorNameLength);
    if (name.length < 2) return null;
    const school = cleanSchool(raw.school);
    const rmp = normalizeRmp(raw);
    const polyratings = normalizePolyRatings(raw);
    const key = professorKey({ ...raw, name, school, rmp, polyratings });
    if (!key) return null;

    const savedAt = validTimestamp(raw.savedAt, timestamp);
    const updatedAt = Math.max(savedAt, validTimestamp(raw.updatedAt, savedAt));
    const professor = {
      key,
      name,
      department: cleanText(raw.department, LIMITS.departmentLength),
      course: cleanText(raw.course, LIMITS.courseLength),
      school,
      savedAt,
      updatedAt
    };
    if (polyratings) professor.polyratings = polyratings;
    if (rmp) professor.rmp = rmp;
    return professor;
  }

  function professorAliases(professor) {
    const aliases = new Set();
    const key = cleanProfessorKey(professor?.key);
    if (key) aliases.add(key);
    const school = cleanSchool(professor?.school);
    const schoolId = schoolIdentity(school);
    const rmpId = cleanIdentifier(professor?.rmp?.legacyId).toLowerCase();
    const polyId = cleanIdentifier(professor?.polyratings?.id).toLowerCase();
    const name = normalizeText(professor?.name).replace(/\s+/g, "-");
    if (rmpId) aliases.add(`rmp:${schoolId}:${rmpId}`);
    if (polyId) aliases.add(`poly:${polyId}`);
    if (name) aliases.add(`name:${schoolId}:${name}`);
    return aliases;
  }

  function professorsMatch(left, right) {
    const leftRmpId = cleanIdentifier(left?.rmp?.legacyId).toLowerCase();
    const rightRmpId = cleanIdentifier(right?.rmp?.legacyId).toLowerCase();
    if (leftRmpId && rightRmpId && leftRmpId !== rightRmpId) return false;
    const leftPolyId = cleanIdentifier(left?.polyratings?.id).toLowerCase();
    const rightPolyId = cleanIdentifier(right?.polyratings?.id).toLowerCase();
    if (leftPolyId && rightPolyId && leftPolyId !== rightPolyId) return false;
    const leftAliases = professorAliases(left);
    return [...professorAliases(right)].some((alias) => leftAliases.has(alias));
  }

  function mergePresent(left, right) {
    const result = { ...(left || {}) };
    Object.entries(right || {}).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined) result[key] = value;
    });
    return result;
  }

  function mergeProfessor(existing, incoming, timestamp, preserveLatestTimestamp = false) {
    const merged = {
      key: existing.key,
      name: incoming.name || existing.name,
      department: incoming.department || existing.department,
      course: incoming.course || existing.course,
      school: mergePresent(existing.school, incoming.school),
      savedAt: Math.min(existing.savedAt, incoming.savedAt),
      updatedAt: preserveLatestTimestamp ? Math.max(existing.updatedAt, incoming.updatedAt) : existing.updatedAt
    };
    const polyratings = mergePresent(existing.polyratings, incoming.polyratings);
    const rmp = mergePresent(existing.rmp, incoming.rmp);
    if (Object.keys(polyratings).length) merged.polyratings = polyratings;
    if (Object.keys(rmp).length) merged.rmp = rmp;

    if (!preserveLatestTimestamp && professorContent(existing) !== professorContent(merged)) merged.updatedAt = timestamp;
    return merged;
  }

  function professorContent(professor) {
    const { savedAt: _savedAt, updatedAt: _updatedAt, ...content } = professor;
    return JSON.stringify(content);
  }

  function normalizedAlbumName(value, truncate = true) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    const collapsed = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    return truncate ? collapsed.slice(0, LIMITS.albumNameLength) : collapsed;
  }

  function uniqueMigrationId(index, usedIds) {
    let suffix = index + 1;
    let id = `album-${suffix}`;
    while (usedIds.has(id)) id = `album-${++suffix}`;
    return id;
  }

  function normalizeAlbum(raw, index, usedIds, usedNames, remainingCapacity, timestamp) {
    if (!raw || typeof raw !== "object") return null;
    const name = normalizedAlbumName(raw.name);
    const normalizedName = normalizeText(name);
    if (!name || !normalizedName || usedNames.has(normalizedName)) return null;

    const suppliedId = cleanAlbumId(raw.id);
    if (suppliedId && usedIds.has(suppliedId)) return null;
    const id = suppliedId || uniqueMigrationId(index, usedIds);
    const createdAt = validTimestamp(raw.createdAt, timestamp);
    const professors = [];
    const candidates = Array.isArray(raw.professors) ? raw.professors : [];
    const maximum = Math.min(LIMITS.professorsPerAlbum, remainingCapacity);
    for (const candidate of candidates) {
      if (professors.length >= maximum) break;
      const professor = normalizeProfessor(candidate, { now: timestamp });
      if (!professor) continue;
      const duplicateIndex = professors.findIndex((saved) => professorsMatch(saved, professor));
      if (duplicateIndex >= 0) {
        professors[duplicateIndex] = mergeProfessor(professors[duplicateIndex], professor, timestamp, true);
      } else {
        professors.push(professor);
      }
    }
    const latestProfessorUpdate = professors.reduce((latest, professor) => Math.max(latest, professor.updatedAt), createdAt);
    const updatedAt = Math.max(createdAt, validTimestamp(raw.updatedAt, latestProfessorUpdate), latestProfessorUpdate);
    usedIds.add(id);
    usedNames.add(normalizedName);
    return { id, name, createdAt, updatedAt, professors };
  }

  function normalizeLibrary(raw, options = {}) {
    const timestamp = nowValue(options.now);
    let source = raw;
    if (Array.isArray(source)) {
      source = source.length ? { version: VERSION, albums: [{ id: "album-legacy-saved", name: "Saved professors", professors: source }] } : emptyLibrary();
    }
    if (!source || typeof source !== "object") return emptyLibrary();
    if (source.version !== undefined && Number(source.version) !== VERSION) return emptyLibrary();

    const candidates = Array.isArray(source.albums) ? source.albums : [];
    const albums = [];
    const usedIds = new Set();
    const usedNames = new Set();
    let totalProfessors = 0;
    for (let index = 0; index < candidates.length && albums.length < LIMITS.albums; index += 1) {
      const album = normalizeAlbum(candidates[index], index, usedIds, usedNames, LIMITS.totalProfessors - totalProfessors, timestamp);
      if (!album) continue;
      albums.push(album);
      totalProfessors += album.professors.length;
      if (totalProfessors >= LIMITS.totalProfessors) break;
    }
    return { version: VERSION, albums };
  }

  function findAlbum(library, albumId) {
    if (!Array.isArray(library?.albums)) return null;
    const id = cleanAlbumId(albumId);
    return library.albums.find((album) => album?.id === id) || null;
  }

  function generatedAlbumId(timestamp, albums) {
    let id = "";
    try { id = globalThis.crypto?.randomUUID?.() || ""; }
    catch (_error) { id = ""; }
    if (id) id = `album-${id}`;
    if (!id) id = `album-${timestamp.toString(36)}-${(++generatedIdSequence).toString(36)}`;
    while (albums.some((album) => album.id === id)) id = `${id}-${(++generatedIdSequence).toString(36)}`;
    return id;
  }

  function failure(library, error, message) {
    return { ok: false, changed: false, library, error, message };
  }

  function createAlbum(input, rawName, options = {}) {
    const timestamp = nowValue(options.now);
    const library = normalizeLibrary(input, { now: timestamp });
    const fullName = normalizedAlbumName(rawName, false);
    if (!fullName) return failure(library, "invalid-name", "Enter an album name.");
    if (fullName.length > LIMITS.albumNameLength) return failure(library, "invalid-name", `Album names can be at most ${LIMITS.albumNameLength} characters.`);
    if (library.albums.some((album) => normalizeText(album.name) === normalizeText(fullName))) return failure(library, "duplicate-name", "An album with that name already exists.");
    if (library.albums.length >= LIMITS.albums) return failure(library, "album-limit", `You can create up to ${LIMITS.albums} albums.`);

    let id = cleanAlbumId(options.id);
    if (!id || library.albums.some((album) => album.id === id)) id = generatedAlbumId(timestamp, library.albums);
    const album = { id, name: fullName, createdAt: timestamp, updatedAt: timestamp, professors: [] };
    const nextLibrary = { version: VERSION, albums: [album, ...library.albums] };
    return { ok: true, changed: true, library: nextLibrary, album };
  }

  function renameAlbum(input, albumId, rawName, options = {}) {
    const timestamp = nowValue(options.now);
    const library = normalizeLibrary(input, { now: timestamp });
    const index = library.albums.findIndex((album) => album.id === cleanAlbumId(albumId));
    if (index < 0) return failure(library, "album-not-found", "That album no longer exists.");
    const fullName = normalizedAlbumName(rawName, false);
    if (!fullName || fullName.length > LIMITS.albumNameLength) return failure(library, "invalid-name", `Album names must be between 1 and ${LIMITS.albumNameLength} characters.`);
    if (library.albums.some((album, albumIndex) => albumIndex !== index && normalizeText(album.name) === normalizeText(fullName))) return failure(library, "duplicate-name", "An album with that name already exists.");
    if (library.albums[index].name === fullName) return { ok: true, changed: false, library, album: library.albums[index] };

    const album = { ...library.albums[index], name: fullName, updatedAt: timestamp };
    const albums = library.albums.map((item, albumIndex) => albumIndex === index ? album : item);
    return { ok: true, changed: true, library: { version: VERSION, albums }, album };
  }

  function deleteAlbum(input, albumId, options = {}) {
    const library = normalizeLibrary(input, { now: nowValue(options.now) });
    const index = library.albums.findIndex((album) => album.id === cleanAlbumId(albumId));
    if (index < 0) return { ok: true, changed: false, library, deletedAlbum: null };
    const deletedAlbum = library.albums[index];
    const albums = library.albums.filter((_album, albumIndex) => albumIndex !== index);
    return { ok: true, changed: true, library: { version: VERSION, albums }, deletedAlbum };
  }

  function totalProfessorCount(library) {
    return library.albums.reduce((total, album) => total + album.professors.length, 0);
  }

  function saveProfessor(input, albumId, rawProfessor, options = {}) {
    const timestamp = nowValue(options.now);
    const library = normalizeLibrary(input, { now: timestamp });
    const albumIndex = library.albums.findIndex((album) => album.id === cleanAlbumId(albumId));
    if (albumIndex < 0) return failure(library, "album-not-found", "Choose an album before saving this professor.");
    const professor = normalizeProfessor(rawProfessor, { now: timestamp });
    if (!professor) return failure(library, "invalid-professor", "This professor is missing a valid name.");

    const album = library.albums[albumIndex];
    const existingIndex = album.professors.findIndex((saved) => professorsMatch(saved, professor));
    let savedProfessor = professor;
    let action = "added";
    let changed = true;
    let professors;
    if (existingIndex >= 0) {
      const existing = album.professors[existingIndex];
      savedProfessor = mergeProfessor(existing, professor, timestamp);
      changed = professorContent(existing) !== professorContent(savedProfessor);
      action = changed ? "updated" : "exists";
      if (!changed) return { ok: true, changed: false, library, album, professor: existing, action };
      professors = album.professors.map((item, index) => index === existingIndex ? savedProfessor : item);
    } else {
      if (album.professors.length >= LIMITS.professorsPerAlbum) return failure(library, "professor-limit", `Each album can hold up to ${LIMITS.professorsPerAlbum} professors.`);
      if (totalProfessorCount(library) >= LIMITS.totalProfessors) return failure(library, "total-professor-limit", `You can store up to ${LIMITS.totalProfessors} professor placements.`);
      professors = [...album.professors, professor];
    }

    const updatedAlbum = { ...album, updatedAt: timestamp, professors };
    const albums = library.albums.map((item, index) => index === albumIndex ? updatedAlbum : item);
    return { ok: true, changed, library: { version: VERSION, albums }, album: updatedAlbum, professor: savedProfessor, action };
  }

  function removeProfessor(input, albumId, key, options = {}) {
    const timestamp = nowValue(options.now);
    const library = normalizeLibrary(input, { now: timestamp });
    const albumIndex = library.albums.findIndex((album) => album.id === cleanAlbumId(albumId));
    if (albumIndex < 0) return failure(library, "album-not-found", "That album no longer exists.");
    const album = library.albums[albumIndex];
    const professorIndex = album.professors.findIndex((professor) => professor.key === cleanProfessorKey(key));
    if (professorIndex < 0) return { ok: true, changed: false, library, album, removedProfessor: null };
    const removedProfessor = album.professors[professorIndex];
    const updatedAlbum = { ...album, updatedAt: timestamp, professors: album.professors.filter((_professor, index) => index !== professorIndex) };
    const albums = library.albums.map((item, index) => index === albumIndex ? updatedAlbum : item);
    return { ok: true, changed: true, library: { version: VERSION, albums }, album: updatedAlbum, removedProfessor };
  }

  function moveProfessor(input, fromAlbumId, toAlbumId, key, options = {}) {
    const timestamp = nowValue(options.now);
    const library = normalizeLibrary(input, { now: timestamp });
    const fromIndex = library.albums.findIndex((album) => album.id === cleanAlbumId(fromAlbumId));
    const toIndex = library.albums.findIndex((album) => album.id === cleanAlbumId(toAlbumId));
    if (fromIndex < 0 || toIndex < 0) return failure(library, "album-not-found", "The source or destination album no longer exists.");
    const sourceAlbum = library.albums[fromIndex];
    const professorIndex = sourceAlbum.professors.findIndex((professor) => professor.key === cleanProfessorKey(key));
    if (professorIndex < 0) return failure(library, "professor-not-found", "That professor is no longer in the source album.");
    const professor = sourceAlbum.professors[professorIndex];
    if (fromIndex === toIndex) return { ok: true, changed: false, library, album: sourceAlbum, professor, action: "same-album" };

    const destinationAlbum = library.albums[toIndex];
    const existingIndex = destinationAlbum.professors.findIndex((saved) => professorsMatch(saved, professor));
    if (existingIndex < 0 && destinationAlbum.professors.length >= LIMITS.professorsPerAlbum) return failure(library, "professor-limit", `Each album can hold up to ${LIMITS.professorsPerAlbum} professors.`);

    const nextSource = { ...sourceAlbum, updatedAt: timestamp, professors: sourceAlbum.professors.filter((_item, index) => index !== professorIndex) };
    let movedProfessor = professor;
    let destinationProfessors;
    let action = "moved";
    if (existingIndex >= 0) {
      action = "merged";
      movedProfessor = mergeProfessor(destinationAlbum.professors[existingIndex], professor, timestamp);
      destinationProfessors = destinationAlbum.professors.map((item, index) => index === existingIndex ? movedProfessor : item);
    } else {
      destinationProfessors = [...destinationAlbum.professors, professor];
    }
    const nextDestination = { ...destinationAlbum, updatedAt: timestamp, professors: destinationProfessors };
    const albums = library.albums.map((album, index) => index === fromIndex ? nextSource : index === toIndex ? nextDestination : album);
    return { ok: true, changed: true, library: { version: VERSION, albums }, album: nextDestination, professor: movedProfessor, action };
  }

  globalThis.__PROFESSOR_INSIGHTS_ALBUMS__ = Object.freeze({
    VERSION,
    STORAGE_KEY,
    LIMITS,
    emptyLibrary,
    normalizeLibrary,
    professorKey,
    normalizeProfessor,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    saveProfessor,
    removeProfessor,
    moveProfessor,
    findAlbum
  });
})();
