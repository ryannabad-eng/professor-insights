import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, "..", "albums.js"), "utf8");
const context = vm.createContext({ URL });
new vm.Script(source).runInContext(context);
const albums = context.__PROFESSOR_INSIGHTS_ALBUMS__;

const NOW = 1_800_000_000_000;
const SCHOOL = { id: "1072", name: "University of California Berkeley", city: "Berkeley", state: "CA" };

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function libraryWith(...albumEntries) {
  return albums.normalizeLibrary({ version: 1, albums: albumEntries }, { now: NOW });
}

function album(id, name, professors = []) {
  return { id, name, createdAt: NOW - 100, updatedAt: NOW - 100, professors };
}

function professor(name, extra = {}) {
  return { name, department: "Computer Science", course: "CS 101", school: SCHOOL, ...extra };
}

test("exports the bounded versioned album API and creates an empty library", () => {
  assert.equal(albums.VERSION, 1);
  assert.equal(albums.STORAGE_KEY, "professorInsights.albums.v1");
  assert.equal(albums.LIMITS.albums, 30);
  assert.equal(albums.LIMITS.professorsPerAlbum, 100);
  assert.deepEqual(plain(albums.emptyLibrary()), { version: 1, albums: [] });
  assert.deepEqual(plain(albums.normalizeLibrary(null, { now: NOW })), { version: 1, albums: [] });
  assert.deepEqual(plain(albums.normalizeLibrary({ version: 99, albums: [] }, { now: NOW })), { version: 1, albums: [] });
});

test("creates a trimmed album immutably with deterministic injected values", () => {
  const original = albums.emptyLibrary();
  const result = albums.createAlbum(original, "  Fall   2026  ", { id: "fall-2026", now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(plain(result.album), {
    id: "fall-2026",
    name: "Fall 2026",
    createdAt: NOW,
    updatedAt: NOW,
    professors: []
  });
  assert.deepEqual(plain(original), { version: 1, albums: [] });
  assert.notEqual(result.library, original);
});

test("rejects empty, overly long, duplicate, and over-limit album creation", () => {
  const initial = libraryWith(album("fall", "Fáll 2026"));
  assert.equal(albums.createAlbum(initial, "   ", { now: NOW }).error, "invalid-name");
  assert.equal(albums.createAlbum(initial, "x".repeat(albums.LIMITS.albumNameLength + 1), { now: NOW }).error, "invalid-name");
  assert.equal(albums.createAlbum(initial, "fall 2026", { now: NOW }).error, "duplicate-name");

  const full = libraryWith(...Array.from({ length: albums.LIMITS.albums }, (_item, index) => album(`a-${index}`, `Album ${index}`)));
  const atLimit = albums.createAlbum(full, "One more", { now: NOW });
  assert.equal(atLimit.ok, false);
  assert.equal(atLimit.error, "album-limit");
  assert.equal(atLimit.library.albums.length, albums.LIMITS.albums);
});

test("renames albums, treats an unchanged name as a no-op, and protects unique names", () => {
  const original = libraryWith(album("fall", "Fall 2026"), album("spring", "Spring 2027"));
  const renamed = albums.renameAlbum(original, "fall", " Winter   2027 ", { now: NOW + 50 });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.changed, true);
  assert.equal(renamed.album.name, "Winter 2027");
  assert.equal(renamed.album.updatedAt, NOW + 50);
  assert.equal(original.albums[0].name, "Fall 2026");

  const unchanged = albums.renameAlbum(renamed.library, "fall", "Winter 2027", { now: NOW + 60 });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.album.updatedAt, NOW + 50);
  assert.equal(albums.renameAlbum(original, "fall", "spring 2027", { now: NOW }).error, "duplicate-name");
  assert.equal(albums.renameAlbum(original, "missing", "Summer", { now: NOW }).error, "album-not-found");
});

test("deletes albums without requiring at least one album and is idempotent", () => {
  const original = libraryWith(album("only", "Only album"));
  const deleted = albums.deleteAlbum(original, "only", { now: NOW });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.changed, true);
  assert.equal(deleted.deletedAlbum.id, "only");
  assert.deepEqual(plain(deleted.library.albums), []);
  assert.equal(original.albums.length, 1);

  const again = albums.deleteAlbum(deleted.library, "only", { now: NOW });
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  assert.equal(again.deletedAlbum, null);
});

