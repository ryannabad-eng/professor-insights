import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, "..", "quick-rate.js"), "utf8");
const context = vm.createContext({ URL });
new vm.Script(source).runInContext(context);
const quickRate = context.__PROFESSOR_INSIGHTS_QUICK_RATE__;

function searchHtml(store) {
  return `<html><script>window.__RELAY_STORE__ = ${JSON.stringify(store)};\nwindow.process = {};</script></html>`;
}

function calPolyStore(...teachers) {
  return {
    "U2Nob29sLTE1Mw==": { __typename: "School", legacyId: 153, name: "California Polytechnic State University" },
    ...Object.fromEntries(teachers.map((teacher) => [
      `teacher-${teacher.legacyId}`,
      { __typename: "Teacher", school: { __ref: "U2Nob29sLTE1Mw==" }, ...teacher }
    ]))
  };
}

test("builds school-scoped search and numeric-only direct RMP URLs", () => {
  assert.equal(
    quickRate.buildRmpSearchUrl({ firstName: "Chris", lastName: "Carr" }),
    "https://www.ratemyprofessors.com/search/professors/153?q=Chris%20Carr"
  );
  assert.equal(quickRate.buildRmpProfileUrl(1353733), "https://www.ratemyprofessors.com/professor/1353733");
  assert.equal(quickRate.buildRmpRatingUrl("1353733"), "https://www.ratemyprofessors.com/add/professor-rating/1353733");
  assert.equal(quickRate.buildRmpRatingUrl("1353733/anything"), "");
  assert.equal(quickRate.buildRmpRatingUrl("javascript:alert(1)"), "");
  assert.equal(
    quickRate.buildRmpSearchUrl({ name: "John Ousterhout" }, { id: 953 }),
    "https://www.ratemyprofessors.com/search/professors/953?q=John%20Ousterhout"
  );
  assert.equal(quickRate.buildRmpSearchUrl({ name: "John Ousterhout" }, {}), "");
});

test("builds readable professor initials", () => {
  assert.equal(quickRate.professorInitials("Maya Chen"), "MC");
  assert.equal(quickRate.professorInitials("Dr. Maya L. Chen"), "MC");
  assert.equal(quickRate.professorInitials("Chen, Maya"), "MC");
  assert.equal(quickRate.professorInitials("Plato"), "P");
  assert.equal(quickRate.professorInitials(""), "?");
});

test("extracts the embedded Relay store without evaluating page scripts", () => {
  const store = calPolyStore({ legacyId: 1353733, firstName: "Chris", lastName: "Carr", department: "Business {Administration}" });
  const extracted = quickRate.extractRelayStore(searchHtml(store));
  assert.equal(extracted["teacher-1353733"].legacyId, 1353733);
  assert.equal(extracted["teacher-1353733"].department, "Business {Administration}");
  assert.throws(() => quickRate.extractRelayStore("<html>No store</html>"), /not found/);
});

test("resolves one exact same-school professor to the direct rating page", () => {
  const store = calPolyStore(
    { legacyId: 1353733, firstName: "Chris", lastName: "Carr", department: "Business Administration" },
    { legacyId: 2231285, firstName: "Christopher", lastName: "Skiles", department: "Communication Studies" }
  );
  const result = quickRate.resolveRmpSearchHtml(searchHtml(store), { firstName: "Chris", lastName: "Carr", name: "Chris Carr" });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    match: "exact",
    legacyId: "1353733",
    name: "Chris Carr",
    department: "Business Administration",
    avgRating: null,
    avgDifficulty: null,
    numRatings: null,
    wouldTakeAgainPercent: null,
    school: {
      id: "153",
      nodeId: "U2Nob29sLTE1Mw==",
      name: "California Polytechnic State University",
      city: "San Luis Obispo",
      state: "CA"
    },
    profileUrl: "https://www.ratemyprofessors.com/professor/1353733",
    ratingUrl: "https://www.ratemyprofessors.com/add/professor-rating/1353733",
    searchUrl: "https://www.ratemyprofessors.com/search/professors/153?q=Chris%20Carr"
  });
});

test("extracts selectable RMP schools with campus locations", () => {
  const store = {
    school1: { __typename: "School", id: "U2Nob29sLTk1Mw==", legacyId: 953, name: "Stanford University", city: "Stanford", state: "CA" },
    school2: { __typename: "School", id: "U2Nob29sLTY5Ng==", legacyId: 696, name: "Northeastern University", city: "Boston", state: "MA" },
    incomplete: { __typename: "School", name: "Missing ID" }
  };
  assert.deepEqual(JSON.parse(JSON.stringify(quickRate.findRmpSchoolsInHtml(searchHtml(store)))), [
    { id: "953", nodeId: "U2Nob29sLTk1Mw==", name: "Stanford University", city: "Stanford", state: "CA" },
    { id: "696", nodeId: "U2Nob29sLTY5Ng==", name: "Northeastern University", city: "Boston", state: "MA" }
  ]);
});

