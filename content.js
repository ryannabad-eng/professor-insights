(() => {
  const APP_KEY = "__professorInsightsAppV2";
  const HOST_ID = "professor-insights-panel";
  const PAGE_RATING_ATTRIBUTE = "data-professor-insights-rating";
  const PAGE_ID_ATTRIBUTE = "data-professor-insights-id";
  const SCHOOL_STORAGE_KEY = "professorInsights.rmpSchoolByOrigin.v1";
  const quickRate = globalThis.__PROFESSOR_INSIGHTS_QUICK_RATE__;
  const albumStore = globalThis.__PROFESSOR_INSIGHTS_ALBUMS__;
  const BERKELEY_SCHOOL = Object.freeze({
    id: "1072",
    nodeId: "U2Nob29sLTEwNzI=",
    name: "University of California Berkeley",
    city: "Berkeley",
    state: "CA"
  });

  if (window[APP_KEY]?.destroy) {
    window[APP_KEY].destroy();
    return;
  }

  const existingHost = document.getElementById(HOST_ID);
  if (existingHost) {
    existingHost.dispatchEvent(new CustomEvent("professor-insights-destroy"));
    if (document.contains(existingHost)) existingHost.remove();
    document.querySelectorAll(`[${PAGE_RATING_ATTRIBUTE}]`).forEach((element) => {
      element.removeAttribute(PAGE_RATING_ATTRIBUTE);
      element.removeAttribute(PAGE_ID_ATTRIBUTE);
    });
    document.getElementById("professor-insights-page-style")?.remove();
    return;
  }

  const state = {
    professors: [],
    pageCandidates: [],
    manualCandidates: [],
    rmpSchool: null,
    rmpLookup: { status: "idle", result: null, error: "" },
    lastSearchQuery: "",
    library: { version: 1, albums: [] },
    libraryStatus: "loading",
    libraryError: "",
    expandedAlbumIds: new Set(),
    editingAlbumId: "",
    deletingAlbumId: "",
    pendingSaveProfessor: null,
    pendingAlbumSelections: new Set(),
    dialogAlbumIds: new Set(),
    dialogReturnFocus: null,
    frameContext: { candidates: [], courseCodes: [], frameCount: 0 },
    lastFingerprint: "",
    scanTimer: null,
    scanNumber: 0,
    observer: null,
    observedFrames: new Set(),
    portalAccessMissing: false,
    destroyed: false
  };
  let rmpSchoolReady = null;
  let albumsReady = null;

  const icon = (name) => {
    const paths = {
      cap: '<path d="m3 10 9-5 9 5-9 5-9-5Z"/><path d="M7 12.2v4.1c2.8 2.2 7.2 2.2 10 0v-4.1"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
      close: '<path d="m7 7 10 10M17 7 7 17"/>',
      scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3m0 8v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="11" r="2.5"/><path d="M8.5 17a4 4 0 0 1 7 0"/>',
      rate: '<path d="m12 3 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.3-4.5 2.3.9-5-3.6-3.5 5-.7L12 3Z"/><path d="M18.5 17.5 21 20m-3.5 0 3.5-3.5"/>',
      saved: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3-6 3V4.5Z"/>',
      people: '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M19 8v6m3-3h-6"/>',
      refresh: '<path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 .1 4"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  };

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: globalThis.chrome?.runtime?.id ? "closed" : "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button, input, select, textarea { font: inherit; }
      svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .panel {
        --ink: #24323d; --muted: #71808a; --teal: #45827c;
        position: fixed; z-index: 2147483647; top: 16px; right: 16px;
        width: min(430px, calc(100vw - 24px)); height: min(780px, calc(100vh - 32px));
        overflow: hidden; display: grid; grid-template-rows: auto 1fr auto;
        color: var(--ink); background: #fff; border: 1px solid #d9e3e0; border-radius: 20px;
        box-shadow: 0 24px 70px rgba(16, 29, 34, .28);
        font: 14px/1.35 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        animation: slide-in .22s ease-out;
      }
      @keyframes slide-in { from { opacity: 0; transform: translateX(18px); } }
      @keyframes pulse { 50% { opacity: .45; } }
      @keyframes flash { 50% { box-shadow: 0 0 0 4px rgba(69, 130, 124, .24); } }
      @keyframes skeleton { to { background-position: -250% 0; } }
      .topbar { min-height: 80px; display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid #e2e9e7; }
      .brand-icon { width: 40px; height: 40px; flex: 0 0 40px; display: grid; place-items: center; color: #fff; background: var(--teal); border-radius: 10px; }
      .brand-icon svg { width: 24px; height: 24px; }
      .brand { min-width: 0; margin-right: auto; }
      .brand h1 { margin: 0; font-size: 19px; line-height: 1.2; font-weight: 750; letter-spacing: -.2px; }
      .brand p { margin: 2px 0 0; overflow: hidden; color: var(--muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
      .icon-button { width: 34px; height: 34px; padding: 0; display: grid; place-items: center; color: #667781; background: transparent; border: 0; border-radius: 9px; cursor: pointer; }
      .icon-button:hover, .icon-button:focus-visible { background: #edf4f2; color: var(--teal); outline: none; }
      .icon-button svg { width: 19px; height: 19px; }
      main { min-height: 0; overflow-y: auto; padding: 16px; background: #f7faf9; }
      .view[hidden] { display: none; }
      .status { min-height: 58px; display: flex; align-items: center; gap: 10px; padding: 11px 12px 11px 14px; color: #fff; background: #25363e; border-radius: 12px; }
      .status-dot { width: 9px; height: 9px; flex: 0 0 9px; background: #73cbb0; border-radius: 50%; }
      .status.loading .status-dot { animation: pulse 1s ease-in-out infinite; }
      .status.error .status-dot { background: #f0a58d; }
      .status-copy { min-width: 0; flex: 1; }
      .status strong, .status span { display: block; }
      .status strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
      .status span { overflow: hidden; color: #c9d3d6; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .status .refresh { color: #dce6e7; }
      .status .refresh:hover, .status .refresh:focus-visible { color: #fff; background: rgba(255,255,255,.12); }
      .search-form { display: flex; gap: 7px; margin-top: 11px; }
      .search-wrap { min-width: 0; flex: 1; position: relative; }
      .search-wrap svg { position: absolute; top: 50%; left: 11px; width: 17px; height: 17px; color: #78868d; transform: translateY(-50%); pointer-events: none; }
      .search-input { width: 100%; height: 40px; padding: 0 12px 0 35px; color: var(--ink); background: #fff; border: 1px solid #d6e1de; border-radius: 10px; outline: none; }
      .search-input:focus { border-color: #6c9e98; box-shadow: 0 0 0 3px rgba(69,130,124,.12); }
      .search-button { height: 40px; padding: 0 14px; color: #fff; background: var(--teal); border: 0; border-radius: 10px; font-weight: 700; cursor: pointer; }
      .search-button:hover, .search-button:focus-visible { background: #376f6a; outline: none; }
      .results-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 14px 0 10px; }
      .results-heading h2 { margin: 0; font-size: 16px; line-height: 1.2; }
      .results-heading span { color: var(--muted); font-size: 11px; text-align: right; }
      .professor-card { display: flex; gap: 12px; min-height: 142px; margin-top: 10px; padding: 14px; background: #fff; border: 1px solid #dde7e4; border-radius: 14px; box-shadow: 0 2px 5px rgba(34, 53, 59, .05); cursor: pointer; }
      .professor-card:hover, .professor-card:focus-visible { border-color: #9abbb6; outline: none; }
      .professor-card.flash { animation: flash .75s ease-in-out 2; }
      .professor-copy { min-width: 0; flex: 1; }
      .professor-card h3 { margin: 2px 0 0; font-size: 16px; line-height: 1.2; }
      .department { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
      .course { margin: 1px 0 0; color: #347a74; font-size: 14px; font-weight: 700; }
      .rating { width: 68px; height: 68px; flex: 0 0 68px; display: grid; align-content: center; justify-items: center; color: #fff; background: var(--teal); border-radius: 14px; }
      .rating strong { font-size: 24px; line-height: 1; }
      .rating span { margin-top: 4px; font-size: 9px; }
      .stats { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 12px; color: var(--muted); font-size: 11px; }
      .stats i { width: 3px; height: 3px; background: #a7b2b7; border-radius: 50%; }
      .review-count { white-space: nowrap; }
      .tags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
      .tags span { padding: 5px 10px; color: #405158; background: #eef3f1; border-radius: 999px; font-size: 11px; font-weight: 650; }
      .source-breakdown { display: none; width: 100%; gap: 7px; margin-top: 12px; padding-top: 11px; border-top: 1px solid #e5ecea; cursor: default; }
      .source-breakdown.open { display: grid; }
      .source-link { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 9px; color: #31464b; background: #f2f6f5; border-radius: 8px; text-decoration: none; font-size: 11px; }
      .source-link:hover, .source-link:focus-visible { color: #276963; background: #e4f1ee; outline: none; }
      .source-link strong { color: #347a74; font-size: 10px; }
      .rmp-result-card { margin-top: 10px; padding: 14px; background: #fff; border: 1px solid #dde7e4; border-radius: 14px; box-shadow: 0 2px 5px rgba(34, 53, 59, .05); }
      .rmp-result-top { display: flex; align-items: flex-start; gap: 12px; }
      .rmp-result-copy { min-width: 0; flex: 1; }
      .source-label { display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px; color: #326e69; background: #e4f1ee; border-radius: 999px; font-size: 10px; font-weight: 750; }
      .rmp-result-card h3 { margin: 8px 0 0; font-size: 16px; }
      .rmp-result-card .department { margin-top: 3px; }
      .rmp-school-name { margin: 2px 0 0; color: #347a74; font-size: 11px; font-weight: 650; }
      .rmp-rating { width: 68px; height: 68px; flex: 0 0 68px; display: grid; align-content: center; justify-items: center; color: #fff; background: #5567a4; border-radius: 14px; }
      .rmp-rating strong { font-size: 24px; line-height: 1; }
      .rmp-rating span { margin-top: 4px; font-size: 9px; }
      .rmp-actions { display: flex; gap: 8px; margin-top: 12px; }
      .rmp-action { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; color: #fff; background: #45827c; border-radius: 9px; text-decoration: none; font-size: 11px; font-weight: 750; }
      .rmp-action.secondary { color: #326e69; background: #e7f2ef; }
      .rmp-action:hover, .rmp-action:focus-visible { filter: brightness(.94); outline: 2px solid #75aaa5; outline-offset: 2px; }
      .rmp-source-state { margin-top: 10px; padding: 14px; color: var(--muted); background: #fff; border: 1px dashed #cddad7; border-radius: 13px; }
      .rmp-source-state strong, .rmp-source-state span { display: block; }
      .rmp-source-state strong { margin-top: 7px; color: var(--ink); font-size: 14px; }
      .rmp-source-state span { margin-top: 4px; font-size: 11px; }
      .rmp-source-state .rmp-action { width: max-content; margin-top: 10px; border: 0; cursor: pointer; }
      .review-preview { padding: 9px; color: #53636a; background: #fbfcfc; border: 1px solid #e3ebe9; border-radius: 8px; font-size: 11px; }
      .review-preview.loading { animation: pulse 1s ease-in-out infinite; }
      .review-preview strong, .review-preview time, .review-preview span { display: block; }
      .review-preview time { margin: 1px 0 5px; color: #859197; font-size: 10px; }
      .note { display: flex; align-items: flex-start; gap: 10px; margin-top: 12px; padding: 12px; color: var(--muted); border: 1px solid #dde7e4; border-radius: 10px; font-size: 11px; }
      .note svg { width: 18px; height: 18px; flex: 0 0 18px; color: var(--teal); }
      .results-empty { min-height: 190px; display: grid; place-content: center; justify-items: center; padding: 24px; color: var(--muted); background: #fff; border: 1px dashed #cddad7; border-radius: 13px; text-align: center; }
      .results-empty strong { color: var(--ink); font-size: 15px; }
      .results-empty span { max-width: 280px; margin-top: 6px; font-size: 12px; }
      .skeleton { height: 142px; margin-top: 10px; background: linear-gradient(90deg, #edf2f0 25%, #f7f9f8 45%, #edf2f0 65%); background-size: 250% 100%; border-radius: 14px; animation: skeleton 1.3s linear infinite; }
      .empty-state { min-height: 360px; display: grid; place-content: center; justify-items: center; padding: 30px; text-align: center; }
      .empty-icon { width: 52px; height: 52px; display: grid; place-items: center; color: var(--teal); background: #e7f2ef; border-radius: 15px; }
      .empty-state h2 { margin: 14px 0 6px; font-size: 18px; }
      .empty-state p { max-width: 260px; margin: 0; color: var(--muted); font-size: 13px; }
      .quick-rate { padding-bottom: 4px; }
      .quick-rate-intro { margin-bottom: 12px; }
      .quick-rate-intro h2 { margin: 0; font-size: 17px; }
      .quick-rate-intro p { margin: 3px 0 0; color: var(--muted); font-size: 11px; }
      .school-card { margin-bottom: 12px; padding: 12px; background: #fff; border: 1px solid #dce6e3; border-radius: 13px; }
      .school-selected { display: flex; align-items: center; gap: 10px; }
      .school-selected-copy { min-width: 0; flex: 1; }
      .school-selected-copy strong, .school-selected-copy span { display: block; }
      .school-selected-copy strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
      .school-selected-copy span { margin-top: 2px; color: var(--muted); font-size: 10px; }
      .school-change { min-height: 34px; padding: 0 10px; color: #347a74; background: #e7f2ef; border: 0; border-radius: 8px; font-size: 10px; font-weight: 750; cursor: pointer; }
      .school-search-label { display: block; margin-bottom: 7px; font-size: 11px; font-weight: 750; }
      .school-search-row { display: flex; gap: 7px; }
      .school-search-input { min-width: 0; height: 40px; flex: 1; padding: 0 10px; color: var(--ink); background: #fff; border: 1px solid #d6e1de; border-radius: 9px; outline: none; }
      .school-search-input:focus { border-color: #6c9e98; box-shadow: 0 0 0 3px rgba(69,130,124,.12); }
      .school-search-button { height: 40px; padding: 0 12px; color: #fff; background: var(--teal); border: 0; border-radius: 9px; font-size: 11px; font-weight: 750; cursor: pointer; }
      .school-search-hint { margin: 7px 0 0; color: var(--muted); font-size: 9px; }
      .school-results { display: grid; gap: 6px; margin-top: 8px; }
      .school-result { min-height: 48px; padding: 8px 10px; color: var(--ink); background: #f4f8f7; border: 1px solid #dce6e3; border-radius: 8px; text-align: left; cursor: pointer; }
      .school-result:hover, .school-result:focus-visible { border-color: #78a8a2; outline: none; }
      .school-result strong, .school-result span { display: block; }
      .school-result strong { font-size: 11px; }
      .school-result span { margin-top: 2px; color: var(--muted); font-size: 9px; }
      .school-results-message { margin: 7px 0 0; color: var(--muted); font-size: 10px; }
      .quick-rate-empty { min-height: 330px; display: grid; place-content: center; justify-items: center; padding: 26px; color: var(--muted); background: #fff; border: 1px dashed #cddad7; border-radius: 13px; text-align: center; }
      .quick-rate-empty .empty-icon { margin-bottom: 12px; }
      .quick-rate-empty strong { color: var(--ink); font-size: 15px; }
      .quick-rate-empty span { max-width: 280px; margin-top: 6px; font-size: 12px; }
      .quick-rate-list { display: grid; gap: 10px; }
      .quick-rate-item { overflow: hidden; background: #fff; border: 1px solid #dce6e3; border-radius: 13px; box-shadow: 0 2px 5px rgba(34, 53, 59, .05); }
      .quick-rate-professor { width: 100%; min-height: 76px; display: flex; align-items: center; gap: 11px; padding: 12px; color: var(--ink); background: #fff; border: 0; text-align: left; cursor: pointer; }
      .quick-rate-professor:hover, .quick-rate-professor:focus-visible { background: #f1f7f5; outline: none; }
      .quick-rate-professor:disabled { cursor: wait; opacity: .72; }
      .professor-avatar { width: 43px; height: 43px; flex: 0 0 43px; display: grid; place-items: center; color: #347a74; background: #e5f2ef; border-radius: 50%; font-size: 12px; font-weight: 750; }
      .quick-rate-copy { min-width: 0; flex: 1; }
      .quick-rate-copy strong, .quick-rate-copy span { display: block; }
      .quick-rate-copy strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .quick-rate-copy span { margin-top: 3px; overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      .quick-rate-action { flex: 0 0 auto; color: #347a74; font-size: 11px; font-weight: 750; }
      .quick-rate-status { display: none; margin: 0; padding: 0 12px 11px 66px; color: #7a5a22; font-size: 10px; }
      .quick-rate-status.show { display: block; }
      .quick-rate-status a { color: #347a74; font-weight: 750; }
      .quick-rate-note { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; padding: 11px; color: #607078; background: #eef4f2; border-radius: 9px; font-size: 10px; }
      .quick-rate-note svg { width: 16px; height: 16px; flex: 0 0 16px; color: var(--teal); }
      .save-professor { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; color: #326e69; background: #e7f2ef; border: 1px solid #cfe2de; border-radius: 9px; font-size: 10px; font-weight: 750; cursor: pointer; }
      .save-professor svg { width: 15px; height: 15px; }
      .save-professor[aria-pressed="true"] { color: #fff; background: var(--teal); border-color: var(--teal); }
      .save-professor:hover, .save-professor:focus-visible { border-color: #75aaa5; outline: 2px solid rgba(69,130,124,.2); outline-offset: 1px; }
      .poly-save-row { display: flex; justify-content: flex-start; margin-top: 10px; }
      .quick-rate-row { display: flex; align-items: stretch; }
      .quick-rate-row .quick-rate-professor { min-width: 0; width: auto; flex: 1; }
      .quick-rate-save { width: 46px; flex: 0 0 46px; display: grid; place-items: center; color: #347a74; background: #f5f9f8; border: 0; border-left: 1px solid #e1e9e7; cursor: pointer; }
      .quick-rate-save svg { width: 17px; height: 17px; }
      .quick-rate-save[aria-pressed="true"] { color: #fff; background: var(--teal); }
      .quick-rate-save:hover, .quick-rate-save:focus-visible { background: #e7f2ef; outline: 2px solid #75aaa5; outline-offset: -3px; }
      .quick-rate-save[aria-pressed="true"]:hover, .quick-rate-save[aria-pressed="true"]:focus-visible { background: #376f6a; }
      .saved-view { padding-bottom: 4px; }
      .saved-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .saved-heading { min-width: 0; flex: 1; }
      .saved-heading h2 { margin: 0; font-size: 17px; }
      .saved-heading p { margin: 3px 0 0; color: var(--muted); font-size: 10px; }
      .new-album-button { min-height: 38px; padding: 0 12px; color: #fff; background: var(--teal); border: 0; border-radius: 9px; font-size: 11px; font-weight: 750; cursor: pointer; }
      .new-album-button:hover, .new-album-button:focus-visible { background: #376f6a; outline: 2px solid #75aaa5; outline-offset: 2px; }
      .album-form { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 7px; margin-bottom: 12px; padding: 11px; background: #fff; border: 1px solid #dce6e3; border-radius: 11px; }
      .album-form label { grid-column: 1 / -1; color: var(--ink); font-size: 11px; font-weight: 750; }
      .album-input { min-width: 0; height: 38px; padding: 0 10px; color: var(--ink); background: #fff; border: 1px solid #cedbd8; border-radius: 8px; outline: none; }
      .album-input:focus { border-color: #6c9e98; box-shadow: 0 0 0 3px rgba(69,130,124,.12); }
      .small-action { min-height: 36px; padding: 0 10px; color: #326e69; background: #e7f2ef; border: 0; border-radius: 8px; font-size: 10px; font-weight: 750; cursor: pointer; }
      .small-action.primary { color: #fff; background: var(--teal); }
      .small-action.danger { color: #8a3f36; background: #f9e9e5; }
      .small-action:hover, .small-action:focus-visible { filter: brightness(.95); outline: 2px solid #75aaa5; outline-offset: 1px; }
      .saved-state { display: grid; gap: 10px; }
      .saved-empty { min-height: 300px; display: grid; place-content: center; justify-items: center; padding: 24px; color: var(--muted); background: #fff; border: 1px dashed #cddad7; border-radius: 13px; text-align: center; }
      .saved-empty .empty-icon { margin-bottom: 12px; }
      .saved-empty strong { color: var(--ink); font-size: 15px; }
      .saved-empty span { max-width: 280px; margin-top: 6px; font-size: 11px; }
      .album-card { overflow: hidden; background: #fff; border: 1px solid #dce6e3; border-radius: 13px; box-shadow: 0 2px 5px rgba(34,53,59,.05); }
      .album-card-header { display: flex; align-items: center; gap: 6px; padding: 8px; }
      .album-toggle { min-width: 0; min-height: 46px; flex: 1; display: flex; align-items: center; gap: 9px; padding: 4px 7px; color: var(--ink); background: transparent; border: 0; text-align: left; cursor: pointer; }
      .album-toggle:hover, .album-toggle:focus-visible { color: #326e69; background: #f1f7f5; border-radius: 8px; outline: none; }
      .album-chevron { flex: 0 0 auto; font-size: 13px; transform: rotate(-90deg); transition: transform .15s ease; }
      .album-toggle[aria-expanded="true"] .album-chevron { transform: rotate(0); }
      .album-title { min-width: 0; flex: 1; }
      .album-title strong, .album-title span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .album-title strong { font-size: 13px; }
      .album-title span { margin-top: 2px; color: var(--muted); font-size: 9px; }
      .album-header-action { min-width: 36px; min-height: 36px; padding: 0 7px; color: #607078; background: transparent; border: 0; border-radius: 8px; font-size: 9px; font-weight: 700; cursor: pointer; }
      .album-header-action:hover, .album-header-action:focus-visible { color: #326e69; background: #e7f2ef; outline: none; }
      .album-inline-panel { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 7px; padding: 0 12px 12px; }
      .album-inline-panel p { grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: 10px; }
      .album-professors { display: grid; gap: 8px; padding: 0 10px 10px; border-top: 1px solid #edf1f0; }
      .album-professor { display: grid; grid-template-columns: 38px minmax(0,1fr); gap: 9px; padding: 10px 2px 2px; }
      .album-professor + .album-professor { border-top: 1px solid #edf1f0; }
      .album-professor .professor-avatar { width: 38px; height: 38px; font-size: 10px; }
      .saved-professor-copy { min-width: 0; }
      .saved-professor-copy strong, .saved-professor-copy span { display: block; }
      .saved-professor-copy strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .saved-professor-copy span { margin-top: 2px; color: var(--muted); font-size: 9px; }
      .saved-professor-actions { grid-column: 2; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
      .saved-professor-actions a { text-decoration: none; }
      .album-empty { padding: 16px 10px; color: var(--muted); font-size: 10px; text-align: center; }
      .browser-local-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; padding: 10px; color: #607078; background: #eef4f2; border-radius: 9px; font-size: 9px; }
      .browser-local-note svg { width: 15px; height: 15px; flex: 0 0 15px; color: var(--teal); }
      .modal-backdrop { position: absolute; z-index: 5; inset: 0; display: grid; align-items: end; padding: 14px; background: rgba(22,36,41,.45); }
      .save-dialog { max-height: calc(100% - 28px); overflow-y: auto; padding: 16px; color: var(--ink); background: #fff; border-radius: 16px; box-shadow: 0 18px 48px rgba(12,27,33,.3); }
      .save-dialog h2 { margin: 0; font-size: 17px; }
      .save-dialog > p { margin: 4px 0 12px; color: var(--muted); font-size: 10px; }
      .album-checklist { display: grid; gap: 7px; }
      .album-check { min-height: 44px; display: flex; align-items: center; gap: 9px; padding: 9px 10px; background: #f4f8f7; border: 1px solid #dce6e3; border-radius: 9px; cursor: pointer; }
      .album-check input { width: 17px; height: 17px; accent-color: var(--teal); }
      .album-check span { min-width: 0; flex: 1; overflow: hidden; font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
      .dialog-create { margin-top: 12px; }
      .dialog-error { min-height: 16px; margin: 8px 0 0; color: #9b4036; font-size: 10px; }
      .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
      nav { min-height: 66px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 7px 14px; background: #fff; border-top: 1px solid #e2e9e7; }
      .nav-button { display: grid; place-items: center; align-content: center; gap: 2px; color: #74818a; background: transparent; border: 0; border-radius: 11px; font-size: 11px; cursor: pointer; }
      .nav-button svg { width: 19px; height: 19px; }
      .nav-button.active { color: #326e69; background: #e4f1ee; font-weight: 700; }
      .nav-button:focus-visible { outline: 2px solid #75aaa5; outline-offset: -2px; }
      .toast { position: absolute; top: 72px; left: 50%; z-index: 2; width: max-content; max-width: 330px; padding: 8px 12px; color: #fff; background: #33484f; border-radius: 8px; box-shadow: 0 5px 15px rgba(0,0,0,.18); font-size: 12px; text-align: center; transform: translate(-50%, -8px); opacity: 0; pointer-events: none; transition: .18s ease; }
      .toast.show { opacity: 1; transform: translate(-50%, 0); }
      @media (max-width: 520px) { .panel { top: 8px; right: 8px; width: calc(100vw - 16px); height: calc(100vh - 16px); } }
      @media (prefers-reduced-motion: reduce) { .panel, .status.loading .status-dot, .review-preview.loading, .skeleton { animation: none; } .toast { transition: none; } }
    </style>
    <section class="panel" role="dialog" aria-label="Professor Insights">
      <header class="topbar">
        <div class="brand-icon">${icon("cap")}</div>
        <div class="brand"><h1>Professor Insights</h1><p data-brand-school>Choose your school</p></div>
        <button class="icon-button settings" type="button" aria-label="Data information">${icon("gear")}</button>
        <button class="icon-button close" type="button" aria-label="Close Professor Insights">${icon("close")}</button>
      </header>
      <main>
        <div class="school-card" data-school-shell>
          <div class="school-selected" data-school-selected hidden>
            <div class="school-selected-copy"><strong data-school-name></strong><span data-school-location></span></div>
            <button class="school-change" type="button" data-school-change>Change</button>
          </div>
          <form data-school-search-form>
            <label class="school-search-label" for="professor-insights-school-search">School on Rate My Professors</label>
            <div class="school-search-row"><input class="school-search-input" id="professor-insights-school-search" data-school-search-input type="search" placeholder="Search your school" autocomplete="off"><button class="school-search-button" type="submit">Find</button></div>
            <p class="school-search-hint">Choose the exact campus once. It is remembered for this school.</p>
            <div class="school-results" data-school-results aria-live="polite"></div>
          </form>
        </div>
        <section class="view" data-view="detected">
          <div class="status loading">
            <span class="status-dot"></span>
            <div class="status-copy"><strong>Scanning this page</strong><span>Looking for instructor names…</span></div>
            <button class="icon-button refresh" type="button" aria-label="Rescan page and refresh data">${icon("refresh")}</button>
          </div>
          <form class="search-form" role="search">
            <label class="search-wrap"><span hidden>Search a professor</span>${icon("search")}<input class="search-input" type="search" placeholder="Search a professor" autocomplete="off"></label>
            <button class="search-button" type="submit">Search</button>
          </form>
          <div class="results-heading"><h2>Connecting…</h2><span>Review sources</span></div>
          <div class="results"><div class="skeleton"></div><div class="skeleton"></div></div>
          <div class="note">${icon("people")}<span>Community ratings use different scales: PolyRatings is 0–4 and Rate My Professors is 1–5. Use reviews as one input among many.</span></div>
        </section>
        <section class="view quick-rate" data-view="quick-rate" hidden>
          <div class="quick-rate-intro"><h2>Choose a professor to rate</h2><p>Click a professor to open their exact Rate My Professors rating page.</p></div>
          <div class="quick-rate-empty" data-quick-rate-empty>
            <div class="empty-icon">${icon("rate")}</div><strong>No professors to show yet</strong><span>Detect or search for a professor first, then return here to choose one.</span>
          </div>
          <div class="quick-rate-list" data-quick-rate-list hidden></div>
          <div class="quick-rate-note">${icon("people")}<span>The extension opens RMP only after it verifies one exact professor at your selected school. You review and submit the rating on RMP.</span></div>
        </section>
        <section class="view saved-view" data-view="saved" hidden>
          <div class="saved-header">
            <div class="saved-heading"><h2>Saved professors</h2><p data-saved-summary>Loading albums…</p></div>
            <button class="new-album-button" type="button" data-new-album>+ New album</button>
          </div>
          <form class="album-form" data-create-album-form hidden>
            <label for="professor-insights-new-album">New album name</label>
            <input class="album-input" id="professor-insights-new-album" data-create-album-input maxlength="60" placeholder="Fall 2026 or CS 61B" autocomplete="off">
            <button class="small-action primary" type="submit">Create</button>
            <button class="small-action" type="button" data-cancel-create-album>Cancel</button>
          </form>
          <div class="saved-state" data-saved-state aria-live="polite"></div>
          <div class="browser-local-note">${icon("saved")}<span>Albums are saved in this Chrome profile on this browser. They are not synced to an account.</span></div>
        </section>
      </main>
      <nav aria-label="Professor Insights sections">
        <button class="nav-button active" type="button" data-nav="detected">${icon("scan")}<span>Detected</span></button>
        <button class="nav-button" type="button" data-nav="quick-rate">${icon("rate")}<span>Quick rate</span></button>
        <button class="nav-button" type="button" data-nav="saved">${icon("saved")}<span>Saved</span></button>
      </nav>
      <div class="toast" role="status"></div>
      <div class="modal-backdrop" data-save-dialog hidden>
        <section class="save-dialog" role="dialog" aria-modal="true" aria-labelledby="professor-insights-save-title">
          <h2 id="professor-insights-save-title" data-save-dialog-title>Save professor</h2>
          <p>Choose one or more albums. Uncheck every album to unsave this professor.</p>
          <div class="album-checklist" data-album-checklist></div>
          <form class="album-form dialog-create" data-dialog-create-form>
            <label for="professor-insights-dialog-album">Create another album</label>
            <input class="album-input" id="professor-insights-dialog-album" data-dialog-album-input maxlength="60" placeholder="Spring 2027" autocomplete="off">
            <button class="small-action primary" type="submit">Create</button>
          </form>
          <p class="dialog-error" data-dialog-error role="alert"></p>
          <div class="dialog-actions"><button class="small-action" type="button" data-cancel-save>Cancel</button><button class="small-action primary" type="button" data-confirm-save>Save changes</button></div>
        </section>
      </div>
    </section>
  `;

  document.documentElement.appendChild(host);

  const elements = {
    brandSchool: shadow.querySelector("[data-brand-school]"),
    status: shadow.querySelector(".status"),
    statusTitle: shadow.querySelector(".status strong"),
    statusDetail: shadow.querySelector(".status-copy span"),
    heading: shadow.querySelector(".results-heading h2"),
    freshness: shadow.querySelector(".results-heading span"),
    results: shadow.querySelector(".results"),
    input: shadow.querySelector(".search-input"),
    toast: shadow.querySelector(".toast"),
    schoolShell: shadow.querySelector("[data-school-shell]"),
    schoolSelected: shadow.querySelector("[data-school-selected]"),
    schoolName: shadow.querySelector("[data-school-name]"),
    schoolLocation: shadow.querySelector("[data-school-location]"),
    schoolSearchForm: shadow.querySelector("[data-school-search-form]"),
    schoolSearchInput: shadow.querySelector("[data-school-search-input]"),
    schoolResults: shadow.querySelector("[data-school-results]"),
    quickRateEmpty: shadow.querySelector("[data-quick-rate-empty]"),
    quickRateList: shadow.querySelector("[data-quick-rate-list]"),
    savedSummary: shadow.querySelector("[data-saved-summary]"),
    savedState: shadow.querySelector("[data-saved-state]"),
    createAlbumForm: shadow.querySelector("[data-create-album-form]"),
    createAlbumInput: shadow.querySelector("[data-create-album-input]"),
    saveDialog: shadow.querySelector("[data-save-dialog]"),
    saveDialogTitle: shadow.querySelector("[data-save-dialog-title]"),
    albumChecklist: shadow.querySelector("[data-album-checklist]"),
    dialogCreateForm: shadow.querySelector("[data-dialog-create-form]"),
    dialogAlbumInput: shadow.querySelector("[data-dialog-album-input]"),
    dialogError: shadow.querySelector("[data-dialog-error]")
  };

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.observer?.disconnect();
    state.observedFrames.forEach((frame) => frame.removeEventListener("load", handleEmbeddedFrameLoad));
    state.observedFrames.clear();
    window.clearTimeout(state.scanTimer);
    document.removeEventListener("click", handleHighlightedProfessorClick, true);
    globalThis.chrome?.runtime?.onMessage?.removeListener(handleRuntimeMessage);
    globalThis.chrome?.storage?.onChanged?.removeListener(handleAlbumsStorageChanged);
    clearPageHighlights();
    host.remove();
    delete window[APP_KEY];
    sendMessage({ type: "PI_PANEL_CLOSED" }).catch(() => {});
  }

  window[APP_KEY] = { destroy };
  host.addEventListener("professor-insights-destroy", destroy);
  shadow.querySelector(".close").addEventListener("click", destroy);
  shadow.querySelector(".settings").addEventListener("click", () => showToast("PolyRatings reviews currently cover Cal Poly. Professor search and Quick Rate can check any selected RMP school."));
  shadow.querySelector(".refresh").addEventListener("click", async () => {
    try {
      const response = await sendMessage({ type: "PI_RESCAN_PAGE" });
      if (response?.context) state.frameContext = normalizePageContext(response.context);
    } catch (_error) { /* The local document scan still runs. */ }
    scanPage(true);
  });
  shadow.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.nav));
  });
  elements.schoolSearchForm.addEventListener("submit", handleSchoolSearch);
  shadow.querySelector("[data-school-change]").addEventListener("click", clearRmpSchool);
  shadow.querySelector(".search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = elements.input.value.trim();
    if (query.length < 2) return showToast("Enter at least two characters.");
    await searchProfessor(query);
  });
  shadow.querySelector("[data-new-album]").addEventListener("click", () => toggleCreateAlbum(true));
  shadow.querySelector("[data-cancel-create-album]").addEventListener("click", () => toggleCreateAlbum(false));
  elements.createAlbumForm.addEventListener("submit", handleCreateAlbum);
  shadow.querySelector("[data-cancel-save]").addEventListener("click", closeSaveDialog);
  shadow.querySelector("[data-confirm-save]").addEventListener("click", applySaveDialog);
  elements.dialogCreateForm.addEventListener("submit", handleDialogCreateAlbum);
  elements.saveDialog.addEventListener("click", (event) => { if (event.target === elements.saveDialog) closeSaveDialog(); });
  shadow.addEventListener("keydown", handlePanelKeydown);

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 3500);
  }

  function setStatus(title, detail, type = "ready") {
    elements.statusTitle.textContent = title;
    elements.statusDetail.textContent = detail;
    elements.status.classList.toggle("loading", type === "loading");
    elements.status.classList.toggle("error", type === "error");
  }

  function activateView(nextView) {
    shadow.querySelectorAll("[data-nav]").forEach((item) => item.classList.toggle("active", item.dataset.nav === nextView));
    shadow.querySelectorAll("[data-view]").forEach((view) => { view.hidden = view.dataset.view !== nextView; });
    elements.schoolShell.hidden = nextView === "saved";
    if (nextView === "saved") {
      elements.brandSchool.textContent = "Saved on this browser";
      renderSavedView();
    } else {
      renderSchoolSelector();
    }
    if (nextView === "quick-rate") renderQuickRateList();
  }

  function portalOriginKey() {
    const knownSchool = knownRmpSchoolForPage();
    if (knownSchool?.id) return `school:${knownSchool.id}`;
    try { return window.location.origin || window.location.hostname || "local-preview"; }
    catch (_error) { return "unknown-portal"; }
  }

  function knownRmpSchoolForPage() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    if (hostname === "berkeley.edu" || hostname.endsWith(".berkeley.edu")) return BERKELEY_SCHOOL;
    if (hostname === "calpoly.edu" || hostname.endsWith(".calpoly.edu")) return quickRate?.CAL_POLY_SCHOOL || null;
    return null;
  }

  function isCalPolyPortal() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    return hostname === "calpoly.edu" || hostname.endsWith(".calpoly.edu");
  }

  function schoolLocation(school) {
    return [school?.city, school?.state].filter(Boolean).join(", ") || "Location not listed";
  }

  async function loadRmpSchool() {
    if (!quickRate) return;
    try {
      const previewSchool = window.__PROFESSOR_INSIGHTS_PREVIEW_SCHOOL__;
      const previewNeedsSchool = !globalThis.chrome?.runtime?.id && new URLSearchParams(window.location.search).has("choose-school");
      if (previewNeedsSchool) state.rmpSchool = null;
      else if (previewSchool) state.rmpSchool = quickRate.cleanSchool(previewSchool);
      else {
        const stored = await storageGet(SCHOOL_STORAGE_KEY);
        state.rmpSchool = quickRate.cleanSchool(stored?.[SCHOOL_STORAGE_KEY]?.[portalOriginKey()]);
        if (!state.rmpSchool.id && knownRmpSchoolForPage()) state.rmpSchool = { ...knownRmpSchoolForPage() };
      }
    } catch (_error) {
      state.rmpSchool = knownRmpSchoolForPage() ? { ...knownRmpSchoolForPage() } : null;
    }
    if (!state.rmpSchool?.id) state.rmpSchool = null;
    renderSchoolSelector();
    if (!shadow.querySelector('[data-view="quick-rate"]').hidden) renderQuickRateList();
  }

  async function persistRmpSchool() {
    const stored = await storageGet(SCHOOL_STORAGE_KEY).catch(() => ({}));
    const selections = stored?.[SCHOOL_STORAGE_KEY] && typeof stored[SCHOOL_STORAGE_KEY] === "object" ? { ...stored[SCHOOL_STORAGE_KEY] } : {};
    if (state.rmpSchool?.id) selections[portalOriginKey()] = state.rmpSchool;
    else delete selections[portalOriginKey()];
    await storageSet({ [SCHOOL_STORAGE_KEY]: selections });
  }

  function renderSchoolSelector() {
    const selected = Boolean(state.rmpSchool?.id && state.rmpSchool?.nodeId);
    elements.schoolSelected.hidden = !selected;
    elements.schoolSearchForm.hidden = selected;
    elements.brandSchool.textContent = selected ? state.rmpSchool.name : "Choose your school";
    if (selected) {
      elements.schoolName.textContent = state.rmpSchool.name;
      elements.schoolLocation.textContent = schoolLocation(state.rmpSchool);
      elements.schoolResults.replaceChildren();
    }
  }

  async function handleSchoolSearch(event) {
    event.preventDefault();
    const query = elements.schoolSearchInput.value.replace(/\s+/g, " ").trim();
    if (query.length < 2) return showToast("Enter at least two characters for your school.");
    elements.schoolResults.innerHTML = '<p class="school-results-message">Searching Rate My Professors…</p>';
    try {
      const response = await sendMessage({ type: "PI_SEARCH_RMP_SCHOOLS", query });
      if (!response?.ok) throw new Error(response?.error || "School search failed");
      renderSchoolResults(response.schools || []);
    } catch (error) {
      elements.schoolResults.innerHTML = `<p class="school-results-message">Could not search schools: ${escapeHtml(error.message)}</p>`;
    }
  }

  function renderSchoolResults(schools) {
    if (!schools.length) {
      elements.schoolResults.innerHTML = '<p class="school-results-message">No schools found. Try the full campus name.</p>';
      return;
    }
    elements.schoolResults.innerHTML = schools.map((school, index) => `
      <button class="school-result" type="button" data-school-result="${index}">
        <strong>${escapeHtml(school.name)}</strong><span>${escapeHtml(schoolLocation(school))}</span>
      </button>`).join("");
    elements.schoolResults.querySelectorAll("[data-school-result]").forEach((button) => {
      button.addEventListener("click", () => selectRmpSchool(schools[Number(button.dataset.schoolResult)]));
    });
  }

  async function selectRmpSchool(school) {
    const selected = quickRate?.cleanSchool(school);
    if (!selected?.id || !selected.nodeId) return showToast("That RMP school result is incomplete. Try another result.");
    state.rmpSchool = selected;
    renderSchoolSelector();
    renderQuickRateList();
    await persistRmpSchool().catch(() => showToast("School selected, but it could not be remembered."));
    showToast(`${selected.name} selected for searches and Quick Rate.`);
    if (state.lastSearchQuery) searchProfessor(state.lastSearchQuery);
  }

  async function clearRmpSchool() {
    state.scanNumber += 1;
    state.rmpSchool = null;
    state.rmpLookup = { status: state.lastSearchQuery ? "needs-school" : "idle", result: null, error: "" };
    renderSchoolSelector();
    renderQuickRateList();
    if (state.lastSearchQuery) renderSearchResults(state.lastSearchQuery);
    await persistRmpSchool().catch(() => {});
    window.requestAnimationFrame(() => elements.schoolSearchInput.focus());
  }

  function quickRateProfessorList() {
    const professors = new Map();
    const add = (professor) => {
      const name = quickRate?.professorName(professor);
      const key = normalizeText(name);
      if (!key || key.split(" ").length < 2) return;
      const existing = professors.get(key);
      if (!existing || (professor.id && !String(professor.id).startsWith("candidate:"))) professors.set(key, professor);
    };

    state.professors.forEach(add);
    state.pageCandidates.forEach((name) => add({ id: `candidate:${normalizeText(name)}`, name, department: "Detected on this page", course: "", source: "page" }));
    state.manualCandidates.forEach((name) => add({ id: `candidate:${normalizeText(name)}`, name, department: "Entered manually", course: "Course not listed", source: "manual" }));
    return [...professors.values()];
  }

  function renderQuickRateList() {
    const professors = quickRateProfessorList();
    const hasProfessors = professors.length > 0 && quickRate;
    elements.quickRateEmpty.hidden = Boolean(hasProfessors);
    elements.quickRateList.hidden = !hasProfessors;
    if (!hasProfessors) {
      elements.quickRateList.replaceChildren();
      return;
    }

    elements.quickRateList.innerHTML = professors.map((professor) => {
      const saved = isProfessorInAnyAlbum(professorSnapshotFromQuickRate(professor));
      return `
        <div class="quick-rate-item" data-rate-item="${escapeHtml(professor.id)}">
          <div class="quick-rate-row">
            <button class="quick-rate-professor" type="button" data-rate-professor-id="${escapeHtml(professor.id)}" aria-label="Rate ${escapeHtml(professor.name)} on Rate My Professors">
              <span class="professor-avatar">${escapeHtml(quickRate.professorInitials(professor.name))}</span>
              <span class="quick-rate-copy"><strong>${escapeHtml(professor.name)}</strong><span>${escapeHtml(professor.source ? professor.department : `${professor.department || "Department not listed"} · ${professor.course || "Course not listed"}`)}</span></span>
              <span class="quick-rate-action" data-rate-action>${state.rmpSchool ? "Rate on RMP ↗" : "Choose school first"}</span>
            </button>
            <button class="quick-rate-save" type="button" data-save-rate-id="${escapeHtml(professor.id)}" aria-label="Save ${escapeHtml(professor.name)} to albums" aria-pressed="${saved}">${icon("saved")}</button>
          </div>
          <p class="quick-rate-status" data-rate-status aria-live="polite"></p>
        </div>`;
    }).join("");

    elements.quickRateList.querySelectorAll("[data-rate-professor-id]").forEach((button) => {
      button.addEventListener("click", () => openQuickRateProfessor(button));
    });
    elements.quickRateList.querySelectorAll("[data-save-rate-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const professor = quickRateProfessorList().find((item) => String(item.id) === String(button.dataset.saveRateId));
        if (professor) openSaveDialog(professorSnapshotFromQuickRate(professor), button);
      });
    });
  }

  async function openQuickRateProfessor(button) {
    const professor = quickRateProfessorList().find((item) => String(item.id) === String(button.dataset.rateProfessorId));
    if (!professor || button.disabled) return;
    if (!state.rmpSchool) {
      showToast("Choose your school before opening Rate My Professors.");
      elements.schoolSearchInput.focus();
      return;
    }
    const action = button.querySelector("[data-rate-action]");
    const status = button.closest("[data-rate-item]")?.querySelector("[data-rate-status]");
    button.disabled = true;
    action.textContent = "Finding exact page…";
    status?.classList.remove("show");

    try {
      const response = await sendMessage({
        type: "PI_OPEN_RMP_RATING",
        professor: {
          id: professor.id,
          name: professor.name,
          firstName: professor.firstName,
          lastName: professor.lastName,
          department: professor.department,
          rmpLegacyId: professor.rmpLegacyId
        },
        school: state.rmpSchool
      });
      if (!response?.ok) throw new Error(response?.error || "RMP could not be reached");
      if (response.match === "exact" && response.opened) {
        action.textContent = "Opened on RMP ✓";
        showToast(`Opened ${professor.name}’s exact RMP rating page.`);
        window.setTimeout(() => { if (action.isConnected) action.textContent = "Open again ↗"; }, 2200);
        return;
      }

      action.textContent = "No exact match";
      if (status) {
        const searchUrl = quickRate.buildRmpSearchUrl(professor, state.rmpSchool);
        status.innerHTML = `A unique profile at ${escapeHtml(state.rmpSchool.name)} could not be verified. <a href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer">Search RMP manually ↗</a>`;
        status.classList.add("show");
      }
      showToast(`No unique RMP profile was found for ${professor.name} at ${state.rmpSchool.name}.`);
    } catch (error) {
      action.textContent = "Try again ↗";
      if (status) {
        status.textContent = `Could not check RMP: ${error.message}`;
        status.classList.add("show");
      }
      showToast("Could not reach Rate My Professors. Try again.");
    } finally {
      button.disabled = false;
    }
  }

  function storageGet(key) {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local.get(key);
    try { return Promise.resolve({ [key]: JSON.parse(localStorage.getItem(key) || "null") }); }
    catch (_error) { return Promise.resolve({}); }
  }

  function storageSet(value) {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local.set(value);
    try { Object.entries(value).forEach(([key, item]) => localStorage.setItem(key, JSON.stringify(item))); }
    catch (_error) { return Promise.reject(_error); }
    return Promise.resolve();
  }

  async function loadAlbums() {
    if (!albumStore) {
      state.libraryStatus = "error";
      state.libraryError = "The album library did not load.";
      renderSavedView();
      return;
    }
    state.libraryStatus = "loading";
    renderSavedView();
    try {
      const stored = await storageGet(albumStore.STORAGE_KEY);
      state.library = albumStore.normalizeLibrary(stored?.[albumStore.STORAGE_KEY]);
      state.libraryStatus = "ready";
      state.libraryError = "";
      if (!state.expandedAlbumIds.size && state.library.albums[0]) state.expandedAlbumIds.add(state.library.albums[0].id);
      renderSavedView();
      refreshSaveButtons();
    } catch (error) {
      state.libraryStatus = "error";
      state.libraryError = error.message || "Saved professors could not be loaded.";
      renderSavedView();
    }
  }

  function handleAlbumsStorageChanged(changes, areaName) {
    if (areaName !== "local" || !albumStore || !changes?.[albumStore.STORAGE_KEY]) return;
    state.library = albumStore.normalizeLibrary(changes[albumStore.STORAGE_KEY].newValue);
    state.libraryStatus = "ready";
    state.libraryError = "";
    renderSavedView();
    refreshSaveButtons();
    if (!elements.saveDialog.hidden && state.pendingSaveProfessor) renderSaveDialog();
  }

  async function readLatestLibrary() {
    if (!albumStore) throw new Error("The album library did not load.");
    const stored = await storageGet(albumStore.STORAGE_KEY);
    return albumStore.normalizeLibrary(stored?.[albumStore.STORAGE_KEY]);
  }

  async function commitAlbumMutation(buildMutation, successMessage = "") {
    if (albumsReady) await albumsReady.catch(() => {});
    let current;
    try {
      current = await readLatestLibrary();
    } catch (error) {
      showToast(error.message || "Saved professors could not be loaded.");
      return null;
    }
    const result = buildMutation(current);
    if (!result?.ok) {
      showToast(albumErrorMessage(result));
      return result || null;
    }
    try {
      await storageSet({ [albumStore.STORAGE_KEY]: result.library });
      state.library = result.library;
      state.libraryStatus = "ready";
      state.libraryError = "";
      renderSavedView();
      refreshSaveButtons();
      if (successMessage) showToast(successMessage);
      return result;
    } catch (error) {
      showToast(`Could not save albums: ${error.message || "storage failed"}`);
      return null;
    }
  }

  function albumErrorMessage(result) {
    if (result?.message) return result.message;
    const messages = {
      "invalid-name": "Enter an album name between 1 and 60 characters.",
      "duplicate-name": "An album with that name already exists.",
      "album-limit": "You have reached the album limit.",
      "album-not-found": "That album no longer exists.",
      "professor-limit": "That album has reached its professor limit.",
      "invalid-professor": "That professor could not be saved.",
      "professor-not-found": "That saved professor no longer exists."
    };
    return messages[result?.error] || "The album change could not be saved.";
  }

  function makeAlbumId() {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `album-${random}`;
  }

  function professorSnapshotFromPoly(professor) {
    const matchingRmp = state.rmpLookup.status === "exact"
      && String(state.rmpSchool?.id || "") === String(quickRate?.CAL_POLY_SCHOOL?.id || "")
      && normalizeText(state.rmpLookup.result?.name) === normalizeText(professor?.name)
      ? rmpSourceFromResult(state.rmpLookup.result)
      : undefined;
    return {
      name: professor?.name,
      department: professor?.department,
      course: professor?.course,
      school: quickRate?.CAL_POLY_SCHOOL,
      polyratings: {
        id: professor?.id,
        rating: professor?.rating,
        reviews: professor?.reviews,
        profileUrl: professor?.links?.polyratings
      },
      rmp: matchingRmp
    };
  }

  function rmpSourceFromResult(result) {
    if (!result) return undefined;
    return {
      legacyId: result.legacyId,
      avgRating: result.avgRating,
      numRatings: result.numRatings,
      avgDifficulty: result.avgDifficulty,
      wouldTakeAgainPercent: result.wouldTakeAgainPercent,
      profileUrl: result.profileUrl,
      ratingUrl: result.ratingUrl,
      searchUrl: result.searchUrl
    };
  }

  function professorSnapshotFromRmp(result) {
    return {
      name: result?.name,
      department: result?.department,
      course: "",
      school: result?.school || state.rmpSchool,
      rmp: rmpSourceFromResult(result)
    };
  }

  function professorSnapshotFromQuickRate(professor) {
    const polyProfessor = state.professors.find((item) => String(item.id) === String(professor?.id));
    if (polyProfessor) return professorSnapshotFromPoly(polyProfessor);
    const exactRmp = state.rmpLookup.status === "exact" && normalizeText(state.rmpLookup.result?.name) === normalizeText(professor?.name)
      ? state.rmpLookup.result
      : null;
    return {
      name: professor?.name,
      department: professor?.department,
      course: professor?.course,
      school: state.rmpSchool || undefined,
      rmp: exactRmp ? rmpSourceFromResult(exactRmp) : state.rmpSchool ? { searchUrl: quickRate?.buildRmpSearchUrl(professor, state.rmpSchool) } : undefined
    };
  }

  function equivalentSavedProfessor(saved, rawSnapshot) {
    if (!saved || !rawSnapshot || !albumStore) return false;
    const wantedKey = albumStore.professorKey(rawSnapshot);
    if (wantedKey && saved.key === wantedKey) return true;
    const savedRmpId = String(saved.rmp?.legacyId || "").toLowerCase();
    const wantedRmpId = String(rawSnapshot.rmp?.legacyId || rawSnapshot.rmpLegacyId || "").toLowerCase();
    if (savedRmpId && wantedRmpId && savedRmpId !== wantedRmpId) return false;
    const savedPolyId = String(saved.polyratings?.id || "").toLowerCase();
    const wantedPolyId = String(rawSnapshot.polyratings?.id || rawSnapshot.polyId || "").toLowerCase();
    if (savedPolyId && wantedPolyId && savedPolyId !== wantedPolyId) return false;
    const savedSchool = String(saved.school?.id || "");
    const wantedSchool = String(rawSnapshot.school?.id || "");
    return normalizeText(saved.name) === normalizeText(rawSnapshot.name) && savedSchool === wantedSchool;
  }

  function findEquivalentProfessor(album, snapshot) {
    return album?.professors?.find((professor) => equivalentSavedProfessor(professor, snapshot)) || null;
  }

  function albumIdsForProfessor(snapshot, library = state.library) {
    return (library?.albums || []).filter((album) => findEquivalentProfessor(album, snapshot)).map((album) => album.id);
  }

  function isProfessorInAnyAlbum(snapshot) {
    return Boolean(albumStore && snapshot?.name && albumIdsForProfessor(snapshot).length);
  }

  function mergedProfessorSnapshot(existing, incoming) {
    return {
      ...existing,
      ...incoming,
      name: incoming.name || existing.name,
      department: incoming.department || existing.department,
      course: incoming.course || existing.course,
      school: incoming.school?.id ? incoming.school : existing.school,
      polyratings: { ...(existing.polyratings || {}), ...(incoming.polyratings || {}) },
      rmp: { ...(existing.rmp || {}), ...(incoming.rmp || {}) }
    };
  }

  function refreshSaveButtons() {
    shadow.querySelectorAll("[data-save-poly-id]").forEach((button) => {
      const professor = state.professors.find((item) => String(item.id) === String(button.dataset.savePolyId));
      if (professor) setSaveButtonState(button, isProfessorInAnyAlbum(professorSnapshotFromPoly(professor)));
    });
    shadow.querySelectorAll("[data-save-rmp]").forEach((button) => {
      if (state.rmpLookup.result) setSaveButtonState(button, isProfessorInAnyAlbum(professorSnapshotFromRmp(state.rmpLookup.result)));
    });
    shadow.querySelectorAll("[data-save-rate-id]").forEach((button) => {
      const professor = quickRateProfessorList().find((item) => String(item.id) === String(button.dataset.saveRateId));
      if (professor) setSaveButtonState(button, isProfessorInAnyAlbum(professorSnapshotFromQuickRate(professor)));
    });
  }

  function setSaveButtonState(button, saved) {
    button.setAttribute("aria-pressed", String(Boolean(saved)));
    const label = button.querySelector("span");
    if (label) label.textContent = saved ? "Saved" : "Save";
  }

  function renderSavedView() {
    if (!elements.savedState) return;
    const albums = state.library?.albums || [];
    const uniqueProfessors = new Set(albums.flatMap((album) => (album.professors || []).map((professor) => professor.key)));
    elements.savedSummary.textContent = state.libraryStatus === "loading"
      ? "Loading albums…"
      : `${albums.length} album${albums.length === 1 ? "" : "s"} · ${uniqueProfessors.size} professor${uniqueProfessors.size === 1 ? "" : "s"}`;

    if (state.libraryStatus === "loading") {
      elements.savedState.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      return;
    }
    if (state.libraryStatus === "error") {
      elements.savedState.innerHTML = `<div class="saved-empty"><div class="empty-icon">${icon("saved")}</div><strong>Saved professors could not be loaded</strong><span>${escapeHtml(state.libraryError || "Try loading them again.")}</span><button class="small-action primary" type="button" data-retry-albums>Retry</button></div>`;
      elements.savedState.querySelector("[data-retry-albums]")?.addEventListener("click", () => { albumsReady = loadAlbums(); });
      return;
    }
    if (!albums.length) {
      elements.savedState.innerHTML = `<div class="saved-empty"><div class="empty-icon">${icon("saved")}</div><strong>No albums yet</strong><span>Create an album for a class, semester, or registration shortlist, then save professors into it.</span><button class="small-action primary" type="button" data-empty-new-album>Create your first album</button></div>`;
      elements.savedState.querySelector("[data-empty-new-album]")?.addEventListener("click", () => toggleCreateAlbum(true));
      return;
    }

    elements.savedState.innerHTML = albums.map((album, index) => albumMarkup(album, index)).join("");
    bindSavedViewActions();
  }

  function albumMarkup(album, index) {
    const expanded = state.expandedAlbumIds.has(album.id);
    const editing = state.editingAlbumId === album.id;
    const deleting = state.deletingAlbumId === album.id;
    const panelId = `professor-insights-album-${index}`;
    const professors = album.professors || [];
    return `<article class="album-card" data-album-card="${escapeHtml(album.id)}">
      <div class="album-card-header">
        <button class="album-toggle" type="button" data-album-toggle="${escapeHtml(album.id)}" aria-expanded="${expanded}" aria-controls="${panelId}"><span class="album-chevron">⌄</span><span class="album-title"><strong>${escapeHtml(album.name)}</strong><span>${professors.length} professor${professors.length === 1 ? "" : "s"}</span></span></button>
        <button class="album-header-action" type="button" data-rename-album="${escapeHtml(album.id)}" aria-label="Rename ${escapeHtml(album.name)}">Rename</button>
        <button class="album-header-action" type="button" data-delete-album="${escapeHtml(album.id)}" aria-label="Delete ${escapeHtml(album.name)}">Delete</button>
      </div>
      ${editing ? `<form class="album-inline-panel" data-rename-album-form="${escapeHtml(album.id)}"><input class="album-input" name="albumName" maxlength="60" value="${escapeHtml(album.name)}" aria-label="New name for ${escapeHtml(album.name)}"><button class="small-action primary" type="submit">Save</button><button class="small-action" type="button" data-cancel-rename>Cancel</button></form>` : ""}
      ${deleting ? `<div class="album-inline-panel"><p>Delete “${escapeHtml(album.name)}”? Professors saved in other albums will be kept.</p><span></span><button class="small-action danger" type="button" data-confirm-delete="${escapeHtml(album.id)}">Delete album</button><button class="small-action" type="button" data-cancel-delete>Cancel</button></div>` : ""}
      <div class="album-professors" id="${panelId}" ${expanded ? "" : "hidden"}>${professors.length ? professors.map((professor) => savedProfessorMarkup(album, professor)).join("") : `<div class="album-empty">No professors saved here. <button class="small-action" type="button" data-find-professors>Find professors</button></div>`}</div>
    </article>`;
  }

  function savedProfessorMarkup(album, professor) {
    const meta = [professor.department, professor.course, professor.school?.name].filter(Boolean).join(" · ") || "Details not listed";
    const profileUrl = professor.rmp?.profileUrl || professor.polyratings?.profileUrl || professor.rmp?.searchUrl || "";
    const profileLabel = professor.rmp?.profileUrl ? "RMP profile ↗" : professor.polyratings?.profileUrl ? "PolyRatings ↗" : "Search profile ↗";
    return `<div class="album-professor" data-saved-professor="${escapeHtml(professor.key)}">
      <span class="professor-avatar">${escapeHtml(quickRate?.professorInitials(professor.name) || "?")}</span>
      <div class="saved-professor-copy"><strong>${escapeHtml(professor.name)}</strong><span>${escapeHtml(meta)}</span></div>
      <div class="saved-professor-actions">${profileUrl ? `<a class="small-action" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">${profileLabel}</a>` : ""}<button class="small-action" type="button" data-edit-memberships data-album-id="${escapeHtml(album.id)}" data-professor-key="${escapeHtml(professor.key)}">Edit albums</button><button class="small-action danger" type="button" data-remove-saved data-album-id="${escapeHtml(album.id)}" data-professor-key="${escapeHtml(professor.key)}">Remove</button></div>
    </div>`;
  }

  function bindSavedViewActions() {
    elements.savedState.querySelectorAll("[data-album-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.albumToggle;
        if (state.expandedAlbumIds.has(id)) state.expandedAlbumIds.delete(id);
        else state.expandedAlbumIds.add(id);
        renderSavedView();
      });
    });
    elements.savedState.querySelectorAll("[data-rename-album]").forEach((button) => {
      button.addEventListener("click", () => {
        state.editingAlbumId = button.dataset.renameAlbum;
        state.deletingAlbumId = "";
        renderSavedView();
        const input = elements.savedState.querySelector(`[data-rename-album-form="${cssEscape(state.editingAlbumId)}"] input`);
        input?.focus();
        input?.select();
      });
    });
    elements.savedState.querySelectorAll("[data-delete-album]").forEach((button) => {
      button.addEventListener("click", () => {
        state.deletingAlbumId = button.dataset.deleteAlbum;
        state.editingAlbumId = "";
        renderSavedView();
        window.requestAnimationFrame(() => elements.savedState.querySelector("[data-cancel-delete]")?.focus());
      });
    });
    elements.savedState.querySelectorAll("[data-cancel-rename]").forEach((button) => button.addEventListener("click", () => {
      const id = state.editingAlbumId;
      state.editingAlbumId = "";
      renderSavedView();
      focusAlbumControl("rename", id);
    }));
    elements.savedState.querySelectorAll("[data-cancel-delete]").forEach((button) => button.addEventListener("click", () => {
      const id = state.deletingAlbumId;
      state.deletingAlbumId = "";
      renderSavedView();
      focusAlbumControl("delete", id);
    }));
    elements.savedState.querySelectorAll("[data-rename-album-form]").forEach((form) => form.addEventListener("submit", handleRenameAlbum));
    elements.savedState.querySelectorAll("[data-confirm-delete]").forEach((button) => button.addEventListener("click", () => confirmDeleteAlbum(button.dataset.confirmDelete)));
    elements.savedState.querySelectorAll("[data-remove-saved]").forEach((button) => button.addEventListener("click", () => removeSavedProfessor(button.dataset.albumId, button.dataset.professorKey)));
    elements.savedState.querySelectorAll("[data-edit-memberships]").forEach((button) => {
      button.addEventListener("click", () => {
        const album = state.library.albums.find((item) => item.id === button.dataset.albumId);
        const professor = album?.professors.find((item) => item.key === button.dataset.professorKey);
        if (professor) openSaveDialog(professor, button);
      });
    });
    elements.savedState.querySelectorAll("[data-find-professors]").forEach((button) => button.addEventListener("click", () => activateView("detected")));
  }

  function focusAlbumControl(action, albumId) {
    window.requestAnimationFrame(() => {
      const button = [...elements.savedState.querySelectorAll(`[data-${action}-album]`)]
        .find((item) => item.dataset[`${action}Album`] === albumId);
      button?.focus();
    });
  }

  function toggleCreateAlbum(show) {
    elements.createAlbumForm.hidden = !show;
    if (show) window.requestAnimationFrame(() => elements.createAlbumInput.focus());
    else elements.createAlbumInput.value = "";
  }

  async function handleCreateAlbum(event) {
    event.preventDefault();
    const name = elements.createAlbumInput.value;
    const result = await commitAlbumMutation((library) => albumStore.createAlbum(library, name, { id: makeAlbumId() }), "Album created.");
    if (!result?.ok) return;
    state.expandedAlbumIds.add(result.album.id);
    elements.createAlbumInput.value = "";
    toggleCreateAlbum(false);
    renderSavedView();
  }

  async function handleRenameAlbum(event) {
    event.preventDefault();
    const id = event.currentTarget.dataset.renameAlbumForm;
    const name = new FormData(event.currentTarget).get("albumName");
    const result = await commitAlbumMutation((library) => albumStore.renameAlbum(library, id, name), "Album renamed.");
    if (result?.ok) {
      state.editingAlbumId = "";
      renderSavedView();
      focusAlbumControl("rename", id);
    }
  }

  async function confirmDeleteAlbum(id) {
    const album = state.library.albums.find((item) => item.id === id);
    const result = await commitAlbumMutation((library) => albumStore.deleteAlbum(library, id), album ? `Deleted “${album.name}”.` : "Album deleted.");
    if (result?.ok) {
      state.deletingAlbumId = "";
      state.expandedAlbumIds.delete(id);
      renderSavedView();
      window.requestAnimationFrame(() => shadow.querySelector("[data-new-album]")?.focus());
    }
  }

  async function removeSavedProfessor(albumId, professorKey) {
    const album = state.library.albums.find((item) => item.id === albumId);
    const professor = album?.professors.find((item) => item.key === professorKey);
    const result = await commitAlbumMutation((library) => albumStore.removeProfessor(library, albumId, professorKey), professor ? `Removed ${professor.name} from ${album.name}.` : "Professor removed.");
    if (result?.ok) renderSavedView();
  }

  async function openSaveDialog(rawProfessor, returnFocus) {
    if (albumsReady) await albumsReady.catch(() => {});
    if (!albumStore || state.libraryStatus === "error") return showToast("Saved professors are unavailable right now.");
    const professor = albumStore.normalizeProfessor(rawProfessor);
    if (!professor) return showToast("That professor could not be saved.");
    state.pendingSaveProfessor = professor;
    state.pendingAlbumSelections = new Set(albumIdsForProfessor(professor));
    state.dialogAlbumIds = new Set(state.library.albums.map((album) => album.id));
    state.dialogReturnFocus = returnFocus || shadow.activeElement;
    elements.saveDialog.hidden = false;
    renderSaveDialog();
    window.requestAnimationFrame(() => (elements.albumChecklist.querySelector("input") || elements.dialogAlbumInput).focus());
  }

  function renderSaveDialog() {
    const professor = state.pendingSaveProfessor;
    if (!professor) return;
    elements.saveDialogTitle.textContent = `Save ${professor.name}`;
    elements.dialogError.textContent = "";
    const albums = state.library.albums.filter((album) => state.dialogAlbumIds.has(album.id));
    elements.albumChecklist.innerHTML = albums.length
      ? albums.map((album) => `<label class="album-check"><input type="checkbox" value="${escapeHtml(album.id)}" ${state.pendingAlbumSelections.has(album.id) ? "checked" : ""}><span>${escapeHtml(album.name)}</span><small>${album.professors.length}</small></label>`).join("")
      : '<div class="album-empty">No albums yet. Create one below and it will be selected automatically.</div>';
    elements.albumChecklist.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.pendingAlbumSelections.add(checkbox.value);
        else state.pendingAlbumSelections.delete(checkbox.value);
      });
    });
  }

  async function handleDialogCreateAlbum(event) {
    event.preventDefault();
    const name = elements.dialogAlbumInput.value;
    const result = await commitAlbumMutation((library) => albumStore.createAlbum(library, name, { id: makeAlbumId() }));
    if (!result?.ok) {
      elements.dialogError.textContent = albumErrorMessage(result);
      return;
    }
    state.dialogAlbumIds.add(result.album.id);
    state.pendingAlbumSelections.add(result.album.id);
    state.expandedAlbumIds.add(result.album.id);
    elements.dialogAlbumInput.value = "";
    renderSaveDialog();
    showToast(`Created “${result.album.name}”.`);
  }

  async function applySaveDialog() {
    const professor = state.pendingSaveProfessor;
    if (!professor) return;
    const visibleSelections = new Set([...state.pendingAlbumSelections].filter((id) => state.dialogAlbumIds.has(id)));
    const currentlySaved = albumIdsForProfessor(professor).some((id) => state.dialogAlbumIds.has(id));
    if (!visibleSelections.size && !currentlySaved) {
      elements.dialogError.textContent = "Choose at least one album, or create a new one.";
      return;
    }

    const result = await commitAlbumMutation((library) => {
      let nextLibrary = library;
      let changed = false;
      const currentAlbumIds = new Set(library.albums.map((album) => album.id));
      const activeSelections = new Set([...visibleSelections].filter((id) => currentAlbumIds.has(id)));
      for (const album of library.albums) {
        if (!state.dialogAlbumIds.has(album.id)) continue;
        const currentAlbum = nextLibrary.albums.find((item) => item.id === album.id);
        const existing = findEquivalentProfessor(currentAlbum, professor);
        const shouldSave = activeSelections.has(album.id);
        if (!shouldSave && existing) {
          const removed = albumStore.removeProfessor(nextLibrary, album.id, existing.key);
          if (!removed.ok) return removed;
          nextLibrary = removed.library;
          changed = changed || removed.changed;
          continue;
        }
        if (shouldSave) {
          let snapshot = professor;
          if (existing && existing.key !== albumStore.professorKey(professor)) {
            const removed = albumStore.removeProfessor(nextLibrary, album.id, existing.key);
            if (!removed.ok) return removed;
            nextLibrary = removed.library;
            snapshot = mergedProfessorSnapshot(existing, professor);
            changed = true;
          }
          const saved = albumStore.saveProfessor(nextLibrary, album.id, snapshot);
          if (!saved.ok) return saved;
          nextLibrary = saved.library;
          changed = changed || saved.changed;
        }
      }
      return { ok: true, changed, library: nextLibrary, savedCount: activeSelections.size };
    });
    if (!result?.ok) {
      elements.dialogError.textContent = albumErrorMessage(result);
      return;
    }
    const savedCount = result.savedCount || 0;
    closeSaveDialog();
    showToast(savedCount ? `${professor.name} saved to ${savedCount} album${savedCount === 1 ? "" : "s"}.` : `${professor.name} removed from albums.`);
  }

  function closeSaveDialog() {
    if (elements.saveDialog.hidden) return;
    elements.saveDialog.hidden = true;
    const returnFocus = state.dialogReturnFocus;
    state.pendingSaveProfessor = null;
    state.pendingAlbumSelections = new Set();
    state.dialogAlbumIds = new Set();
    state.dialogReturnFocus = null;
    elements.dialogAlbumInput.value = "";
    elements.dialogError.textContent = "";
    if (returnFocus?.isConnected) window.requestAnimationFrame(() => returnFocus.focus());
  }

  function handlePanelKeydown(event) {
    if (elements.saveDialog.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSaveDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...elements.saveDialog.querySelectorAll('button, input, a[href], select, textarea')].filter((item) => !item.disabled && !item.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && shadow.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function setLoading(heading, sourceLabel = "Live PolyRatings data") {
    elements.heading.textContent = heading;
    elements.freshness.textContent = sourceLabel;
    elements.results.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  }

  async function scanPage(forceRefresh = false) {
    const context = mergePageContexts(extractPageContext(), state.frameContext);
    state.pageCandidates = context.candidates;
    const fingerprint = JSON.stringify([context.candidates, context.courseCodes]);
    if (!forceRefresh && fingerprint === state.lastFingerprint) return;
    state.lastFingerprint = fingerprint;
    elements.input.value = "";
    const scanNumber = ++state.scanNumber;
    const frameNote = context.frameCount > 1 ? ` across ${context.frameCount} page frames` : "";
    setStatus("Scanning this page", `${context.candidates.length} possible instructor name${context.candidates.length === 1 ? "" : "s"} found${frameNote}`, "loading");
    setLoading("Checking live reviews…");

    try {
      const response = await sendMessage({ type: "PI_LOOKUP_PAGE", candidates: context.candidates, courseCodes: context.courseCodes, forceRefresh });
      if (state.destroyed || scanNumber !== state.scanNumber) return;
      if (!response?.ok) throw new Error(response?.error || "The review lookup failed");
      state.professors = response.professors || [];
      renderProfessors(state.professors, "page", context.candidates.length);
      elements.freshness.textContent = formatFreshness(response.fetchedAt, response.stale);
      applyPageHighlights(state.professors);
      const sourceNote = response.stale ? "cached data; network unavailable" : response.source || "PolyRatings";
      if (state.professors.length) setStatus("Course page connected", `${state.professors.length} professor${state.professors.length === 1 ? "" : "s"} matched · ${sourceNote}`);
      else if (context.candidates.length) setStatus("No review match found", "Try the search box if the portal abbreviates the name.");
      else if (state.portalAccessMissing) setStatus("Embedded results need access", "Allow access to cmsweb.pscs.calpoly.edu, then refresh this page.", "error");
      else setStatus("No professor names found", "Open or expand course results, then press refresh.");
    } catch (error) {
      if (state.destroyed || scanNumber !== state.scanNumber) return;
      state.professors = [];
      clearPageHighlights();
      setStatus("Could not load reviews", error.message, "error");
      renderError(error.message);
    }
  }

  async function searchProfessor(query) {
    if (rmpSchoolReady) await rmpSchoolReady.catch(() => {});
    const context = mergePageContexts(extractPageContext(), state.frameContext);
    if (!state.manualCandidates.some((name) => normalizeText(name) === normalizeText(query))) state.manualCandidates.unshift(query);
    state.manualCandidates = state.manualCandidates.slice(0, 10);
    state.lastSearchQuery = query;
    state.rmpLookup = { status: state.rmpSchool ? "loading" : "needs-school", result: null, error: "" };
    const scanNumber = ++state.scanNumber;
    const checkingRmp = Boolean(state.rmpSchool);
    setStatus("Searching review sources", checkingRmp ? `${query} · PolyRatings and Rate My Professors` : `${query} · choose a school above to include RMP`, "loading");
    setLoading("Searching professors…", checkingRmp ? "PolyRatings + RMP" : "PolyRatings · RMP needs a school");

    const polyRatingsRequest = sendMessage({ type: "PI_SEARCH", query, courseCodes: context.courseCodes });
    const rmpRequest = checkingRmp
      ? sendMessage({ type: "PI_LOOKUP_RMP_PROFESSOR", professor: { name: query }, school: state.rmpSchool })
      : Promise.resolve(null);
    const [polyRatingsSettled, rmpSettled] = await Promise.allSettled([polyRatingsRequest, rmpRequest]);
    if (state.destroyed || scanNumber !== state.scanNumber) return;

    const polyRatingsResponse = polyRatingsSettled.status === "fulfilled" ? polyRatingsSettled.value : null;
    const polyRatingsError = polyRatingsSettled.status === "rejected"
      ? polyRatingsSettled.reason?.message || "PolyRatings could not be reached"
      : polyRatingsResponse?.ok ? "" : polyRatingsResponse?.error || "PolyRatings could not be reached";
    state.professors = polyRatingsResponse?.ok ? polyRatingsResponse.professors || [] : [];

    let rmpError = "";
    if (checkingRmp) {
      const rmpResponse = rmpSettled.status === "fulfilled" ? rmpSettled.value : null;
      rmpError = rmpSettled.status === "rejected"
        ? rmpSettled.reason?.message || "Rate My Professors could not be reached"
        : rmpResponse?.ok ? "" : rmpResponse?.error || "Rate My Professors could not be reached";
      state.rmpLookup = rmpError
        ? { status: "error", result: null, error: rmpError }
        : { status: rmpResponse.match || "not-found", result: rmpResponse, error: "" };
    }

    renderSearchResults(query);
    clearPageHighlights();
    elements.freshness.textContent = checkingRmp ? "PolyRatings + RMP" : "RMP needs a school";

    const rmpFound = state.rmpLookup.status === "exact";
    const sourceResults = Number(state.professors.length > 0) + Number(rmpFound);
    const details = [];
    if (state.professors.length) details.push(`${state.professors.length} PolyRatings profile${state.professors.length === 1 ? "" : "s"}`);
    else details.push(polyRatingsError ? "PolyRatings unavailable" : "no PolyRatings profile");
    if (rmpFound) details.push(`RMP profile at ${state.rmpSchool.name}`);
    else if (!checkingRmp) details.push("choose a school to check RMP");
    else if (rmpError) details.push("RMP unavailable");
    else details.push("no exact RMP profile");
    setStatus(sourceResults ? "Review search complete" : "No exact review profile found", details.join(" · "), polyRatingsError && rmpError ? "error" : "ready");
    if (!shadow.querySelector('[data-view="quick-rate"]').hidden) renderQuickRateList();
  }

  function renderSearchResults(query) {
    elements.heading.textContent = `Results for “${query}”`;
    const rmpMarkup = rmpResultMarkup(query);
    const polyRatingsMarkup = state.professors.map(cardMarkup).join("");
    elements.results.innerHTML = `${rmpMarkup}${polyRatingsMarkup}`;
    bindProfessorCards();
    elements.results.querySelector("[data-focus-school]")?.addEventListener("click", () => {
      elements.schoolSearchInput.focus();
      elements.schoolSearchInput.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    elements.results.querySelector("[data-save-rmp]")?.addEventListener("click", (event) => {
      const result = state.rmpLookup.result;
      if (result?.match === "exact") openSaveDialog(professorSnapshotFromRmp(result), event.currentTarget);
    });
  }

  function rmpResultMarkup(query) {
    const lookup = state.rmpLookup;
    if (lookup.status === "needs-school" || !state.rmpSchool) {
      return `<div class="rmp-source-state" aria-live="polite"><span class="source-label">Rate My Professors</span><strong>Choose a school to check RMP</strong><span>Select the exact campus above, then this search will run again automatically.</span><button class="rmp-action" type="button" data-focus-school>Choose school</button></div>`;
    }
    if (lookup.status === "loading") {
      return `<div class="rmp-source-state" aria-live="polite"><span class="source-label">Rate My Professors</span><strong>Checking ${escapeHtml(state.rmpSchool.name)}…</strong><span>Looking for one exact professor profile.</span></div>`;
    }

    const result = lookup.result;
    if (lookup.status === "exact" && result?.profileUrl) {
      const saved = isProfessorInAnyAlbum(professorSnapshotFromRmp(result));
      const rating = result.avgRating === null || result.avgRating === undefined ? "—" : Number(result.avgRating).toFixed(1);
      const ratings = result.numRatings === null || result.numRatings === undefined ? "Ratings unavailable" : `${Number(result.numRatings).toLocaleString()} rating${Number(result.numRatings) === 1 ? "" : "s"}`;
      const difficulty = result.avgDifficulty === null || result.avgDifficulty === undefined ? "—" : Number(result.avgDifficulty).toFixed(1);
      const again = result.wouldTakeAgainPercent === null || result.wouldTakeAgainPercent === undefined ? "—" : `${Math.round(Number(result.wouldTakeAgainPercent))}%`;
      return `<article class="rmp-result-card" aria-label="Rate My Professors result for ${escapeHtml(result.name)}">
        <div class="rmp-result-top">
          <div class="rmp-result-copy"><span class="source-label">Rate My Professors</span><h3>${escapeHtml(result.name)}</h3><p class="department">${escapeHtml(result.department || "Department not listed")}</p><p class="rmp-school-name">${escapeHtml(state.rmpSchool.name)}</p></div>
          <div class="rmp-rating"><strong>${rating}</strong><span>RMP / 5</span></div>
        </div>
        <div class="stats"><span class="review-count">▱ ${escapeHtml(ratings)}</span><i></i><span>Difficulty ${difficulty}</span><i></i><span>${again} would take again</span></div>
        <div class="rmp-actions"><a class="rmp-action secondary" href="${escapeHtml(result.profileUrl)}" target="_blank" rel="noopener noreferrer" aria-label="View ${escapeHtml(result.name)} on Rate My Professors; opens in a new tab">View profile ↗</a><a class="rmp-action" href="${escapeHtml(result.ratingUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Rate ${escapeHtml(result.name)} on Rate My Professors; opens in a new tab">Quick rate ↗</a><button class="save-professor" type="button" data-save-rmp aria-label="Save ${escapeHtml(result.name)} to albums" aria-pressed="${saved}">${icon("saved")}<span>${saved ? "Saved" : "Save"}</span></button></div>
      </article>`;
    }

    const searchUrl = result?.searchUrl || quickRate?.buildRmpSearchUrl({ name: query }, state.rmpSchool) || "";
    const title = lookup.status === "ambiguous" ? "Multiple matching RMP profiles" : lookup.status === "error" ? "RMP is temporarily unavailable" : "No exact RMP profile match";
    const detail = lookup.status === "ambiguous"
      ? `Choose the correct ${state.rmpSchool.name} profile on RMP.`
      : lookup.status === "error" ? lookup.error : `No unique “${query}” profile was found at ${state.rmpSchool.name}.`;
    return `<div class="rmp-source-state" aria-live="polite"><span class="source-label">Rate My Professors</span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>${searchUrl ? `<a class="rmp-action secondary" href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer">Search RMP manually ↗</a>` : ""}</div>`;
  }

  function renderProfessors(professors, mode, candidateCount) {
    const count = professors.length;
    elements.heading.textContent = mode === "search" ? `${count} search result${count === 1 ? "" : "s"}` : `${count} professor${count === 1 ? "" : "s"} on this page`;
    if (!count) {
      const title = candidateCount ? "No matching PolyRatings profile" : "Nothing detected yet";
      const detail = mode === "search"
        ? "The name was still added to Quick Rate. Choose the professor there to check your selected RMP school."
        : candidateCount ? "The detected name is still available in Quick Rate." : "Expand the class results so instructor names are visible, or search manually.";
      elements.results.innerHTML = `<div class="results-empty"><strong>${title}</strong><span>${detail}</span></div>`;
      if (!shadow.querySelector('[data-view="quick-rate"]').hidden) renderQuickRateList();
      return;
    }
    elements.results.innerHTML = professors.map(cardMarkup).join("");
    bindProfessorCards();
    if (!shadow.querySelector('[data-view="quick-rate"]').hidden) renderQuickRateList();
  }

  function bindProfessorCards() {
    elements.results.querySelectorAll("[data-professor-card]").forEach((card) => {
      const toggle = () => toggleProfessorCard(card);
      card.addEventListener("click", (event) => { if (!event.target.closest("a, button, input, select, textarea")) toggle(); });
      card.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.target.closest("a, button, input, select, textarea")) {
          event.preventDefault();
          toggle();
        }
      });
    });
    elements.results.querySelectorAll("[data-save-poly-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const professor = state.professors.find((item) => String(item.id) === String(button.dataset.savePolyId));
        if (professor) openSaveDialog(professorSnapshotFromPoly(professor), button);
      });
    });
  }

  function cardMarkup(professor) {
    const rating = formatMetric(professor.rating);
    const tags = (professor.tags?.length ? professor.tags : ["Community rated"]).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    const saved = isProfessorInAnyAlbum(professorSnapshotFromPoly(professor));
    return `
      <article class="professor-card" tabindex="0" data-professor-card data-professor-id="${escapeHtml(professor.id)}">
        <div class="professor-copy">
          <span class="source-label">PolyRatings</span><h3>${escapeHtml(professor.name)}</h3><p class="department">${escapeHtml(professor.department)}</p><p class="course">${escapeHtml(professor.course)}</p>
          <div class="stats"><span class="review-count">▱ ${Number(professor.reviews || 0).toLocaleString()} reviews</span><i></i><span>Student support ${formatMetric(professor.studentSupport)}</span><i></i><span>Clarity ${formatMetric(professor.clarity)}</span></div>
          <div class="tags">${tags}</div>
          <div class="poly-save-row"><button class="save-professor" type="button" data-save-poly-id="${escapeHtml(professor.id)}" aria-label="Save ${escapeHtml(professor.name)} to albums" aria-pressed="${saved}">${icon("saved")}<span>${saved ? "Saved" : "Save"}</span></button></div>
          <div class="source-breakdown" aria-hidden="true">
            <a class="source-link" href="${escapeHtml(professor.links.polyratings)}" target="_blank" rel="noopener noreferrer"><span>PolyRatings</span><strong>Live profile ↗</strong></a>
            ${state.rmpSchool ? `<a class="source-link" href="${escapeHtml(quickRate.buildRmpSearchUrl(professor, state.rmpSchool))}" target="_blank" rel="noopener noreferrer"><span>Rate My Professors</span><strong>Open school search ↗</strong></a>` : ""}
            ${isCalPolyPortal() ? `<a class="source-link" href="${escapeHtml(professor.links.reddit)}" target="_blank" rel="noopener noreferrer"><span>Reddit r/CalPoly</span><strong>Open search ↗</strong></a>` : ""}
            <div class="review-preview" data-review-preview><span>Open this card to load recent PolyRatings comments.</span></div>
          </div>
        </div>
        <div class="rating"><strong>${rating}</strong><span>PolyRatings / 4</span></div>
      </article>`;
  }

  async function toggleProfessorCard(card) {
    const breakdown = card.querySelector(".source-breakdown");
    const isOpen = breakdown.classList.toggle("open");
    breakdown.setAttribute("aria-hidden", String(!isOpen));
    if (!isOpen || card.dataset.detailsLoaded) return;
    card.dataset.detailsLoaded = "loading";
    const preview = card.querySelector("[data-review-preview]");
    preview.classList.add("loading");
    preview.textContent = "Loading recent comments…";
    try {
      const response = await sendMessage({ type: "PI_DETAILS", id: card.dataset.professorId });
      if (!response?.ok) throw new Error(response?.error || "Comments are unavailable");
      renderReviewPreview(preview, response.reviews || []);
      card.dataset.detailsLoaded = "true";
    } catch (error) {
      preview.textContent = `Could not load comments: ${error.message}`;
      card.dataset.detailsLoaded = "";
    } finally {
      preview.classList.remove("loading");
    }
  }

  function renderReviewPreview(container, reviews) {
    container.replaceChildren();
    if (!reviews.length) return void (container.textContent = "No written PolyRatings comments are available.");
    const review = reviews[0];
    const heading = document.createElement("strong");
    heading.textContent = `${review.course}${review.rating === null ? "" : ` · ${formatMetric(review.rating)}/4`}`;
    const time = document.createElement("time");
    time.textContent = review.date ? new Date(review.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Date unavailable";
    const copy = document.createElement("span");
    copy.textContent = review.text;
    container.append(heading, time, copy);
  }

  function renderError(message) {
    elements.heading.textContent = "Review data unavailable";
    elements.freshness.textContent = "Check your connection";
    elements.results.innerHTML = `<div class="results-empty"><strong>Could not reach PolyRatings</strong><span>${escapeHtml(message)}</span></div>`;
  }

  function extractPageContext() {
    const candidates = new Set();
    const bodyText = document.body?.innerText || "";
    const selectors = [
      '[id*="MTG_INSTR" i]', '[id*="INSTRUCTOR" i]', '[id*="INSTR_LONG" i]',
      '[name*="MTG_INSTR" i]', '[name*="INSTRUCTOR" i]', '[data-label*="instructor" i]',
      '[data-field*="instructor" i]', '[data-testid*="instructor" i]', '[aria-label*="instructor" i]',
      '[title*="instructor" i]', '[header*="instructor" i]', '[headers*="instructor" i]',
      '[class*="instructor" i]', '[class*="faculty-name" i]'
    ];
    try {
      document.querySelectorAll(selectors.join(",")).forEach((element) => {
        addCandidate(candidates, element.innerText || element.textContent);
        ["aria-label", "data-label", "title", "value"].forEach((attribute) => {
          const attributeValue = element.getAttribute?.(attribute);
          if (attributeValue && /(?:instructor|professor|faculty|teacher)/i.test(attributeValue)) addCandidate(candidates, attributeValue);
        });
      });
    } catch (_error) { /* text fallback below */ }
    const lines = bodyText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    let nextLineMayBeName = false;
    for (const line of lines) {
      if (/^(?:instructor(?:\(s\)|s)?|professor(?:s)?|faculty|teacher)\s*:?$/i.test(line)) { nextLineMayBeName = true; continue; }
      if (nextLineMayBeName) { addCandidate(candidates, line); nextLineMayBeName = false; }
      const prefixed = line.match(/\b(?:professor|prof\.?|instructor(?:\(s\)|s)?|faculty|teacher)\s*:?\s+([^|·•–—]{3,100})/i);
      if (prefixed) addCandidate(candidates, prefixed[1]);
    }
    const courseCodes = [...new Set([...bodyText.matchAll(/\b([A-Z]{2,5})\s*-?\s*(\d{3,4}[A-Z]?)\b/g)].map((match) => `${match[1]} ${match[2]}`))].slice(0, 50);
    return { candidates: [...candidates].slice(0, 100), courseCodes };
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
    value = value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    value = value.replace(/\b(?:M|T|W|Th|F|Sa|Su)(?:\s*\/\s*(?:M|T|W|Th|F|Sa|Su))+\b.*$/i, "").trim();
    if (value.length < 3 || value.length > 80 || /\d|@|\b(?:staff|tba|arranged|none)\b/i.test(value)) return;
    const words = value.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6) return;
    collection.add(value);
  }

  function normalizePageContext(context) {
    return {
      candidates: Array.isArray(context?.candidates) ? context.candidates.map(String).filter(Boolean).slice(0, 200) : [],
      courseCodes: Array.isArray(context?.courseCodes) ? context.courseCodes.map(String).filter(Boolean).slice(0, 75) : [],
      frameCount: Number.isFinite(Number(context?.frameCount)) ? Number(context.frameCount) : 0
    };
  }

  function mergePageContexts(...contexts) {
    const candidates = new Set();
    const courseCodes = new Set();
    let frameCount = 0;
    contexts.forEach((rawContext) => {
      const context = normalizePageContext(rawContext);
      context.candidates.forEach((candidate) => candidates.add(candidate));
      context.courseCodes.forEach((course) => courseCodes.add(course));
      frameCount = Math.max(frameCount, context.frameCount);
    });
    return { candidates: [...candidates].slice(0, 200), courseCodes: [...courseCodes].slice(0, 75), frameCount };
  }

  function handleRuntimeMessage(message) {
    if (message?.type === "PI_PORTAL_ACCESS_MISSING") {
      state.portalAccessMissing = true;
      if (!state.professors.length) setStatus("Embedded results need access", "Allow access to cmsweb.pscs.calpoly.edu, then refresh this page.", "error");
      return;
    }
    if (message?.type === "PI_PAGE_CONTEXT_UPDATED") {
      state.frameContext = normalizePageContext(message.context);
      if (state.frameContext.frameCount > 1) state.portalAccessMissing = false;
      scheduleScan();
    }
  }

  function applyPageHighlights(professors) {
    clearPageHighlights();
    if (!professors.length || !document.body) return;
    const normalizedProfessors = professors.map((professor) => ({ ...professor, normalized: normalizeText(professor.name), reverse: normalizeText(professor.name).split(" ").reverse().join(" ") }));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let inspected = 0;
    while ((node = walker.nextNode()) && inspected < 20000) {
      inspected += 1;
      const text = node.nodeValue?.replace(/\s+/g, " ").trim();
      const parent = node.parentElement;
      if (!text || text.length > 120 || !parent || ["SCRIPT", "STYLE", "TEXTAREA", "INPUT"].includes(parent.tagName)) continue;
      const normalizedText = normalizeText(text);
      const paddedText = ` ${normalizedText} `;
      const match = normalizedProfessors.find((professor) => paddedText.includes(` ${professor.normalized} `) || paddedText.includes(` ${professor.reverse} `));
      if (!match) continue;
      parent.setAttribute(PAGE_RATING_ATTRIBUTE, `${formatMetric(match.rating)}/4`);
      parent.setAttribute(PAGE_ID_ATTRIBUTE, match.id);
    }
    ensurePageHighlightStyle();
  }

  function ensurePageHighlightStyle() {
    if (document.getElementById("professor-insights-page-style")) return;
    const style = document.createElement("style");
    style.id = "professor-insights-page-style";
    style.textContent = `
      [${PAGE_RATING_ATTRIBUTE}] { background: #dff1ed !important; box-shadow: inset 0 -2px 0 #45827c !important; border-radius: 3px; cursor: pointer !important; }
      [${PAGE_RATING_ATTRIBUTE}]::after { content: "  " attr(${PAGE_RATING_ATTRIBUTE}); display: inline-block; margin-left: 5px; padding: 1px 5px; color: #fff; background: #45827c; border-radius: 999px; font: 600 10px/1.5 ui-sans-serif, system-ui, sans-serif; vertical-align: middle; }
    `;
    document.head?.appendChild(style);
  }

  function clearPageHighlights() {
    document.querySelectorAll(`[${PAGE_RATING_ATTRIBUTE}]`).forEach((element) => { element.removeAttribute(PAGE_RATING_ATTRIBUTE); element.removeAttribute(PAGE_ID_ATTRIBUTE); });
    document.getElementById("professor-insights-page-style")?.remove();
  }

  function handleHighlightedProfessorClick(event) {
    const match = event.target.closest?.(`[${PAGE_ID_ATTRIBUTE}]`);
    if (!match) return;
    const card = shadow.querySelector(`[data-professor-id="${cssEscape(match.getAttribute(PAGE_ID_ATTRIBUTE))}"]`);
    if (!card) return;
    activateView("detected");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("flash");
    window.requestAnimationFrame(() => card.classList.add("flash"));
  }

  function scheduleScan() {
    window.clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(() => scanPage(false), 900);
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
    if (removedFrame) sendMessage({ type: "PI_REINJECT_DETECTORS" }).catch(() => {});
  }

  function handleEmbeddedFrameLoad() {
    sendMessage({ type: "PI_REINJECT_DETECTORS" }).catch(() => {});
  }

  function handlePageMutation() {
    watchEmbeddedFrames();
    scheduleScan();
  }

  function formatMetric(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(1) : "—";
  }

  function formatFreshness(value, stale) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return stale ? "Cached data" : "Live PolyRatings data";
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    const age = minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
    return `${stale ? "Cached" : "Synced"} ${age}`;
  }

  function normalizeText(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(String(value || ""));
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function sendMessage(message) {
    if (globalThis.chrome?.runtime?.id) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
      });
    }
    return Promise.resolve(previewResponse(message));
  }

  function previewResponse(message) {
    const previewData = Array.isArray(window.__PROFESSOR_INSIGHTS_PREVIEW_DATA__) ? window.__PROFESSOR_INSIGHTS_PREVIEW_DATA__ : [];
    const previewSchools = Array.isArray(window.__PROFESSOR_INSIGHTS_PREVIEW_SCHOOLS__) ? window.__PROFESSOR_INSIGHTS_PREVIEW_SCHOOLS__ : [];
    if (["PI_GET_PAGE_CONTEXT", "PI_RESCAN_PAGE"].includes(message.type)) {
      return { ok: true, context: { ...(window.__PROFESSOR_INSIGHTS_FRAME_CONTEXT__ || extractPageContext()), frameCount: 1 } };
    }
    if (message.type === "PI_PANEL_CLOSED") return { ok: true };
    if (message.type === "PI_DETAILS") return { ok: true, reviews: [{ course: "Preview course", text: "This is sample review text used only by preview.html.", date: new Date().toISOString(), rating: 3.5 }] };
    if (message.type === "PI_SEARCH_RMP_SCHOOLS") {
      const query = normalizeText(message.query);
      return { ok: true, schools: previewSchools.filter((school) => normalizeText(`${school.name} ${school.city} ${school.state}`).includes(query)) };
    }
    if (message.type === "PI_LOOKUP_RMP_PROFESSOR") {
      const wantedName = normalizeText(quickRate?.professorName(message.professor));
      const professor = previewData.find((item) => normalizeText(item.name) === wantedName);
      const searchUrl = quickRate?.buildRmpSearchUrl(message.professor, message.school) || "";
      if (!professor?.rmpLegacyId) return { ok: true, match: "not-found", reason: "no-match", searchUrl };
      return {
        ok: true,
        match: "exact",
        legacyId: String(professor.rmpLegacyId),
        name: professor.name,
        department: professor.department,
        avgRating: professor.rmpRating ?? 4.2,
        avgDifficulty: professor.rmpDifficulty ?? 3.1,
        numRatings: professor.rmpRatings ?? 42,
        wouldTakeAgainPercent: professor.rmpWouldTakeAgain ?? 82,
        school: message.school,
        profileUrl: quickRate?.buildRmpProfileUrl(professor.rmpLegacyId),
        ratingUrl: quickRate?.buildRmpRatingUrl(professor.rmpLegacyId),
        searchUrl
      };
    }
    if (message.type === "PI_OPEN_RMP_RATING") {
      const professor = previewData.find((item) => String(item.id) === String(message.professor?.id)) || message.professor;
      const ratingUrl = String(message.school?.id) === "153" ? quickRate?.buildRmpRatingUrl(professor?.rmpLegacyId) : "";
      if (!ratingUrl) return { ok: true, match: "not-found", opened: false };
      const opened = window.open(ratingUrl, "_blank", "noopener,noreferrer");
      return { ok: true, match: "exact", opened: Boolean(opened), ratingUrl };
    }
    const wanted = normalizeText(message.query || (message.candidates || []).join(" "));
    const matches = previewData.filter((professor) => {
      const name = normalizeText(professor.name);
      return !wanted || wanted.includes(name) || name.split(" ").every((token) => wanted.includes(token));
    });
    return { ok: true, professors: matches, fetchedAt: Date.now(), source: "visual preview", stale: false };
  }

  document.addEventListener("click", handleHighlightedProfessorClick, true);
  globalThis.chrome?.runtime?.onMessage?.addListener(handleRuntimeMessage);
  globalThis.chrome?.storage?.onChanged?.addListener(handleAlbumsStorageChanged);
  rmpSchoolReady = loadRmpSchool();
  albumsReady = loadAlbums();
  state.observer = new MutationObserver(handlePageMutation);
  if (document.body) state.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  watchEmbeddedFrames();
  scanPage(false);
  if (!globalThis.chrome?.runtime?.id) {
    const previewView = new URLSearchParams(window.location.search).get("view");
    if (["quick-rate", "saved"].includes(previewView)) activateView(previewView);
  }
  sendMessage({ type: "PI_GET_PAGE_CONTEXT" })
    .then((response) => {
      if (!state.destroyed && response?.context) {
        state.frameContext = normalizePageContext(response.context);
        scheduleScan();
      }
    })
    .catch(() => {});
})();