test("normalizes a bounded professor snapshot and removes unsafe or invalid values", () => {
  const saved = albums.normalizeProfessor({
    name: "  Ilan   Adler ",
    department: "Industrial Engineering",
    course: "IND ENG 160",
    school: SCHOOL,
    polyratings: { id: "poly-123", rating: 9, reviews: 12.8, profileUrl: "javascript:alert(1)" },
    rmp: {
      legacyId: 631997,
      avgRating: 2.6,
      numRatings: 13.9,
      avgDifficulty: 3.3,
      wouldTakeAgainPercent: 116,
      profileUrl: "https://www.ratemyprofessors.com/professor/631997",
      ratingUrl: "http://www.ratemyprofessors.com/add/professor-rating/631997",
      searchUrl: "https://www.ratemyprofessors.com/search/professors/1072?q=Ilan%20Adler"
    }
  }, { now: NOW });

  assert.equal(saved.key, "rmp:1072:631997");
  assert.equal(saved.name, "Ilan Adler");
  assert.equal(saved.polyratings.rating, null);
  assert.equal(saved.polyratings.reviews, 12);
  assert.equal(saved.polyratings.profileUrl, "");
  assert.equal(saved.rmp.avgRating, 2.6);
  assert.equal(saved.rmp.numRatings, 13);
  assert.equal(saved.rmp.wouldTakeAgainPercent, null);
  assert.equal(saved.rmp.profileUrl, "https://www.ratemyprofessors.com/professor/631997");
  assert.equal(saved.rmp.ratingUrl, "");
  assert.equal(saved.savedAt, NOW);
  assert.equal(saved.updatedAt, NOW);
  assert.equal(albums.normalizeProfessor({ name: " " }, { now: NOW }), null);
});

test("chooses RMP, PolyRatings, then school-and-name professor identities", () => {
  assert.equal(albums.professorKey(professor("Jane Doe", { rmp: { legacyId: 42 } })), "rmp:1072:42");
  assert.equal(albums.professorKey(professor("Jane Doe", { polyratings: { id: "ABC-123" } })), "poly:abc-123");
  assert.equal(albums.professorKey(professor("Jánë Dœ")), "name:1072:jane-d");
  assert.equal(albums.professorKey({ name: "Jane Doe" }), "name:unknown:jane-doe");
});

test("saves a professor immutably and reports missing albums or invalid professors", () => {
  const original = libraryWith(album("fall", "Fall 2026"));
  const result = albums.saveProfessor(original, "fall", professor("Jane Doe", { rmp: { legacyId: 42, avgRating: 4.8 } }), { now: NOW + 10 });
  assert.equal(result.ok, true);
  assert.equal(result.action, "added");
  assert.equal(result.professor.key, "rmp:1072:42");
  assert.equal(result.album.updatedAt, NOW + 10);
  assert.equal(result.library.albums[0].professors.length, 1);
  assert.equal(original.albums[0].professors.length, 0);
  assert.equal(albums.saveProfessor(original, "missing", professor("Jane Doe"), { now: NOW }).error, "album-not-found");
  assert.equal(albums.saveProfessor(original, "fall", { name: "" }, { now: NOW }).error, "invalid-professor");
});

test("deduplicates source variants and merges richer RMP data into a PolyRatings save", () => {
  let library = libraryWith(album("fall", "Fall 2026"));
  const first = albums.saveProfessor(library, "fall", professor("Jane Doe", {
    polyratings: { id: "poly-jane", rating: 3.7, reviews: 20, profileUrl: "https://polyratings.dev/professor/poly-jane" }
  }), { now: NOW + 1 });
  library = first.library;
  const second = albums.saveProfessor(library, "fall", professor("  JANE  DOE ", {
    rmp: { legacyId: 42, avgRating: 4.6, numRatings: 32, profileUrl: "https://www.ratemyprofessors.com/professor/42" }
  }), { now: NOW + 2 });

  assert.equal(second.ok, true);
  assert.equal(second.action, "updated");
  assert.equal(second.library.albums[0].professors.length, 1);
  assert.equal(second.professor.key, "poly:poly-jane");
  assert.equal(second.professor.polyratings.id, "poly-jane");
  assert.equal(second.professor.rmp.legacyId, "42");
  assert.equal(second.professor.updatedAt, NOW + 2);
});