test("resolves an exact professor at a selected non-Cal Poly school", () => {
  const school = { id: "953", nodeId: "U2Nob29sLTk1Mw==", name: "Stanford University", city: "Stanford", state: "CA" };
  const store = {
    [school.nodeId]: { __typename: "School", id: school.nodeId, legacyId: 953, name: school.name },
    teacher: { __typename: "Teacher", legacyId: 1871927, firstName: "John", lastName: "Ousterhout", department: "Computer Science", school: { __ref: school.nodeId } }
  };
  const result = quickRate.resolveRmpSearchHtml(searchHtml(store), { name: "John Ousterhout" }, school);
  assert.equal(result.match, "exact");
  assert.equal(result.ratingUrl, "https://www.ratemyprofessors.com/add/professor-rating/1871927");
  assert.equal(result.school.id, "953");
});

test("resolves Ilan Adler at Berkeley with the RMP metrics needed by the main results view", () => {
  const school = {
    id: "1072",
    nodeId: "U2Nob29sLTEwNzI=",
    name: "University of California Berkeley",
    city: "Berkeley",
    state: "CA"
  };
  const store = {
    [school.nodeId]: {
      __typename: "School",
      id: school.nodeId,
      legacyId: 1072,
      name: school.name,
      city: school.city,
      state: school.state
    },
    "VGVhY2hlci02MzE5OTc=": {
      __typename: "Teacher",
      id: "VGVhY2hlci02MzE5OTc=",
      legacyId: 631997,
      firstName: "Ilan",
      lastName: "Adler",
      department: "Industrial Engineering",
      avgRating: 2.6,
      numRatings: 13,
      wouldTakeAgainPercent: 16.6667,
      avgDifficulty: 3.3,
      school: { __ref: school.nodeId }
    }
  };

  const result = quickRate.resolveRmpSearchHtml(searchHtml(store), { name: "Ilan Adler" }, school);

  assert.equal(result.match, "exact");
  assert.equal(result.legacyId, "631997");
  assert.equal(result.department, "Industrial Engineering");
  assert.equal(result.avgRating, 2.6);
  assert.equal(result.numRatings, 13);
  assert.equal(result.wouldTakeAgainPercent, 16.6667);
  assert.equal(result.avgDifficulty, 3.3);
  assert.equal(result.profileUrl, "https://www.ratemyprofessors.com/professor/631997");
  assert.equal(result.ratingUrl, "https://www.ratemyprofessors.com/add/professor-rating/631997");
  assert.equal(result.searchUrl, "https://www.ratemyprofessors.com/search/professors/1072?q=Ilan%20Adler");
});

test("accepts a middle initial but not a different given name", () => {
  const store = calPolyStore({ legacyId: 42, firstName: "Jane", lastName: "Doe", department: "History" });
  assert.equal(quickRate.findExactProfessorMatch(store, { firstName: "Jane A.", lastName: "Doe" }).match, "exact");
  assert.equal(quickRate.findExactProfessorMatch(store, { firstName: "Janet", lastName: "Doe" }).match, "not-found");
});

test("rejects a same-name result from another school", () => {
  const store = {
    "other-school": { __typename: "School", name: "Cuesta College" },
    teacher: { __typename: "Teacher", legacyId: 698955, firstName: "Bryce", lastName: "Jenkin", school: { __ref: "other-school" } }
  };
  const result = quickRate.findExactProfessorMatch(store, { firstName: "Bryce", lastName: "Jenkin" });
  assert.equal(result.match, "not-found");
  assert.equal(result.reason, "no-match");
});

test("refuses to guess when two same-school profiles share the exact name", () => {
  const store = calPolyStore(
    { legacyId: 1, firstName: "Alex", lastName: "Lee", department: "Art" },
    { legacyId: 2, firstName: "Alex", lastName: "Lee", department: "Biology" }
  );
  const result = quickRate.findExactProfessorMatch(store, { firstName: "Alex", lastName: "Lee" });
  assert.equal(result.match, "ambiguous");
  assert.equal(result.reason, "multiple-matches");
  assert.equal(result.ratingUrl, undefined);
});