test("keeps same-name professors separate when a source gives them conflicting IDs", () => {
  let library = libraryWith(album("fall", "Fall 2026"));
  library = albums.saveProfessor(library, "fall", professor("Alex Lee", {
    rmp: { legacyId: 41, avgRating: 4.1 }
  }), { now: NOW + 1 }).library;
  const second = albums.saveProfessor(library, "fall", professor("Alex Lee", {
    rmp: { legacyId: 99, avgRating: 3.9 }
  }), { now: NOW + 2 });

  assert.equal(second.ok, true);
  assert.equal(second.action, "added");
  assert.equal(second.library.albums[0].professors.length, 2);
  assert.deepEqual(plain(second.library.albums[0].professors.map((item) => item.rmp.legacyId)), ["41", "99"]);
});

test("saving an identical professor is an idempotent exists result", () => {
  const starting = libraryWith(album("fall", "Fall 2026"));
  const added = albums.saveProfessor(starting, "fall", professor("Jane Doe", { rmp: { legacyId: 42, avgRating: 4.5 } }), { now: NOW + 1 });
  const duplicate = albums.saveProfessor(added.library, "fall", professor("Jane Doe", { rmp: { legacyId: 42, avgRating: 4.5 } }), { now: NOW + 99 });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.action, "exists");
  assert.equal(duplicate.professor.updatedAt, NOW + 1);
  assert.equal(duplicate.library.albums[0].professors.length, 1);
});

test("removes professors immutably and treats a repeated removal as success", () => {
  const saved = albums.normalizeProfessor(professor("Jane Doe", { rmp: { legacyId: 42 } }), { now: NOW });
  const original = libraryWith(album("fall", "Fall 2026", [saved]));
  const removed = albums.removeProfessor(original, "fall", saved.key, { now: NOW + 10 });
  assert.equal(removed.ok, true);
  assert.equal(removed.changed, true);
  assert.equal(removed.removedProfessor.name, "Jane Doe");
  assert.equal(removed.album.professors.length, 0);
  assert.equal(original.albums[0].professors.length, 1);
  const repeated = albums.removeProfessor(removed.library, "fall", saved.key, { now: NOW + 20 });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.removedProfessor, null);
});

test("moves a professor between albums and handles same-album and missing cases", () => {
  const saved = albums.normalizeProfessor(professor("Jane Doe", { rmp: { legacyId: 42 } }), { now: NOW });
  const original = libraryWith(album("fall", "Fall 2026", [saved]), album("spring", "Spring 2027"));
  const same = albums.moveProfessor(original, "fall", "fall", saved.key, { now: NOW + 1 });
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);
  assert.equal(same.action, "same-album");

  const moved = albums.moveProfessor(original, "fall", "spring", saved.key, { now: NOW + 2 });
  assert.equal(moved.ok, true);
  assert.equal(moved.action, "moved");
  assert.equal(albums.findAlbum(moved.library, "fall").professors.length, 0);
  assert.equal(albums.findAlbum(moved.library, "spring").professors[0].key, saved.key);
  assert.equal(original.albums[0].professors.length, 1);
  assert.equal(albums.moveProfessor(original, "missing", "spring", saved.key, { now: NOW }).error, "album-not-found");
  assert.equal(albums.moveProfessor(original, "spring", "fall", saved.key, { now: NOW }).error, "professor-not-found");
});

test("moving onto an equivalent save merges sources instead of duplicating", () => {
  const poly = albums.normalizeProfessor(professor("Jane Doe", { polyratings: { id: "poly-jane", rating: 3.8 } }), { now: NOW });
  const rmp = albums.normalizeProfessor(professor("Jane Doe", { rmp: { legacyId: 42, avgRating: 4.6 } }), { now: NOW + 1 });
  const original = libraryWith(album("source", "Source", [rmp]), album("target", "Target", [poly]));
  const moved = albums.moveProfessor(original, "source", "target", rmp.key, { now: NOW + 20 });
  assert.equal(moved.ok, true);
  assert.equal(moved.action, "merged");
  assert.equal(albums.findAlbum(moved.library, "source").professors.length, 0);
  assert.equal(albums.findAlbum(moved.library, "target").professors.length, 1);
  assert.equal(moved.professor.polyratings.id, "poly-jane");
  assert.equal(moved.professor.rmp.legacyId, "42");
});

test("enforces per-album and total professor placement limits without blocking updates", () => {
  const hundred = Array.from({ length: albums.LIMITS.professorsPerAlbum }, (_item, index) => professor(`Professor ${index}`, { rmp: { legacyId: index + 1 } }));
  const fullAlbumLibrary = libraryWith(album("full", "Full", hundred));
  const fullResult = albums.saveProfessor(fullAlbumLibrary, "full", professor("One More", { rmp: { legacyId: 9999 } }), { now: NOW + 1 });
  assert.equal(fullResult.error, "professor-limit");
  const updateAtLimit = albums.saveProfessor(fullAlbumLibrary, "full", professor("Professor 0", { rmp: { legacyId: 1, avgRating: 4.9 } }), { now: NOW + 1 });
  assert.equal(updateAtLimit.ok, true);
  assert.equal(updateAtLimit.action, "updated");

  const target = album("target", "Target");
  const tenFullAlbums = Array.from({ length: 10 }, (_item, albumIndex) => album(
    `full-${albumIndex}`,
    `Full ${albumIndex}`,
    Array.from({ length: 100 }, (_professor, professorIndex) => professor(`P ${albumIndex} ${professorIndex}`, { rmp: { legacyId: albumIndex * 1000 + professorIndex + 1 } }))
  ));
  const totalFull = libraryWith(target, ...tenFullAlbums);
  assert.equal(totalFull.albums.length, 11);
  assert.equal(totalFull.albums.reduce((sum, item) => sum + item.professors.length, 0), albums.LIMITS.totalProfessors);
  assert.equal(albums.saveProfessor(totalFull, "target", professor("Over Total", { rmp: { legacyId: 50000 } }), { now: NOW + 1 }).error, "total-professor-limit");
});

test("normalizes legacy and malformed storage while dropping duplicates and unknown fields", () => {
  const raw = {
    albums: [
      {
        name: "  Fall 2026 ",
        ignored: "not persisted",
        professors: [
          professor("Jane Doe", { rmp: { legacyId: 42, profileUrl: "javascript:bad" }, ignored: true }),
          professor("JANE DOE", { polyratings: { id: "poly-jane", rating: 3.5 } }),
          { name: "" }
        ]
      },
      { id: "duplicate-name", name: "fáll 2026", professors: [] },
      { id: "safe", name: "Spring 2027", professors: [] },
      { id: "safe", name: "Summer 2027", professors: [] },
      null
    ]
  };
  const normalized = albums.normalizeLibrary(raw, { now: NOW });
  assert.equal(normalized.version, 1);
  assert.equal(normalized.albums.length, 2);
  assert.equal(normalized.albums[0].id, "album-1");
  assert.equal(normalized.albums[0].name, "Fall 2026");
  assert.equal(normalized.albums[0].professors.length, 1);
  assert.equal(normalized.albums[0].professors[0].rmp.profileUrl, "");
  assert.equal(normalized.albums[0].professors[0].ignored, undefined);
  assert.equal(normalized.albums[0].ignored, undefined);
  assert.equal(normalized.albums[1].id, "safe");

  const migrated = albums.normalizeLibrary([professor("Legacy Professor")], { now: NOW });
  assert.equal(migrated.albums.length, 1);
  assert.equal(migrated.albums[0].name, "Saved professors");
  assert.equal(migrated.albums[0].professors[0].name, "Legacy Professor");
});

test("truncates oversized stored collections deterministically", () => {
  const tooManyAlbums = {
    version: 1,
    albums: Array.from({ length: albums.LIMITS.albums + 5 }, (_item, index) => album(`album-${index}`, `Album ${index}`))
  };
  assert.equal(albums.normalizeLibrary(tooManyAlbums, { now: NOW }).albums.length, albums.LIMITS.albums);

  const tooManyProfessors = {
    version: 1,
    albums: [album("full", "Full", Array.from({ length: albums.LIMITS.professorsPerAlbum + 5 }, (_item, index) => professor(`Professor ${index}`)))]
  };
  assert.equal(albums.normalizeLibrary(tooManyProfessors, { now: NOW }).albums[0].professors.length, albums.LIMITS.professorsPerAlbum);
});

test("survives a JSON storage round trip without changing canonical data", () => {
  let library = albums.createAlbum(albums.emptyLibrary(), "Fall 2026", { id: "fall", now: NOW }).library;
  library = albums.saveProfessor(library, "fall", professor("Jane Doe", {
    polyratings: { id: "poly-jane", rating: 3.9, reviews: 20, profileUrl: "https://polyratings.dev/professor/poly-jane" },
    rmp: { legacyId: 42, avgRating: 4.7, profileUrl: "https://www.ratemyprofessors.com/professor/42" }
  }), { now: NOW + 1 }).library;
  const restored = albums.normalizeLibrary(JSON.parse(JSON.stringify(library)), { now: NOW + 100 });
  assert.deepEqual(plain(restored), plain(library));
});
