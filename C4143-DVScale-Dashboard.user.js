// ==UserScript==
// @name         C4143 DV-SIT Test Status Dashboard
// @namespace    local.ado.dvscale.dashboard
// @version      1.10.2
// @description  Adds a multi-project Query selector, real Test Results, XLSX exports, query-scoped snapshots, and Extension support.
// @homepageURL  https://github.com/brianlin-19780816/azure-devops-state-monitoring
// @supportURL   https://github.com/brianlin-19780816/azure-devops-state-monitoring/issues
// @updateURL    https://raw.githubusercontent.com/brianlin-19780816/azure-devops-state-monitoring/main/C4143-DVScale-Dashboard.user.js
// @downloadURL  https://raw.githubusercontent.com/brianlin-19780816/azure-devops-state-monitoring/main/C4143-DVScale-Dashboard.user.js
// @match        https://azurecsi.visualstudio.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* ------------------------------------------------------------------
 How to use
  1) Install Tampermonkey, import this file, then open (bookmark it; #dvdash is optional):
     https://azurecsi.visualstudio.com/_apis/projects?api-version=6.0#dvdash
    Every open or F5 refresh re-runs the query and redraws the dashboard.

 2) Data source modes (dropdown at the top left; your choice is saved in localStorage):
    a. Live query (default): reads through the same-origin REST API with your existing browser session. Always current.
    b. Offline snapshot: no network. Reads the snapshot saved automatically after the last successful load (localStorage),
       or the data embedded in a file produced by "Export offline snapshot .html".
    c. Local proxy: sends API requests to a custom URL (default http://localhost:8080),
       useful when the dashboard is hosted on another domain or opened as a local file (the Azure DevOps API does not allow CORS).

 3) Local proxy example (Node.js 18+; save as proxy.js, set the ADO_PAT environment variable, then run node proxy.js):
    const http = require("http");
    const ORG = "https://azurecsi.visualstudio.com";
    const PAT = process.env.ADO_PAT || "";
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
                   "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
    http.createServer((req, res) => {
      if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
      let body = ""; req.on("data", c => body += c);
      req.on("end", async () => {
        try {
          const r = await fetch(ORG + req.url, {
            method: req.method,
            headers: { "Content-Type": "application/json",
                       Authorization: "Basic " + Buffer.from(":" + PAT).toString("base64") },
            body: req.method === "POST" ? body : undefined });
          const text = await r.text();
          res.writeHead(r.status, Object.assign({ "Content-Type": "application/json" }, cors));
          res.end(text);
        } catch (e) { res.writeHead(500, cors); res.end(JSON.stringify({ error: String(e) })); }
      });
    }).listen(8080, () => console.log("proxy on http://localhost:8080"));
    Note: create the PAT yourself in Azure DevOps (Scope: Work Items -> Read). Never store it inside this file.

 This script only reads (GET/POST wiql, workitemsbatch) and displays the result. It never modifies any work item.
------------------------------------------------------------------ */
(function () {
  "use strict";
  var extensionContext = window.__C4143_EXTENSION__ || null;
  var isDashboardEntry = !!extensionContext || location.hash.indexOf("dvdash") >= 0 ||
    /^\/_apis\/projects\/?$/i.test(location.pathname);
  if (!isDashboardEntry) return;
  var D = {};
  D.CFG = {"org":"https://azurecsi.visualstudio.com","orgName":"azurecsi","project":"Dev","sourceType":"testPlan","planId":3823389,"suiteId":3823390,"queryId":"","queryUrl":"https://azurecsi.visualstudio.com/Dev/_testPlans/charts?planId=3823389&suiteId=3823390","testResultDays":28};
  if (extensionContext) {
    D.CFG.org = String(extensionContext.org || D.CFG.org).replace(/\/+$/, '');
    D.CFG.orgName = extensionContext.orgName || D.CFG.orgName;
    D.CFG.project = extensionContext.project || D.CFG.project;
    D.CFG.queryUrl = D.CFG.orgName === 'azurecsi' && D.CFG.project === 'Dev'
      ? 'https://azurecsi.visualstudio.com/Dev/_testPlans/charts?planId=3823389&suiteId=3823390'
      : D.CFG.org + '/' + encodeURIComponent(D.CFG.project) + '/_queries/query/' + D.CFG.queryId + '/';
  }
  D.DEFAULT_QUERIES = [
    { name: 'C4143_DV-SIT', org: 'https://azurecsi.visualstudio.com', orgName: 'azurecsi', project: 'Dev', sourceType: 'testPlan', planId: 3823389, suiteId: 3823390, queryId: '', queryUrl: 'https://azurecsi.visualstudio.com/Dev/_testPlans/charts?planId=3823389&suiteId=3823390', builtin: true },
    { name: '[EchoFalls][C4142][PSE] EVT - Scale Testing', org: 'https://azurecsi.visualstudio.com', orgName: 'azurecsi', project: 'Dev', queryId: '6e06c765-2ff5-43c4-80c6-e78438eea6d9', queryUrl: 'https://azurecsi.visualstudio.com/Dev/_queries/query/6e06c765-2ff5-43c4-80c6-e78438eea6d9/', builtin: true }
  ];
  D.STATE_COLORS = {"Not Started":"#94a3b8","New":"#60a5fa","Proposed":"#f5b544","Design":"#a78bfa","In Progress":"#818cf8","Active":"#818cf8","Ready":"#38bdf8","Committed":"#22d3ee","Passed":"#34d399","Closed":"#2dd4bf","Done":"#2dd4bf","Completed":"#2dd4bf","Failed":"#f87171","Blocked":"#fb7185","Removed":"#9ca3af","Resolved":"#22d3ee","Paused":"#fbbf24"};
  D.TYPE_COLORS = {"Epic":"#c084fc","Feature":"#38bdf8","System Requirement":"#fbbf24","Test Case":"#34d399","User Story":"#818cf8","Task":"#60a5fa","Bug":"#fb7185","Issue":"#fb923c"};
  D.STATE_ORDER = ["Not Started","New","Proposed","Design","Ready","Committed","Active","In Progress","Paused","Blocked","Failed","Passed","Resolved","Closed","Done","Completed","Removed"];
  D.RANGES = [["all","All time"],["1","Last 1 day"],["3","Last 3 days"],["7","Last 7 days"],["30","Last 30 days"],["60","Last 60 days"]];
  D.FIELD_SPECS = {
    priority: { fallback: 'Microsoft.VSTS.Common.Priority', aliases: ['Case Priority', 'Priority'] },
    severity: { fallback: 'Microsoft.VSTS.Common.Severity', aliases: ['Bug Severity', 'Severity'] },
    sampleSize: { aliases: ['Sample Size', 'Test Sample Size', 'Sample Count', 'Samples'] },
    numberOfCycles: { fallback: 'Custom.Number_of_cycles', aliases: ['Number_of_cycles', 'Number of cycles', 'Number of Cycles'] },
    testDuration: { aliases: ['Test Duration', 'Estimated Test Duration', 'Duration', 'Test Time'] },
    scriptType: { aliases: ['Script type', 'Script Type'] },
    crcSdk: { aliases: ['CRC SDK', 'CRC SDK Version'] },
    igsOwner: { aliases: ['IGS Owner'] },
    comments: { aliases: ['Comments', 'Comment'] }
  };
  D.S = {racks:[],loadedAt:null,range:"all",chartType:"pie",panels:[],active:0,mode:"live",queries:[],activeQueryKey:'',testResults:{status:"idle",runs:[]},snapshotComparison:null};
  D.el = function (t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  D.queryKey = function (query) {
    var source = query.sourceType === 'testPlan' ? ['testPlan', query.planId, query.suiteId].join(':') : ('query:' + query.queryId);
    return [query.orgName, query.project, source].join('|').toLowerCase();
  };
  D.activeQuery = function () {
    var key = D.S.activeQueryKey || D.queryKey(D.CFG);
    return (D.S.queries || []).filter(function (query) { return D.queryKey(query) === key; })[0] || Object.assign({ name: 'Azure DevOps Query' }, D.CFG);
  };
  D.parseQueryUrl = function (value, name) {
    var parsed;
    try { parsed = new URL(String(value || '').trim()); } catch (error) { throw new Error('Enter a valid Azure DevOps Query URL.'); }
    var host = parsed.hostname.toLowerCase(), parts = parsed.pathname.split('/').filter(Boolean), orgName = '', project = '', queryId = '', org = '';
    if (host === 'dev.azure.com') {
      if (parts.length < 5) throw new Error('The Query URL is missing its organization, project, or Query ID.');
      orgName = decodeURIComponent(parts[0]); project = decodeURIComponent(parts[1]);
      if (parts[2].toLowerCase() !== '_queries' || parts[3].toLowerCase() !== 'query') throw new Error('Use an Azure DevOps URL ending in /_queries/query/{Query ID}/.');
      queryId = parts[4]; org = 'https://dev.azure.com/' + encodeURIComponent(orgName);
    } else if (/\.visualstudio\.com$/i.test(host)) {
      if (parts.length < 4) throw new Error('The Query URL is missing its project or Query ID.');
      orgName = host.split('.')[0]; project = decodeURIComponent(parts[0]);
      if (parts[1].toLowerCase() !== '_queries' || parts[2].toLowerCase() !== 'query') throw new Error('Use an Azure DevOps URL ending in /_queries/query/{Query ID}/.');
      queryId = parts[3]; org = parsed.protocol + '//' + parsed.host;
    } else throw new Error('Only dev.azure.com or visualstudio.com Query URLs are supported.');
    if (!/^[0-9a-f-]{36}$/i.test(queryId)) throw new Error('The Azure DevOps Query ID is invalid.');
    return { name: String(name || '').trim() || (project + ' Query ' + queryId.slice(0, 8)), org: org.replace(/\/+$/, ''), orgName: orgName, project: project, queryId: queryId.toLowerCase(),
      queryUrl: org.replace(/\/+$/, '') + '/' + encodeURIComponent(project) + '/_queries/query/' + queryId.toLowerCase() + '/', builtin: false };
  };
  D.loadQueryCatalog = function () {
    var map = {}, list = [];
    D.DEFAULT_QUERIES.forEach(function (query) { map[D.queryKey(query)] = Object.assign({}, query); });
    try {
      var custom = JSON.parse(localStorage.getItem('dvdashQueries') || '[]');
      if (Array.isArray(custom)) custom.forEach(function (query) {
        if (query && query.orgName && query.project && query.queryId) map[D.queryKey(query)] = Object.assign({}, query, { builtin: false });
      });
    } catch (error) { }
    Object.keys(map).forEach(function (key) { list.push(map[key]); });
    D.S.queries = list;
    var fallback = D.queryKey(D.CFG), active = fallback;
    try { active = localStorage.getItem('dvdashActiveQuery') || fallback; } catch (error) { }
    if (!map[active]) active = fallback;
    if (!map[active]) active = D.queryKey(list[0]);
    D.applyQuery(map[active] || list[0], false);
  };
  D.saveQueryCatalog = function () {
    try { localStorage.setItem('dvdashQueries', JSON.stringify((D.S.queries || []).filter(function (query) { return !query.builtin; }))); } catch (error) { }
  };
  D.applyQuery = function (query, persist) {
    if (!query) return;
    ['org', 'orgName', 'project', 'sourceType', 'planId', 'suiteId', 'queryId', 'queryUrl'].forEach(function (key) { D.CFG[key] = query[key]; });
    D.S.activeQueryKey = D.queryKey(query);
    if (persist !== false) { try { localStorage.setItem('dvdashActiveQuery', D.S.activeQueryKey); } catch (error) { } }
  };
  D.snapshotStorageKey = function (base) { return base + ':' + encodeURIComponent(D.queryKey(D.CFG)); };
  D.safeFileName = function (value) { return String(value || 'Azure-DevOps-Query').replace(/[\\/:*?"<>|\[\]]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'Azure-DevOps-Query'; };
  D.reportPrefix = function () { return D.safeFileName(D.activeQuery().name); };
  D.svg = function (t, a) { var e = document.createElementNS('http://www.w3.org/2000/svg', t); for (var k in a) e.setAttribute(k, a[k]); return e; };
  D.colorFor = function (s) { return D.STATE_COLORS[s] || '#cbd5e1'; };
  D.orderStates = function (keys) {
    var known = D.STATE_ORDER.filter(function (s) { return keys.indexOf(s) >= 0; });
    return known.concat(keys.filter(function (s) { return D.STATE_ORDER.indexOf(s) < 0; }).sort());
  };
  D.chip = function (name, count) { var c = D.el('span', 'chip'); c.style.background = D.colorFor(name); c.textContent = count == null ? name : name + ' ' + count; return c; };
  D.typeColor = function (type) { return D.TYPE_COLORS[type] || '#94a3b8'; };
  D.rgba = function (hex, alpha) {
    var value = String(hex || '#94a3b8').replace('#', '');
    if (value.length === 3) value = value.split('').map(function (x) { return x + x; }).join('');
    var n = parseInt(value, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  };
  D.typeBadge = function (type) {
    var badge = D.el('span', 'type type-badge', type);
    var color = D.typeColor(type);
    badge.style.color = color;
    badge.style.borderColor = D.rgba(color, .55);
    badge.style.background = D.rgba(color, .12);
    return badge;
  };
  D.decorateBlock = function (el, type, state) {
    var typeColor = D.typeColor(type), stateColor = D.colorFor(state);
    el.style.borderLeft = '4px solid ' + typeColor;
    el.style.background = 'linear-gradient(90deg,' + D.rgba(typeColor, .12) + ' 0%,' + D.rgba(stateColor, .08) + ' 58%,rgba(15,26,46,.98) 100%)';
    el.setAttribute('data-work-item-type', type || 'Unknown');
    el.setAttribute('data-state', state || 'Unknown');
    return el;
  };
  D.wiUrl = function (id) { return D.CFG.org + '/' + encodeURIComponent(D.CFG.project) + '/_workitems/edit/' + id; };
  D.fmt = function (iso) { if (!iso) return '-'; var d = new Date(iso); function p(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  D.setStatus = function (html, kind) {
    var b = document.getElementById('banner'); if (!b) return;
    clearTimeout(D._statusFadeTimer); clearTimeout(D._statusHideTimer);
    kind = kind || 'info';
    b.className = 'banner ' + kind; b.innerHTML = html;
    b.classList.remove('hide', 'fading');
    if (kind !== 'err') {
      D._statusFadeTimer = setTimeout(function () { b.classList.add('fading'); }, 4500);
      D._statusHideTimer = setTimeout(function () { b.classList.add('hide'); }, 5200);
    }
  };
  D.apiFetch = async function (url, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    var init = { method: opts.method || 'GET', headers: headers };
    var pat = localStorage.getItem('adoDashPat');
    if (extensionContext && extensionContext.token) { init.credentials = 'omit'; headers['Authorization'] = 'Bearer ' + extensionContext.token; }
    else if (D.S.mode === 'proxy') { init.credentials = 'omit'; if (pat) headers['Authorization'] = 'Basic ' + btoa(':' + pat); }
    else { init.credentials = 'include'; }
    if (opts.body) init.body = opts.body;
    var res = await fetch(url, init);
    if (res.status === 401 || res.status === 203 || res.status === 302) throw new Error('AUTH');
    if (!res.ok) {
      var errorText = '';
      try { errorText = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 240); } catch (readError) { }
      throw new Error('HTTP ' + res.status + (errorText ? ': ' + errorText : ''));
    }
    if ((res.headers.get('content-type') || '').indexOf('json') < 0) throw new Error('AUTH');
    return res.json();
  };
  D.normalizeFieldName = function (value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  };
  D.displayFieldValue = function (value) {
    if (value == null || value === '') return '-';
    if (Array.isArray(value)) return value.map(D.displayFieldValue).join(', ');
    if (typeof value === 'object') value = value.displayName || value.name || value.uniqueName || value.mail || JSON.stringify(value);
    return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '-';
  };
  D.discoverMetricFields = async function (base) {
    var map = {}, specs = D.FIELD_SPECS;
    Object.keys(specs).forEach(function (key) { map[key] = specs[key].fallback || null; });
    D.S.metricFieldWarning = '';
    try {
      var response = await D.apiFetch(base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/wit/fields?api-version=6.0');
      var definitions = response.value || [];
      Object.keys(specs).forEach(function (key) {
        var aliases = specs[key].aliases.map(D.normalizeFieldName);
        var match = null;
        for (var i = 0; i < aliases.length && !match; i++) {
          match = definitions.filter(function (field) {
            return D.normalizeFieldName(field.name) === aliases[i] || D.normalizeFieldName(field.referenceName) === aliases[i];
          })[0] || null;
        }
        if (match && match.referenceName) map[key] = match.referenceName;
      });
      var missing = Object.keys(specs).filter(function (key) { return !map[key]; });
      if (missing.length) D.S.metricFieldWarning = 'Custom fields not found: ' + missing.join(', ');
    } catch (fieldError) {
      D.S.metricFieldWarning = 'Field discovery failed: ' + String((fieldError && fieldError.message) || fieldError);
    }
    return map;
  };
  D.fieldValue = function (fields, referenceName) {
    if (!referenceName || !fields || fields[referenceName] == null || fields[referenceName] === '') return null;
    return fields[referenceName];
  };
  D.runQuery = async function () {
    D.S.bugLinkWarning = '';
    var base = D.baseFor();
    var rels = [], ids = [], seen = {}, suiteGroups = null;
    if (D.CFG.sourceType === 'testPlan') {
      var suiteUrl = base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/testplan/Plans/' + encodeURIComponent(D.CFG.planId)
        + '/Suites/' + encodeURIComponent(D.CFG.suiteId) + '/TestCase?isRecursive=true&expand=false&api-version=7.1';
      var suiteResponse = await D.apiFetch(suiteUrl);
      var suiteCases = Array.isArray(suiteResponse) ? suiteResponse : (suiteResponse.value || []);
      suiteGroups = {};
      suiteCases.forEach(function (entry) {
        var testCase = entry.testCase || entry.workItem || entry;
        var id = +(testCase && testCase.id);
        if (!id) return;
        if (!seen[id]) { seen[id] = 1; ids.push(id); }
        var suite = entry.testSuite || entry.suite || {};
        var suiteKey = String(suite.id || D.CFG.suiteId);
        var group = suiteGroups[suiteKey] || (suiteGroups[suiteKey] = {
          id: suite.id || D.CFG.suiteId, name: suite.name || ('Test Suite ' + (suite.id || D.CFG.suiteId)), ids: [], seen: {}
        });
        if (!group.seen[id]) { group.seen[id] = 1; group.ids.push(id); }
      });
      if (!ids.length) throw new Error('The selected Test Plan suite contains no readable Test Cases.');
    } else {
      var wiql = await D.apiFetch(base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/wit/wiql/' + D.CFG.queryId + '?api-version=6.0&$top=5000');
      rels = wiql.workItemRelations || [];
      rels.forEach(function (r) { [r.source, r.target].forEach(function (x) { if (x && !seen[x.id]) { seen[x.id] = 1; ids.push(x.id); } }); });
      (wiql.workItems || []).forEach(function (w) { if (!seen[w.id]) { seen[w.id] = 1; ids.push(w.id); } });
    }
    var baseFields = ['System.Id', 'System.WorkItemType', 'System.Title', 'System.State', 'System.Tags', 'System.ChangedDate', 'System.CreatedDate', 'System.AssignedTo'];
    D.S.metricFields = await D.discoverMetricFields(base);
    var extraFields = Object.keys(D.S.metricFields).map(function (key) { return D.S.metricFields[key]; }).filter(Boolean);
    var fields = baseFields.concat(extraFields.filter(function (field, index, list) { return baseFields.indexOf(field) < 0 && list.indexOf(field) === index; }));
    async function fetchCore(requestFields) {
      var result = [];
      for (var i = 0; i < ids.length; i += 200) {
        var batch = await D.apiFetch(base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/wit/workitemsbatch?api-version=6.0',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids.slice(i, i + 200), fields: requestFields }) });
        result = result.concat(batch.value || []);
      }
      return result;
    }
    var items = [];
    try {
      items = await fetchCore(fields);
    } catch (metricFieldError) {
      if (fields.length === baseFields.length) throw metricFieldError;
      D.S.metricFieldWarning = 'Custom metric fields were skipped: ' + String((metricFieldError && metricFieldError.message) || metricFieldError);
      fields = baseFields;
      items = await fetchCore(fields);
    }
    var byId = {};
    items.forEach(function (it) { byId[it.id] = it.fields; });
    var linkedIdsOf = {}, linkedFetchIds = [], linkedSeen = {};
    try {
      var testCaseIds = items.filter(function (it) {
        return it.fields && it.fields['System.WorkItemType'] === 'Test Case';
      }).map(function (it) { return it.id; });
      for (var j = 0; j < testCaseIds.length; j += 200) {
        var relationBatch = await D.apiFetch(base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/wit/workitemsbatch?api-version=6.0',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: testCaseIds.slice(j, j + 200), '$expand': 'relations', errorPolicy: 'omit' }) });
        (relationBatch.value || []).forEach(function (it) {
          (it.relations || []).forEach(function (rel) {
            var m = /\/workItems\/(\d+)(?:\?|$)/i.exec(rel.url || '');
            if (!m) return;
            var linkedId = +m[1];
            if (linkedId === it.id) return;
            (linkedIdsOf[it.id] = linkedIdsOf[it.id] || []).push(linkedId);
            if (!byId[linkedId] && !linkedSeen[linkedId]) { linkedSeen[linkedId] = 1; linkedFetchIds.push(linkedId); }
          });
        });
      }
      for (var k = 0; k < linkedFetchIds.length; k += 200) {
        var linkedBatch = await D.apiFetch(base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/wit/workitemsbatch?api-version=6.0',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: linkedFetchIds.slice(k, k + 200), fields: fields, errorPolicy: 'omit' }) });
        (linkedBatch.value || []).forEach(function (it) { byId[it.id] = it.fields; });
      }
    } catch (bugLinkError) {
      linkedIdsOf = {};
      D.S.bugLinkWarning = String((bugLinkError && bugLinkError.message) || bugLinkError);
    }
    var childrenOf = {}, parentOf = {};
    rels.forEach(function (r) {
      if (r.source && r.target && (!r.rel || r.rel === 'System.LinkTypes.Hierarchy-Forward')) {
        (childrenOf[r.source.id] = childrenOf[r.source.id] || []).push(r.target.id);
        parentOf[r.target.id] = r.source.id;
      }
    });
    function build(id) {
      var f = byId[id] || {};
      return { id: id, type: f['System.WorkItemType'] || '?', title: f['System.Title'] || ('#' + id), state: f['System.State'] || '?',
        tags: f['System.Tags'] || '', changed: f['System.ChangedDate'] || null,
        assigned: (f['System.AssignedTo'] && f['System.AssignedTo'].displayName) || '',
        metrics: {
          priority: D.fieldValue(f, D.S.metricFields && D.S.metricFields.priority),
          sampleSize: D.fieldValue(f, D.S.metricFields && D.S.metricFields.sampleSize),
          numberOfCycles: D.fieldValue(f, D.S.metricFields && D.S.metricFields.numberOfCycles),
          testDuration: D.fieldValue(f, D.S.metricFields && D.S.metricFields.testDuration)
        },
        suiteFields: {
          scriptType: D.fieldValue(f, D.S.metricFields && D.S.metricFields.scriptType),
          crcSdk: D.fieldValue(f, D.S.metricFields && D.S.metricFields.crcSdk),
          igsOwner: D.fieldValue(f, D.S.metricFields && D.S.metricFields.igsOwner),
          comments: D.fieldValue(f, D.S.metricFields && D.S.metricFields.comments)
        },
        bugs: (linkedIdsOf[id] || []).filter(function (linkedId) {
          return byId[linkedId] && byId[linkedId]['System.WorkItemType'] === 'Bug';
        }).filter(function (linkedId, index, list) { return list.indexOf(linkedId) === index; }).map(function (linkedId) {
          var bug = byId[linkedId] || {};
          return {
            id: linkedId, title: bug['System.Title'] || ('Bug #' + linkedId), state: bug['System.State'] || '?',
            severity: D.fieldValue(bug, D.S.metricFields && D.S.metricFields.severity),
            priority: D.fieldValue(bug, D.S.metricFields && D.S.metricFields.priority)
          };
        }),
        children: (childrenOf[id] || []).map(build) };
    }
    var racks;
    if (suiteGroups) {
      racks = Object.keys(suiteGroups).map(function (key, index) {
        var group = suiteGroups[key];
        return {
          id: 'suite-' + group.id, type: 'Feature', title: group.name, state: '?', tags: '', changed: null, assigned: '',
          metrics: {}, suiteFields: {}, bugs: [], children: group.ids.map(build), num: index + 1, label: group.name
        };
      });
    } else {
      var rackIds = ids.filter(function (id) {
        var f = byId[id]; if (!f || f['System.WorkItemType'] !== 'Feature') return false;
        if (!/rack\s*#?\s*\d+/i.test(f['System.Title'] || '')) return false;
        var p = parentOf[id]; return !p || (byId[p] && byId[p]['System.WorkItemType'] === 'Epic');
      });
      racks = rackIds.map(build);
      racks.forEach(function (r) { var m = /rack\s*#?\s*(\d+)/i.exec(r.title); r.num = m ? +m[1] : 999; r.label = m ? 'Rack ' + m[1] : r.title; });
      racks.sort(function (a, b) { return a.num - b.num; });
    }
    return { racks: racks, count: ids.length };
  };
  D.allCases = function () {
    var cases = [];
    (D.S.racks || []).forEach(function (rack) { cases = cases.concat(D.collect(rack, 'Test Case')); });
    return cases;
  };
  D.mapLimit = async function (items, limit, worker) {
    var results = new Array(items.length), cursor = 0;
    async function run() {
      while (cursor < items.length) {
        var index = cursor++;
        results[index] = await worker(items[index], index);
      }
    }
    var workers = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) workers.push(run());
    await Promise.all(workers);
    return results;
  };
  D.isoDay = function (value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  };
  D.normalizedTitle = function (value) { return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase(); };
  D.testRunUrl = function (runId) {
    return D.CFG.org + '/' + encodeURIComponent(D.CFG.project) + '/_TestManagement/Runs?runId=' + encodeURIComponent(runId) + '&_a=runCharts';
  };
  D.fetchRunResults = async function (base, run) {
    var output = [], skip = 0;
    while (skip < 10000) {
      var response = await D.apiFetch(base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/test/Runs/' + run.id
        + '/results?detailsToInclude=Point&$skip=' + skip + '&$top=1000&api-version=7.1');
      var values = response.value || [];
      output = output.concat(values);
      if (values.length < 1000) break;
      skip += values.length;
    }
    return output;
  };
  D.loadTestResults = async function (base, cases) {
    var now = new Date(), windows = [];
    now.setUTCMilliseconds(0);
    for (var offset = 0; offset < D.CFG.testResultDays; offset += 7) {
      var max = new Date(now.getTime() - offset * 86400000);
      var min = new Date(now.getTime() - Math.min(offset + 7, D.CFG.testResultDays) * 86400000 + 1000);
      windows.push({ min: min.toISOString(), max: max.toISOString() });
    }
    var planMap = {}, planError = '';
    try {
      var planResponse = await D.apiFetch(base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/testplan/plans?filterActivePlans=false&api-version=7.1');
      (planResponse.value || []).forEach(function (plan) { planMap[String(plan.id)] = plan.name || ('Plan ' + plan.id); });
    } catch (planLoadError) { planError = String((planLoadError && planLoadError.message) || planLoadError); }
    var runResponses = await D.mapLimit(windows, 2, function (windowRange) {
      var url = base + '/' + encodeURIComponent(D.CFG.project) + '/_apis/test/runs?minLastUpdatedDate=' + encodeURIComponent(windowRange.min)
        + '&maxLastUpdatedDate=' + encodeURIComponent(windowRange.max) + '&$top=100&api-version=7.1';
      return D.apiFetch(url);
    });
    var runMap = {};
    runResponses.forEach(function (response) { (response.value || []).forEach(function (run) { runMap[run.id] = run; }); });
    var runs = Object.keys(runMap).map(function (id) { return runMap[id]; }).sort(function (a, b) {
      return String(b.completedDate || b.startedDate || '').localeCompare(String(a.completedDate || a.startedDate || ''));
    });
    var resultSets = await D.mapLimit(runs, 4, async function (run) {
      try { return await D.fetchRunResults(base, run); }
      catch (error) { run._resultError = String((error && error.message) || error); return []; }
    });
    var byId = {}, byTitle = {};
    cases.forEach(function (testCase) {
      byId[String(testCase.id)] = testCase;
      var key = D.normalizedTitle(testCase.title);
      (byTitle[key] = byTitle[key] || []).push(testCase);
      testCase.latestResult = null;
    });
    var matchedResults = 0;
    runs.forEach(function (run, runIndex) {
      run.resultCount = (resultSets[runIndex] || []).length;
      (resultSets[runIndex] || []).forEach(function (result) {
        var resultCaseId = result.testCase && result.testCase.id != null ? String(result.testCase.id) : '';
        var testCase = byId[resultCaseId] || null, method = testCase ? 'id' : '';
        if (!testCase) {
          var exactTitle = byTitle[D.normalizedTitle(result.testCaseTitle)] || [];
          if (exactTitle.length === 1) { testCase = exactTitle[0]; method = 'exact title'; }
        }
        if (!testCase) return;
        var completed = result.completedDate || result.dateCompleted || result.lastUpdatedDate || run.completedDate || run.startedDate || null;
        var mapped = {
          id: result.id, outcome: result.outcome || 'Unspecified', state: result.state || '', completedDate: completed,
          runId: run.id, runName: run.name || ('Run ' + run.id), runUrl: D.testRunUrl(run.id), matchMethod: method
        };
        if (!testCase.latestResult || String(mapped.completedDate || '') > String(testCase.latestResult.completedDate || '')) testCase.latestResult = mapped;
        matchedResults++;
      });
    });
    var summary = D.testResultSummary(cases);
    D.S.testResults = {
      status: 'ok', source: 'Azure DevOps Test Runs / Results', lookbackDays: D.CFG.testResultDays,
      runs: runs.map(function (run) {
        var planId = run.plan && run.plan.id != null ? String(run.plan.id) : '';
        return { id: run.id, name: run.name || ('Run ' + run.id), planId: planId, planName: planMap[planId] || (run.plan && run.plan.name) || '', state: run.state || '', startedDate: run.startedDate || null, completedDate: run.completedDate || null, resultCount: run.resultCount || 0, url: D.testRunUrl(run.id), error: run._resultError || '' };
      }),
      testPlans: Object.keys(planMap).map(function (id) { return { id: id, name: planMap[id] }; }), testPlanWarning: planError,
      matchedResults: matchedResults, summary: summary, loadedAt: new Date().toISOString()
    };
  };
  D.isFailedTestOutcome = function (outcome) { return /^(failed|blocked|aborted|error|timeout)$/i.test(String(outcome || '').trim()); };
  D.testResultSummary = function (cases) {
    var summary = { cases: cases.length, matched: 0, passed: 0, failed: 0, other: 0, noResult: 0, denominator: 0 };
    cases.forEach(function (testCase) {
      var result = testCase.latestResult;
      if (!result) { summary.noResult++; return; }
      summary.matched++;
      if (/^passed$/i.test(result.outcome)) summary.passed++;
      else if (D.isFailedTestOutcome(result.outcome)) summary.failed++;
      else summary.other++;
    });
    summary.denominator = summary.passed + summary.failed;
    summary.passRate = D.rate(summary.passed, summary.denominator);
    summary.failRate = D.rate(summary.failed, summary.denominator);
    return summary;
  };
  D.loadSupplementalData = async function (base, cases) {
    D.S.testResults = { status: 'loading', runs: [] };
    await D.loadTestResults(base, cases).catch(function (error) {
      cases.forEach(function (testCase) { testCase.latestResult = null; });
      D.S.testResults = { status: 'error', runs: [], error: String((error && error.message) || error), source: 'Azure DevOps Test Runs / Results' };
    });
  };
  D.collect = function (node, type, out) { out = out || []; if (node.type === type) out.push(node); (node.children || []).forEach(function (c) { D.collect(c, type, out); }); return out; };
  D.inRange = function (c) { var v = D.S.range; if (v === 'all') return true; if (!c.changed) return false; return (Date.now() - new Date(c.changed).getTime()) <= parseInt(v, 10) * 86400000; };
  D.countStates = function (cases) { var m = {}; cases.forEach(function (c) { m[c.state] = (m[c.state] || 0) + 1; }); return m; };
  D.sum = function (m) { var t = 0; for (var k in m) t += m[k]; return t; };
  D.uniqueBugs = function (cases) {
    var seen = {}, bugs = [];
    cases.forEach(function (c) { (c.bugs || []).forEach(function (bug) { if (!seen[bug.id]) { seen[bug.id] = 1; bugs.push(bug); } }); });
    return bugs;
  };
  D.rate = function (count, total) {
    if (!count || !total) return '0%';
    var percentage = Math.min(100, Math.max(0, count * 100 / total));
    var rounded = Math.round(percentage * 10) / 10;
    return (rounded % 1 ? rounded.toFixed(1) : rounded.toFixed(0)) + '%';
  };
  D.outcomeValue = function (count, rate) {
    return count ? count + ' · ' + rate : '0%';
  };
  D.outcomeSummary = function (cases) {
    var summary = { total: cases.length, pass: 0, fail: 0, inProgress: 0 };
    cases.forEach(function (c) {
      var state = String(c.state || '').trim().toLowerCase();
      if (state === 'closed') summary.pass++;
      else if (state === 'blocked') summary.fail++;
      else if (state === 'in progress') summary.inProgress++;
    });
    summary.passRate = D.rate(summary.pass, summary.total);
    summary.failRate = D.rate(summary.fail, summary.total);
    return summary;
  };
  D.hasMetric = function (value) {
    return value != null && String(value).trim() !== '';
  };
  D.priorityLevel = function (value) {
    var match = /(?:^|\D)([1-4])(?:\D|$)/.exec(String(value == null ? '' : value));
    return match ? +match[1] : null;
  };
  D.severityInfo = function (value) {
    var level = D.priorityLevel(value);
    var labels = { 1: '1 - Critical', 2: '2 - High', 3: '3 - Medium', 4: '4 - Low' };
    return { level: level, label: labels[level] || (D.hasMetric(value) ? String(value) : 'Unknown') };
  };
  D.metricBadge = function (label, value, color) {
    var badge = D.el('span', 'metric-badge', label + ': ' + value);
    badge.style.color = color; badge.style.borderColor = D.rgba(color, .55); badge.style.background = D.rgba(color, .11);
    return badge;
  };
  D.caseLinks = function (cases) {
    var wrap = D.el('span', 'case-links');
    cases.forEach(function (testCase, index) {
      if (index) wrap.appendChild(document.createTextNode(', '));
      var link = D.el('a', 'caseid', '#' + testCase.id); link.href = D.wiUrl(testCase.id); link.target = '_blank'; link.rel = 'noopener';
      link.title = testCase.title; wrap.appendChild(link);
    });
    return wrap;
  };
  D.itemLinks = function (items, kind) {
    var wrap = D.el('div', 'hbar-links');
    items.forEach(function (item) {
      if (kind === 'bug') wrap.appendChild(D.bugLink(item));
      else {
        var link = D.el('a', 'caseid', '#' + item.id);
        link.href = D.wiUrl(item.id); link.target = '_blank'; link.rel = 'noopener'; link.title = item.title || ('Test Case #' + item.id);
        wrap.appendChild(link);
      }
    });
    return wrap;
  };
  D.idDropdown = function (items, kind) {
    if (!items.length) return null;
    var details = D.el('details', 'hbar-details');
    details.appendChild(D.el('summary', null, (kind === 'bug' ? 'Bug IDs' : 'Case IDs') + ' (' + items.length + ')'));
    details.appendChild(D.itemLinks(items, kind));
    return details;
  };
  D.countLabel = function (count, noun) {
    return count + ' ' + noun + (count === 1 ? '' : 's');
  };
  D.horizontalBarChart = function (title, rows, emptyText) {
    var section = D.el('section', 'metric-section');
    section.appendChild(D.el('h4', null, title));
    if (!rows.length) {
      section.appendChild(D.el('div', 'empty', emptyText || 'No data available'));
      return section;
    }
    var list = D.el('div', 'hbar-list');
    rows.forEach(function (row) {
      var item = D.el('div', 'hbar-row' + (row.total ? ' total' : ''));
      var head = D.el('div', 'hbar-head');
      head.appendChild(D.el('span', 'hbar-label', row.label));
      head.appendChild(D.el('span', 'hbar-value', row.valueText));
      item.appendChild(head);
      var track = D.el('div', 'hbar-track'), fill = D.el('div', 'hbar-fill');
      var width = Math.max(0, Math.min(100, +row.percent || 0));
      fill.style.width = width + '%'; fill.style.background = row.color || '#38bdf8';
      if (width > 0 && width < 1) fill.style.minWidth = '3px';
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label', row.label + ': ' + row.valueText);
      track.appendChild(fill); item.appendChild(track);
      var dropdown = D.idDropdown(row.items || [], row.kind || 'case');
      if (dropdown) item.appendChild(dropdown);
      list.appendChild(item);
    });
    section.appendChild(list); return section;
  };
  D.priorityCompletionChart = function (cases) {
    var groups = { 1: [], 2: [], 3: [], 4: [], unknown: [] };
    cases.forEach(function (testCase) {
      var level = D.priorityLevel(testCase.metrics && testCase.metrics.priority);
      (level ? groups[level] : groups.unknown).push(testCase);
    });
    if (!cases.length) return D.horizontalBarChart('Case Priority completion', [], 'No Test Cases in the selected time range');
    var rows = [], totalClosed = 0;
    [1, 2, 3, 4].forEach(function (key) {
      var list = groups[key];
      var closed = list.filter(function (testCase) { return String(testCase.state || '').toLowerCase() === 'closed'; }).length;
      totalClosed += closed;
      rows.push({ label: 'P' + key, valueText: list.length ? (closed + ' / ' + list.length + ' Closed · ' + D.rate(closed, list.length)) : '0 cases', percent: list.length ? closed * 100 / list.length : 0, items: list, color: '#2dd4bf' });
    });
    if (groups.unknown.length) {
      var unknownClosed = groups.unknown.filter(function (testCase) { return String(testCase.state || '').toLowerCase() === 'closed'; }).length;
      totalClosed += unknownClosed;
      rows.push({ label: 'Not set', valueText: unknownClosed + ' / ' + groups.unknown.length + ' Closed · ' + D.rate(unknownClosed, groups.unknown.length), percent: unknownClosed * 100 / groups.unknown.length, items: groups.unknown, color: '#94a3b8' });
    }
    rows.push({ label: 'All priorities', valueText: totalClosed + ' / ' + cases.length + ' Closed · ' + D.rate(totalClosed, cases.length), percent: totalClosed * 100 / cases.length, items: cases, color: '#38bdf8', total: true });
    return D.horizontalBarChart('Case Priority completion', rows);
  };
  D.numericRank = function (value) {
    var match = /-?\d+(?:\.\d+)?/.exec(String(value == null ? '' : value).replace(/,/g, ''));
    return match ? +match[0] : -Infinity;
  };
  D.durationRank = function (value) {
    if (typeof value === 'number') return value;
    var text = String(value == null ? '' : value).toLowerCase(), total = 0, foundUnit = false;
    var re = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g, match;
    while ((match = re.exec(text))) {
      foundUnit = true;
      var n = +match[1], unit = match[2];
      if (/^(d|day)/.test(unit)) total += n * 86400;
      else if (/^(h|hr|hour)/.test(unit)) total += n * 3600;
      else if (/^(m|min|minute)/.test(unit)) total += n * 60;
      else total += n;
    }
    return foundUnit ? total : D.numericRank(value);
  };
  D.metricInventoryChart = function (cases, key, label, ranker, color, showCoverage) {
    var groups = {};
    cases.forEach(function (testCase) {
      var value = testCase.metrics && testCase.metrics[key]; if (!D.hasMetric(value)) return;
      var text = String(value).trim();
      (groups[text] = groups[text] || []).push(testCase);
    });
    var keys = Object.keys(groups).sort(function (a, b) {
      var delta = ranker(b) - ranker(a); return delta || a.localeCompare(b);
    });
    var total = keys.reduce(function (sum, keyName) { return sum + groups[keyName].length; }, 0);
    var rows = keys.map(function (keyName) {
      var count = groups[keyName].length, share = total ? count * 100 / total : 0;
      return { label: keyName, valueText: D.countLabel(count, 'case') + ' · ' + share.toFixed(1) + '%', percent: share, items: groups[keyName], color: color };
    });
    var title = showCoverage
      ? label + ' (' + total + ' set / ' + (cases.length - total) + ' empty · ' + cases.length + ' total)'
      : label + ' (' + total + ' cases)';
    return D.horizontalBarChart(title, rows, 'No ' + label + ' values found');
  };
  D.metricInventoryPanel = function (cases) {
    var grid = D.el('div', 'metric-grid');
    var left = D.el('div', 'metric-stack');
    left.appendChild(D.metricInventoryChart(cases, 'sampleSize', 'Sample Size', D.numericRank, '#38bdf8'));
    left.appendChild(D.metricInventoryChart(cases, 'numberOfCycles', 'Number_of_cycles', D.numericRank, '#a78bfa', true));
    grid.appendChild(left);
    grid.appendChild(D.metricInventoryChart(cases, 'testDuration', 'Test Duration', D.durationRank, '#fbbf24'));
    return grid;
  };
  D.bugPrioritySeverityChart = function (bugs, priorityKey) {
    var priorityBugs = bugs.filter(function (bug) {
      var level = D.priorityLevel(bug.priority);
      return priorityKey === 'unknown' ? !level : level === priorityKey;
    });
    var groups = { 1: [], 2: [], 3: [], 4: [], unknown: [] };
    priorityBugs.forEach(function (bug) {
      var level = D.severityInfo(bug.severity).level;
      (level ? groups[level] : groups.unknown).push(bug);
    });
    var severityLabels = { 1: '1 - Critical', 2: '2 - High', 3: '3 - Medium', 4: '4 - Low' };
    var severityColors = { 1: '#fb7185', 2: '#fb923c', 3: '#fbbf24', 4: '#60a5fa', unknown: '#94a3b8' };
    var rows = [];
    [1, 2, 3, 4, 'unknown'].forEach(function (key) {
      var list = groups[key]; if (!list.length && key === 'unknown') return;
      var share = priorityBugs.length ? list.length * 100 / priorityBugs.length : 0;
      rows.push({
        label: key === 'unknown' ? 'Severity not set' : severityLabels[key],
        valueText: D.countLabel(list.length, 'bug') + ' · ' + share.toFixed(1) + '%',
        percent: share,
        items: list,
        kind: 'bug',
        color: severityColors[key]
      });
    });
    var title = priorityKey === 'unknown' ? 'Priority not set' : 'Priority P' + priorityKey;
    return D.horizontalBarChart(title + ' (' + D.countLabel(priorityBugs.length, 'bug') + ')', rows);
  };
  D.bugStats = function (cases) {
    var bugs = D.uniqueBugs(cases), wrap = D.el('div');
    wrap.appendChild(D.el('div', 'metric-total', 'Total unique Bugs: ' + bugs.length));
    var allBugIds = D.idDropdown(bugs, 'bug'); if (allBugIds) wrap.appendChild(allBugIds);
    wrap.appendChild(D.el('div', 'small', 'Severity percentages are calculated within each Bug Priority.'));
    var grid = D.el('div', 'metric-grid bug-priority-grid');
    [1, 2, 3, 4].forEach(function (priority) { grid.appendChild(D.bugPrioritySeverityChart(bugs, priority)); });
    if (bugs.some(function (bug) { return !D.priorityLevel(bug.priority); })) grid.appendChild(D.bugPrioritySeverityChart(bugs, 'unknown'));
    wrap.appendChild(grid); return wrap;
  };
  D.arcPath = function (cx, cy, R, r, a0, a1) {
    var x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    var x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    var x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
    var x3 = cx + r * Math.cos(a0), y3 = cy + r * Math.sin(a0);
    var lg = (a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + x0 + ' ' + y0 + ' A' + R + ' ' + R + ' 0 ' + lg + ' 1 ' + x1 + ' ' + y1 +
      ' L' + x2 + ' ' + y2 + ' A' + r + ' ' + r + ' 0 ' + lg + ' 0 ' + x3 + ' ' + y3 + ' Z';
  };
  D.pie = function (counts) {
    var size = 300, keys = D.orderStates(Object.keys(counts)), total = D.sum(counts);
    var s = D.svg('svg', { viewBox: '0 0 ' + size + ' ' + size, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' });
    var cx = size / 2, cy = size / 2, R = size / 2 - 10, r = R * 0.58;
    if (!total) {
      s.appendChild(D.svg('circle', { cx: cx, cy: cy, r: R, fill: '#16243d' }));
      var t0 = D.svg('text', { x: cx, y: cy + 5, fill: '#8fa3c0', 'text-anchor': 'middle', 'font-size': '14' }); t0.textContent = 'No data in range'; s.appendChild(t0);
      return s;
    }
    if (keys.length === 1) {
      s.appendChild(D.svg('circle', { cx: cx, cy: cy, r: R, fill: D.colorFor(keys[0]) }));
      s.appendChild(D.svg('circle', { cx: cx, cy: cy, r: r, fill: '#111d33' }));
      var tt = D.svg('title'); tt.textContent = keys[0] + ': ' + counts[keys[0]] + ' (100%)'; s.appendChild(tt);
    } else {
      var a = -Math.PI / 2;
      keys.forEach(function (k) {
        var frac = counts[k] / total, a1 = a + frac * Math.PI * 2;
        var p = D.svg('path', { d: D.arcPath(cx, cy, R, r, a, a1), fill: D.colorFor(k), stroke: '#0b1220', 'stroke-width': '2' });
        var ti = D.svg('title'); ti.textContent = k + ': ' + counts[k] + ' (' + (frac * 100).toFixed(1) + '%)';
        p.appendChild(ti); s.appendChild(p);
        if (frac > 0.06) {
          var am = (a + a1) / 2, rr = (R + r) / 2;
          var lb = D.svg('text', { x: cx + rr * Math.cos(am), y: cy + rr * Math.sin(am) + 4, fill: '#0b1220', 'text-anchor': 'middle', 'font-size': '12', 'font-weight': '700' });
          lb.textContent = (frac * 100).toFixed(0) + '%'; s.appendChild(lb);
        }
        a = a1;
      });
    }
    var n1 = D.svg('text', { x: cx, y: cy - 2, fill: '#e2e8f0', 'text-anchor': 'middle', 'font-size': '26', 'font-weight': '700' }); n1.textContent = total;
    var n2 = D.svg('text', { x: cx, y: cy + 16, fill: '#8fa3c0', 'text-anchor': 'middle', 'font-size': '11' }); n2.textContent = 'test cases';
    s.appendChild(n1); s.appendChild(n2);
    return s;
  };
  D.bar = function (counts) {
    var W = 460, H = 300, L = 40, B = 46, T = 14, Rp = 12;
    var keys = D.orderStates(Object.keys(counts)), total = D.sum(counts);
    var s = D.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' });
    if (!total) { var t0 = D.svg('text', { x: W / 2, y: H / 2, fill: '#8fa3c0', 'text-anchor': 'middle', 'font-size': '14' }); t0.textContent = 'No data in range'; s.appendChild(t0); return s; }
    var max = Math.max.apply(null, keys.map(function (k) { return counts[k]; }));
    var pw = W - L - Rp, ph = H - T - B;
    for (var g = 0; g <= 4; g++) {
      var y = T + ph - ph * g / 4;
      s.appendChild(D.svg('line', { x1: L, y1: y, x2: L + pw, y2: y, stroke: '#1c2942' }));
      var yl = D.svg('text', { x: L - 6, y: y + 4, fill: '#7d93b3', 'text-anchor': 'end', 'font-size': '10' });
      yl.textContent = Math.round(max * g / 4); s.appendChild(yl);
    }
    var slot = pw / keys.length, bw = Math.min(60, slot * 0.6);
    keys.forEach(function (k, i) {
      var v = counts[k], h = ph * v / max, x = L + slot * i + (slot - bw) / 2, y = T + ph - h;
      var rect = D.svg('rect', { x: x, y: y, width: bw, height: Math.max(h, 1), fill: D.colorFor(k), rx: 5 });
      var ti = D.svg('title'); ti.textContent = k + ': ' + v + ' (' + (v * 100 / total).toFixed(1) + '%)'; rect.appendChild(ti);
      s.appendChild(rect);
      var vt = D.svg('text', { x: x + bw / 2, y: y - 5, fill: '#e2e8f0', 'text-anchor': 'middle', 'font-size': '11', 'font-weight': '700' }); vt.textContent = v; s.appendChild(vt);
      var lt = D.svg('text', { x: x + bw / 2, y: T + ph + 16, fill: '#9fb3d0', 'text-anchor': 'middle', 'font-size': '10' });
      lt.textContent = k.length > 12 ? k.slice(0, 11) + '…' : k; s.appendChild(lt);
    });
    return s;
  };
  D.stacked = function (labels, perRack, states) {
    var W = 460, H = 300, L = 40, B = 40, T = 14, Rp = 12;
    var s = D.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' });
    var totals = perRack.map(function (m) { return D.sum(m); });
    var max = Math.max.apply(null, totals.concat([1]));
    if (!totals.some(function (t) { return t > 0; })) { var t0 = D.svg('text', { x: W / 2, y: H / 2, fill: '#8fa3c0', 'text-anchor': 'middle', 'font-size': '14' }); t0.textContent = 'No data in range'; s.appendChild(t0); return s; }
    var pw = W - L - Rp, ph = H - T - B;
    for (var g = 0; g <= 4; g++) {
      var y = T + ph - ph * g / 4;
      s.appendChild(D.svg('line', { x1: L, y1: y, x2: L + pw, y2: y, stroke: '#1c2942' }));
      var yl = D.svg('text', { x: L - 6, y: y + 4, fill: '#7d93b3', 'text-anchor': 'end', 'font-size': '10' }); yl.textContent = Math.round(max * g / 4); s.appendChild(yl);
    }
    var slot = pw / labels.length, bw = Math.min(56, slot * 0.55);
    labels.forEach(function (lab, i) {
      var x = L + slot * i + (slot - bw) / 2, acc = 0;
      states.forEach(function (st) {
        var v = perRack[i][st] || 0; if (!v) return;
        var h = ph * v / max, y = T + ph - ph * (acc + v) / max;
        var rect = D.svg('rect', { x: x, y: y, width: bw, height: Math.max(h, 1), fill: D.colorFor(st) });
        var ti = D.svg('title'); ti.textContent = lab + ' · ' + st + ': ' + v; rect.appendChild(ti);
        s.appendChild(rect); acc += v;
      });
      var tv = D.svg('text', { x: x + bw / 2, y: T + ph - ph * totals[i] / max - 5, fill: '#e2e8f0', 'text-anchor': 'middle', 'font-size': '11', 'font-weight': '700' });
      tv.textContent = totals[i] || ''; s.appendChild(tv);
      var lt = D.svg('text', { x: x + bw / 2, y: T + ph + 16, fill: '#9fb3d0', 'text-anchor': 'middle', 'font-size': '10' }); lt.textContent = lab; s.appendChild(lt);
    });
    return s;
  };
  D.legend = function (counts) {
    var wrap = D.el('div', 'legend');
    var total = D.sum(counts);
    D.orderStates(Object.keys(counts)).forEach(function (k) {
      var c = D.chip(k, counts[k] + ' (' + (total ? (counts[k] * 100 / total).toFixed(0) : 0) + '%)');
      wrap.appendChild(c);
    });
    return wrap;
  };
  D.testResultBadge = function (result) {
    if (!result) return D.metricBadge('Test Result', 'No result', '#64748b');
    var color = /^passed$/i.test(result.outcome) ? '#34d399' : (D.isFailedTestOutcome(result.outcome) ? '#fb7185' : '#fbbf24');
    var badge = D.metricBadge('Test Result', result.outcome || 'Unspecified', color);
    badge.title = result.runName + ' · ' + D.fmt(result.completedDate) + ' · matched by ' + result.matchMethod;
    return badge;
  };
  D.testRunsTable = function () {
    var runs = D.S.testResults && D.S.testResults.runs || [];
    if (!runs.length) return D.el('div', 'empty', D.S.testResults && D.S.testResults.status === 'error' ? 'Test Runs unavailable: ' + D.S.testResults.error : 'No Test Runs found in the last ' + D.CFG.testResultDays + ' days');
    var wrap = D.el('div', 'table-scroll'), table = D.el('table'), thead = D.el('thead'), header = D.el('tr');
    ['Run', 'Test Plan', 'State', 'Started', 'Completed', 'Results', 'API status'].forEach(function (label) { header.appendChild(D.el('th', null, label)); }); thead.appendChild(header); table.appendChild(thead);
    var tbody = D.el('tbody'); runs.slice(0, 100).forEach(function (run) {
      var row = D.el('tr'), runCell = D.el('td'), link = D.el('a', null, '#' + run.id + ' · ' + run.name); link.href = run.url; link.target = '_blank'; link.rel = 'noopener'; runCell.appendChild(link); row.appendChild(runCell);
      row.appendChild(D.el('td', null, run.planName ? ((run.planId ? '#' + run.planId + ' · ' : '') + run.planName) : '-'));
      row.appendChild(D.el('td', null, run.state || '-')); row.appendChild(D.el('td', null, D.fmt(run.startedDate))); row.appendChild(D.el('td', null, D.fmt(run.completedDate)));
      row.appendChild(D.el('td', 'num', String(run.resultCount || 0))); row.appendChild(D.el('td', null, run.error || 'Loaded')); tbody.appendChild(row);
    });
    table.appendChild(tbody); wrap.appendChild(table); return wrap;
  };
  D.changeDetails = function (label, items, kind) {
    var details = D.el('details', 'change-group'), summary = D.el('summary', null, label + ' (' + items.length + ')'); details.appendChild(summary);
    if (!items.length) { details.appendChild(D.el('div', 'empty', 'No cases')); return details; }
    var list = D.el('div', 'change-list'); items.forEach(function (item) {
      var row = D.el('div', 'change-row'), link = D.el('a', 'caseid', '#' + item.id); link.href = D.wiUrl(item.id); link.target = '_blank'; link.rel = 'noopener'; row.appendChild(link);
      row.appendChild(D.el('span', 'change-title', item.title || ('Case #' + item.id))); row.appendChild(D.el('span', 'small', item.rack || '-'));
      if (kind === 'state') row.appendChild(D.el('span', 'change-state', item.beforeState + ' → ' + item.afterState));
      else if (item.state) row.appendChild(D.chip(item.state));
      row.appendChild(D.el('span', 'date', D.fmt(item.changed))); list.appendChild(row);
    }); details.appendChild(list); return details;
  };
  D.weeklyRows = function () {
    var comparison = D.S.snapshotComparison || {}, changedIds = {}, changeKinds = {};
    (comparison.updatedThisWeek || []).forEach(function (item) { changedIds[item.id] = 1; });
    (comparison.added || []).forEach(function (item) { changeKinds[item.id] = 'Added'; });
    (comparison.removed || []).forEach(function (item) { changeKinds[item.id] = 'Removed'; });
    (comparison.stateChanged || []).forEach(function (item) { changeKinds[item.id] = item.beforeState + ' -> ' + item.afterState; });
    var rows = [];
    (D.S.racks || []).forEach(function (rack) { D.collect(rack, 'Test Case').forEach(function (testCase) {
      var result = testCase.latestResult || {}, metrics = testCase.metrics || {};
      rows.push({ rack: rack.label, id: testCase.id, title: testCase.title, state: testCase.state, changed: D.fmt(testCase.changed), changedThisWeek: changedIds[testCase.id] ? 'Yes' : 'No', snapshotChange: changeKinds[testCase.id] || '-',
        result: result.outcome || 'No result', resultDate: D.fmt(result.completedDate), runId: result.runId || '-', priority: D.displayFieldValue(metrics.priority), sampleSize: D.displayFieldValue(metrics.sampleSize), cycles: D.displayFieldValue(metrics.numberOfCycles), duration: D.displayFieldValue(metrics.testDuration),
        bugs: (testCase.bugs || []).map(function (bug) { return 'BUG #' + bug.id; }).join('; ') || '-', url: D.wiUrl(testCase.id) });
    }); }); return rows;
  };
  D.csvValue = function (value) { var text = String(value == null ? '' : value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; };
  D.downloadBlob = function (content, type, filename) {
    var blob = new Blob([content], { type: type }), link = D.el('a'); link.href = URL.createObjectURL(blob); link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 5000);
  };
  D.reportStamp = function () { var now = new Date(); return now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0'); };
  D.exportWeeklyCsv = function () {
    var headers = ['Rack', 'Case ID', 'Title', 'Case State', 'Changed Date', 'Changed This Week', 'Snapshot Change', 'Latest Test Result', 'Result Date', 'Test Run ID', 'Priority', 'Sample Size', 'Number of Cycles', 'Test Duration', 'Linked Bugs', 'Azure DevOps URL'];
    var keys = ['rack', 'id', 'title', 'state', 'changed', 'changedThisWeek', 'snapshotChange', 'result', 'resultDate', 'runId', 'priority', 'sampleSize', 'cycles', 'duration', 'bugs', 'url'];
    var lines = [headers.map(D.csvValue).join(',')]; D.weeklyRows().forEach(function (row) { lines.push(keys.map(function (key) { return D.csvValue(row[key]); }).join(',')); });
    D.downloadBlob('\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8', D.reportPrefix() + '-Weekly-Report-' + D.reportStamp() + '.csv'); D.setStatus('Downloaded weekly CSV report with ' + (lines.length - 1) + ' case rows.', 'info');
  };
  D.xlsxColumnName = function (index) { var name = ''; while (index > 0) { index--; name = String.fromCharCode(65 + index % 26) + name; index = Math.floor(index / 26); } return name; };
  D.xlsxSheet = function (sheet, index) {
    var rows = [sheet.headers].concat(sheet.rows), hyperlinks = [], xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    if (sheet.widths && sheet.widths.length) { xml += '<cols>'; sheet.widths.forEach(function (width, colIndex) { xml += '<col min="' + (colIndex + 1) + '" max="' + (colIndex + 1) + '" width="' + Math.max(8, Math.min(60, Math.round(width / 7))) + '" customWidth="1"/>'; }); xml += '</cols>'; }
    xml += '<sheetData>';
    rows.forEach(function (row, rowIndex) {
      xml += '<row r="' + (rowIndex + 1) + '">';
      row.forEach(function (rawCell, colIndex) {
        var cell = rawCell && typeof rawCell === 'object' && !Array.isArray(rawCell) ? rawCell : { value: rawCell };
        var ref = D.xlsxColumnName(colIndex + 1) + (rowIndex + 1), value = cell.value == null || cell.value === '' ? '-' : cell.value;
        if (cell.href) hyperlinks.push({ ref: ref, href: cell.href });
        if (typeof value === 'number' && !cell.href) xml += '<c r="' + ref + '"' + (rowIndex === 0 ? ' s="1"' : '') + '><v>' + value + '</v></c>';
        else xml += '<c r="' + ref + '" t="inlineStr" s="' + (rowIndex === 0 ? '1' : (cell.href ? '2' : '3')) + '"><is><t xml:space="preserve">' + D.xmlEsc(value) + '</t></is></c>';
      });
      xml += '</row>';
    });
    xml += '</sheetData><autoFilter ref="A1:' + D.xlsxColumnName(sheet.headers.length) + rows.length + '"/>';
    if (hyperlinks.length) { xml += '<hyperlinks>'; hyperlinks.forEach(function (link, linkIndex) { xml += '<hyperlink ref="' + link.ref + '" r:id="rId' + (linkIndex + 1) + '"/>'; }); xml += '</hyperlinks>'; }
    xml += '</worksheet>';
    var rels = '';
    if (hyperlinks.length) { rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'; hyperlinks.forEach(function (link, linkIndex) { rels += '<Relationship Id="rId' + (linkIndex + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + D.xmlEsc(link.href) + '" TargetMode="External"/>'; }); rels += '</Relationships>'; }
    return { xml: xml, rels: rels };
  };
  D.zipStore = function (files) {
    var encoder = new TextEncoder(), entries = [], offset = 0, crcTable = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); crcTable[n] = c >>> 0; }
    function crc32(data) { var crc = 0xffffffff; for (var i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
    function record(size) { return new Uint8Array(size); }
    Object.keys(files).forEach(function (name) {
      var nameBytes = encoder.encode(name), data = typeof files[name] === 'string' ? encoder.encode(files[name]) : files[name], crc = crc32(data), local = record(30 + nameBytes.length);
      var view = new DataView(local.buffer); view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true); view.setUint16(8, 0, true); view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
      entries.push({ nameBytes: nameBytes, data: data, crc: crc, local: local, offset: offset }); offset += local.length + data.length;
    });
    var centralParts = [], centralSize = 0;
    entries.forEach(function (entry) { var central = record(46 + entry.nameBytes.length), view = new DataView(central.buffer); view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint16(8, 0x0800, true); view.setUint32(16, entry.crc, true); view.setUint32(20, entry.data.length, true); view.setUint32(24, entry.data.length, true); view.setUint16(28, entry.nameBytes.length, true); view.setUint32(42, entry.offset, true); central.set(entry.nameBytes, 46); centralParts.push(central); centralSize += central.length; });
    var end = record(22), endView = new DataView(end.buffer); endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true); endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
    var output = record(offset + centralSize + end.length), cursor = 0; entries.forEach(function (entry) { output.set(entry.local, cursor); cursor += entry.local.length; output.set(entry.data, cursor); cursor += entry.data.length; }); centralParts.forEach(function (central) { output.set(central, cursor); cursor += central.length; }); output.set(end, cursor); return output;
  };
  D.xlsxWorkbook = function (sheets) {
    var files = {}, contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>', workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>', workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    sheets.forEach(function (sheet, index) { var number = index + 1, built = D.xlsxSheet(sheet, number); files['xl/worksheets/sheet' + number + '.xml'] = built.xml; if (built.rels) files['xl/worksheets/_rels/sheet' + number + '.xml.rels'] = built.rels; contentTypes += '<Override PartName="/xl/worksheets/sheet' + number + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; workbook += '<sheet name="' + D.xmlEsc(sheet.name) + '" sheetId="' + number + '" r:id="rId' + number + '"/>'; workbookRels += '<Relationship Id="rId' + number + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + number + '.xml"/>'; });
    workbook += '</sheets></workbook>'; workbookRels += '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'; contentTypes += '</Types>';
    files['[Content_Types].xml'] = contentTypes; files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'; files['xl/workbook.xml'] = workbook; files['xl/_rels/workbook.xml.rels'] = workbookRels;
    files['xl/styles.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Segoe UI"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Segoe UI"/></font><font><u/><color rgb="FF0563C1"/><sz val="10"/><name val="Segoe UI"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF132039"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return D.zipStore(files);
  };
  D.weeklyXlsx = function () {
    var caseHeaders = ['Rack', 'Case ID', 'Title', 'Case State', 'Changed Date', 'Changed This Week', 'Snapshot Change', 'Latest Test Result', 'Result Date', 'Test Run ID', 'Priority', 'Sample Size', 'Number of Cycles', 'Test Duration', 'Linked Bugs', 'Azure DevOps URL'];
    var caseRows = D.weeklyRows().map(function (row) { return [row.rack, { value: row.id, href: row.url }, row.title, row.state, row.changed, row.changedThisWeek, row.snapshotChange, row.result, row.resultDate, row.runId, row.priority, row.sampleSize, row.cycles, row.duration, row.bugs, { value: row.url, href: row.url }]; });
    var runHeaders = ['Run ID', 'Name', 'Test Plan ID', 'Test Plan', 'State', 'Started', 'Completed', 'Result Count', 'Status', 'URL'];
    var runRows = (D.S.testResults.runs || []).map(function (run) { return [{ value: run.id, href: run.url }, run.name, run.planId || '-', run.planName || '-', run.state, D.fmt(run.startedDate), D.fmt(run.completedDate), run.resultCount, run.error || 'Loaded', { value: run.url, href: run.url }]; });
    var comparison = D.S.snapshotComparison || {}, changeRows = [];
    [['Added', comparison.added || []], ['Removed', comparison.removed || []], ['State changed', comparison.stateChanged || []], ['Updated this week', comparison.updatedThisWeek || []]].forEach(function (group) { group[1].forEach(function (item) { changeRows.push([group[0], { value: item.id, href: D.wiUrl(item.id) }, item.title, item.rack, item.beforeState || '-', item.afterState || item.state || '-', D.fmt(item.changed)]); }); });
    return { bytes: D.xlsxWorkbook([
      { name: 'Weekly Cases', headers: caseHeaders, rows: caseRows, widths: [70, 72, 360, 90, 110, 95, 130, 110, 110, 80, 70, 85, 100, 95, 220, 300] },
      { name: 'Test Runs', headers: runHeaders, rows: runRows, widths: [72, 220, 80, 180, 80, 110, 110, 90, 120, 300] },
      { name: 'Snapshot Changes', headers: ['Change', 'Case ID', 'Title', 'Rack', 'Before', 'After', 'Changed'], rows: changeRows, widths: [100, 72, 360, 90, 90, 90, 110] }
    ]), count: caseRows.length };
  };
  D.exportWeeklyExcel = function () { var report = D.weeklyXlsx(); D.downloadBlob(report.bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', D.reportPrefix() + '-Weekly-Report-' + D.reportStamp() + '.xlsx'); D.setStatus('Downloaded XLSX workbook with ' + report.count + ' case rows and three unfrozen worksheets.', 'info'); };
  D.insightsPanel = function () {
    var wrap = D.el('div'), cases = D.allCases(), test = D.S.testResults || { status: 'idle', runs: [] }, summary = test.summary || D.testResultSummary(cases), comparison = D.S.snapshotComparison || { status: 'first', added: [], removed: [], stateChanged: [], updatedThisWeek: [] };
    var sticky = D.el('div', 'panel-sticky'), cards = D.el('div', 'cards');
    var resultAvailable = test.status === 'ok';
    [D.card('RESULTS / CASES', resultAvailable ? summary.matched + ' / ' + summary.cases : 'Unavailable', '#60a5fa'),
      D.card('RESULT PASSED / RATE', resultAvailable ? D.outcomeValue(summary.passed, summary.passRate) : 'Unavailable', '#34d399'),
      D.card('RESULT FAILED / RATE', resultAvailable ? D.outcomeValue(summary.failed, summary.failRate) : 'Unavailable', '#fb7185'),
      D.card('NO TEST RESULT', resultAvailable ? summary.noResult : 'Unavailable', '#fbbf24'),
      D.card('UPDATED THIS WEEK', (comparison.updatedThisWeek || []).length, '#c084fc')].forEach(function (card) { cards.appendChild(card); });
    sticky.appendChild(cards); wrap.appendChild(sticky);
    var toolbar = D.el('div', 'insights-toolbar'), csv = D.el('button', 'primary', 'Download weekly CSV'), excel = D.el('button', 'primary', 'Download weekly Excel (.xlsx)');
    csv.addEventListener('click', D.exportWeeklyCsv); excel.addEventListener('click', D.exportWeeklyExcel); toolbar.appendChild(csv); toolbar.appendChild(excel); toolbar.appendChild(D.el('span', 'small', 'Reports include all Racks, latest Test Result, weekly changes, metrics, Bugs and hyperlinks.')); wrap.appendChild(toolbar);
    var resultGrid = D.el('div', 'grid'), resultBox = D.box('Real Pass / Fail — latest Test Result per Case');
    resultBox.appendChild(D.el('div', 'metric-total', resultAvailable ? ('Denominator: ' + summary.denominator + ' latest decisive results · ' + summary.other + ' other outcomes · ' + summary.noResult + ' cases without a result') : ('Unavailable: ' + (test.error || 'not loaded'))));
    resultBox.appendChild(D.horizontalBarChart('Latest Test Results', [
      { label: 'Passed', valueText: summary.passed + ' · ' + summary.passRate, percent: summary.denominator ? summary.passed * 100 / summary.denominator : 0, items: [], color: '#34d399' },
      { label: 'Failed', valueText: summary.failed + ' · ' + summary.failRate, percent: summary.denominator ? summary.failed * 100 / summary.denominator : 0, items: [], color: '#fb7185' },
      { label: 'Other outcome', valueText: String(summary.other), percent: summary.cases ? summary.other * 100 / summary.cases : 0, items: [], color: '#fbbf24' },
      { label: 'No result', valueText: String(summary.noResult), percent: summary.cases ? summary.noResult * 100 / summary.cases : 0, items: [], color: '#64748b' }
    ]));
    var changesBox = D.box('Changes since previous snapshot');
    changesBox.appendChild(D.el('div', 'small', comparison.status === 'first' ? 'First snapshot captured. State comparison becomes available after the next successful query.' : 'Previous: ' + D.fmt(comparison.previousAt) + ' · Current: ' + D.fmt(comparison.currentAt)));
    changesBox.appendChild(D.changeDetails('Updated in the last 7 days', comparison.updatedThisWeek || [], 'updated'));
    changesBox.appendChild(D.changeDetails('State changed', comparison.stateChanged || [], 'state'));
    changesBox.appendChild(D.changeDetails('Added', comparison.added || [], 'added')); changesBox.appendChild(D.changeDetails('Removed', comparison.removed || [], 'removed'));
    resultGrid.appendChild(resultBox); resultGrid.appendChild(changesBox); wrap.appendChild(resultGrid);
    var runsBox = D.box('Azure DevOps Test Runs / Test Plans — last ' + D.CFG.testResultDays + ' days');
    if (test.testPlanWarning) runsBox.appendChild(D.el('div', 'empty', 'Test Plan names unavailable: ' + test.testPlanWarning + '. Test Run and Result data is still shown.'));
    runsBox.appendChild(D.testRunsTable()); wrap.appendChild(runsBox); return wrap;
  };
  D.CSS = "*{box-sizing:border-box}\nbody{margin:0;font-family:\"Segoe UI\",Roboto,\"Noto Sans TC\",\"Microsoft JhengHei\",sans-serif;background:#0b1220;color:#e2e8f0;font-size:14px}\na{color:#7dd3fc;text-decoration:none}a:hover{text-decoration:underline}\nheader{padding:14px 20px;background:linear-gradient(90deg,#132039,#0d1729);border-bottom:1px solid #1e2b45;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}\nh1{font-size:18px;margin:0 0 4px}\n.sub{font-size:12px;color:#8fa3c0}\n.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:10px 20px;background:#0e1830;border-bottom:1px solid #1e2b45;position:sticky;top:0;z-index:20}\n.controls label{font-size:12px;color:#9fb3d0;display:flex;gap:6px;align-items:center}\nselect,button,input{background:#16243d;color:#e2e8f0;border:1px solid #27395c;border-radius:6px;padding:6px 10px;font-size:13px;font-family:inherit}\nbutton{cursor:pointer}button:hover{background:#1e3a5f}\nbutton.primary{background:#2563eb;border-color:#2563eb}button.primary:hover{background:#1d4ed8}\n.tabs{display:flex;flex-wrap:wrap;gap:4px;padding:10px 20px 0}\n.tab{padding:8px 16px;border-radius:8px 8px 0 0;background:#111d33;border:1px solid #1e2b45;border-bottom:none;color:#9fb3d0;cursor:pointer;font-size:13px}\n.tab.active{background:#16243d;color:#fff;font-weight:600;box-shadow:inset 0 3px 0 #38bdf8}\n.panel{display:none;padding:16px 20px 60px}.panel.active{display:block}\n.cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px;align-items:center}\n.card{background:#111d33;border:1px solid #1e2b45;border-radius:10px;padding:10px 16px;min-width:110px}\n.card .k{font-size:10px;color:#8fa3c0;letter-spacing:.05em}\n.card .v{font-size:22px;font-weight:700;margin-top:2px}\n.grid{display:grid;grid-template-columns:minmax(300px,1fr) minmax(320px,1.15fr);gap:14px;margin-bottom:16px}\n@media(max-width:980px){.grid{grid-template-columns:1fr}}\n.box{background:#111d33;border:1px solid #1e2b45;border-radius:10px;padding:14px}\n.box h3{margin:0 0 10px;font-size:12px;color:#cbd8ea;letter-spacing:.05em;text-transform:uppercase}\n.chartwrap{height:300px}\n.legend{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;justify-content:center}\ntable{width:100%;border-collapse:collapse;font-size:13px}\nth,td{text-align:left;padding:6px 8px;border-bottom:1px solid #1c2942}\nth{color:#8fa3c0;font-size:10px;text-transform:uppercase;letter-spacing:.05em}\ntr.total td{font-weight:700;border-top:2px solid #27395c;border-bottom:none}\ntd.num,th.num{text-align:right;font-variant-numeric:tabular-nums}\n.chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;color:#0b1220}\n.bar{height:8px;border-radius:4px;background:#1c2942;overflow:hidden;display:flex;min-width:70px}\ndetails.node{border:1px solid #1c2942;border-radius:8px;margin:6px 0;background:#0f1a2e}\ndetails.node[open]{background:#101d33}\ndetails.node>summary{cursor:pointer;padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;list-style:none}\ndetails.node>summary::-webkit-details-marker{display:none}\ndetails.node>summary:before{content:\"\\25B8\";color:#5b7ba6;font-size:12px;transition:transform .15s}\ndetails.node[open]>summary:before{transform:rotate(90deg)}\ndetails.node>summary:hover{background:#152341}\n.nodebody{padding:2px 10px 10px 24px}\n.ntitle{font-weight:600}\n.lvl1>summary>.ntitle{color:#f0f6ff;font-size:14px}\n.lvl2>summary>.ntitle{color:#cfe3ff;font-size:13px}\n.lvl3>summary>.ntitle{color:#b7cdea;font-size:12.5px;font-weight:500}\n.type{font-size:10px;color:#7d93b3;border:1px solid #27395c;border-radius:4px;padding:1px 5px}\n.spacer{flex:1}\n.caserow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px dashed #1c2942;font-size:13px}\n.caserow:hover{background:#152341}\n.caseid{font-family:Consolas,monospace;font-size:12px;color:#7dd3fc;min-width:64px}\n.casetitle{flex:1;min-width:200px;color:#d7e3f4}\n.date{font-size:11px;color:#7d93b3;font-variant-numeric:tabular-nums}\n.banner{margin:10px 20px;padding:10px 14px;border-radius:8px;font-size:13px;border:1px solid}\n.banner.info{background:#10233d;border-color:#27507f;color:#bcd9ff}\n.banner.warn{background:#3a2a10;border-color:#7a5a1c;color:#ffd9a0}\n.banner.err{background:#3a1620;border-color:#7f2740;color:#ffc2cf}\n.hide{display:none!important}\n.small{font-size:11px;color:#8fa3c0}\n.empty{padding:14px;text-align:center;color:#8fa3c0;font-size:13px}";
  D.CSS += "\n.type-badge{font-weight:700;letter-spacing:.02em}\n.colour-key{display:inline-flex;flex-wrap:wrap;gap:5px;align-items:center;padding-left:8px;border-left:1px solid #27395c}\n.tab{font-size:14px;padding:10px 18px;min-height:40px}\n.banner{position:fixed;right:20px;bottom:20px;z-index:100;max-width:min(680px,calc(100vw - 40px));margin:0;padding:11px 14px;box-shadow:0 14px 36px rgba(0,0,0,.38);opacity:1;transform:translateY(0);transition:opacity .7s ease,transform .7s ease;pointer-events:auto}\n.banner.fading{opacity:0;transform:translateY(10px);pointer-events:none}\n.cards{display:flex;flex-wrap:nowrap;gap:12px;width:100%;align-items:stretch;overflow-x:auto;scrollbar-width:thin}\n.cards>.card{flex:1 0 118px;width:auto;min-width:118px;max-width:none;overflow:hidden;padding-left:12px;padding-right:12px}\n.card{position:relative;transition:transform .15s,filter .15s}\n.card:hover{transform:translateY(-2px);filter:brightness(1.12)}\n.card .k{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.card .v{white-space:nowrap;overflow:visible;text-overflow:clip;font-variant-numeric:tabular-nums;line-height:1.2;min-height:28px;display:flex;align-items:center}\n.tree-toolbar{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;width:66.6667%;max-width:100%;margin-bottom:14px;align-items:center}\n.tree-toolbar>button,.tree-toolbar>input{width:100%;min-width:0}\n.bug-link{display:inline-flex;align-items:center;border:1px solid rgba(248,113,113,.72);border-radius:999px;padding:2px 8px;background:rgba(248,113,113,.14);color:#fecaca;font-size:11px;font-weight:700;white-space:nowrap}\n.bug-link:hover{background:rgba(248,113,113,.25);color:#fff;text-decoration:none}\n.caserow{margin:3px 0;border-radius:6px;border-bottom-color:transparent;transition:filter .15s,transform .15s}\n.caserow:hover{filter:brightness(1.18);transform:translateX(2px)}\ndetails.node{overflow:hidden;transition:filter .15s,border-color .15s}\ndetails.node:hover{filter:brightness(1.08)}\n@media(max-width:720px){.tab{font-size:14px;padding:9px 14px;min-height:38px;flex:1 1 auto}.banner{right:12px;bottom:12px;max-width:calc(100vw - 24px)}.colour-key{width:100%;padding:6px 0 0;border-left:0;border-top:1px solid #27395c}.casetitle{min-width:150px}.tree-toolbar{width:100%;grid-template-columns:repeat(2,minmax(0,1fr))}.tree-toolbar>input{grid-column:1/-1}}";
  D.CSS += "\n.tab{font-size:18px;padding:10px 29px;min-height:42px}\n.metric-badge{display:inline-flex;align-items:center;border:1px solid;border-radius:5px;padding:2px 6px;font-size:10.5px;font-weight:700;white-space:nowrap}\n.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:10px 0 14px}\n.metric-section{min-width:0;padding:10px;border:1px solid #1c2942;border-radius:8px;background:#0f1a2e;overflow-x:auto}\n.metric-section h4{margin:0 0 8px;color:#cfe3ff;font-size:12px}\n.metric-total{font-size:12px;color:#bcd9ff;margin:2px 0 8px;font-weight:700}\n.case-links{display:inline;line-height:1.8}\n@media(max-width:980px){.metric-grid{grid-template-columns:1fr}}\n@media(max-width:720px){.tab{font-size:16px;padding:9px 18px;min-height:40px}}";
  D.CSS += "\n.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}\n.metric-stack{display:grid;gap:12px;align-content:start;min-width:0}\n.metric-section{overflow:hidden}\n.hbar-list{display:grid;gap:10px}\n.hbar-row{padding:9px 10px;border:1px solid #1c2942;border-radius:8px;background:#111d33}\n.hbar-row.total{border-color:#2d527d;background:#12223b}\n.hbar-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px}\n.hbar-label{min-width:0;color:#dbeafe;font-size:12px;font-weight:700;overflow-wrap:anywhere}\n.hbar-value{flex:none;color:#a9bdd8;font-size:11px;font-variant-numeric:tabular-nums;text-align:right}\n.hbar-track{height:12px;border-radius:999px;background:#1c2942;overflow:hidden}\n.hbar-fill{height:100%;border-radius:inherit;transition:width .25s ease}\n.hbar-details{margin-top:5px;color:#8fa3c0;font-size:11px}\n.hbar-details>summary{display:flex;align-items:center;min-height:32px;width:max-content;max-width:100%;cursor:pointer;color:#7dd3fc;font-weight:600;list-style:none}\n.hbar-details>summary::-webkit-details-marker{display:none}\n.hbar-details>summary:before{content:'\\25B8';margin-right:5px;color:#5b7ba6;transition:transform .15s}\n.hbar-details[open]>summary:before{transform:rotate(90deg)}\n.hbar-details>summary:hover{color:#bae6fd}\n.hbar-details>summary:focus-visible{outline:2px solid #38bdf8;outline-offset:2px;border-radius:4px}\n.hbar-links{display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 2px 16px}\n@media(max-width:980px){.metric-grid{grid-template-columns:1fr}}\n@media(max-width:720px){.hbar-head{align-items:flex-start;flex-direction:column;gap:3px}.hbar-value{text-align:left}.hbar-row{padding:9px}.hbar-details>summary{min-height:40px}.hbar-links{padding-left:8px}}";
  D.CSS += "\n.bug-detail-scroll{max-width:100%;overflow-x:auto;margin-top:8px}\n.bug-detail-scroll>table{min-width:640px}";
  D.CSS += "\n.suite-intro{margin:0 0 12px;color:#9fb3d0;font-size:12px}\n.suite-toolbar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;width:min(980px,100%);margin-bottom:14px}\n.suite-toolbar>*{width:100%;min-width:0}\n.feature-groups{display:grid;gap:8px}\ndetails.feature-group{min-width:0;border:1px solid #253858;border-radius:9px;background:#0f1a2e;overflow:hidden}\ndetails.feature-group[open]{border-color:#35618f;background:#101d33}\n.feature-summary{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:pointer;list-style:none}\n.feature-summary::-webkit-details-marker{display:none}\n.feature-summary:before{content:'\\25B8';color:#7dd3fc;transition:transform .15s}\ndetails.feature-group[open]>.feature-summary:before{transform:rotate(90deg)}\n.feature-summary:hover{background:#152744}\n.feature-group-name{color:#e0f2fe;font-size:15px;font-weight:700}\n.suite-pill{display:inline-flex;padding:2px 8px;border-radius:999px;background:#193657;color:#bae6fd;border:1px solid #2d527d;font-size:11px;font-weight:700}\n.feature-group-body{padding:0 12px 12px 28px}\n.feature-table-scroll{max-width:100%;overflow:auto;border:1px solid #1c2942;border-radius:7px}\ntable.feature-table{min-width:1480px;background:#0c1729}\n.feature-table th{position:sticky;top:0;background:#132039;z-index:1}\n.feature-table td{vertical-align:top;line-height:1.4}\n.feature-table .feature-id{width:86px;font-family:Consolas,monospace}\n.feature-table .feature-title{min-width:420px;color:#d7e3f4}\n.feature-table .feature-owner{min-width:150px}\n.feature-table .feature-comments{min-width:240px;max-width:420px;white-space:normal;overflow-wrap:anywhere}\n.feature-case-row{border-left:3px solid transparent}\n.feature-case-row:hover{background:#152341}\n.feature-bugs{min-width:160px}\n.feature-bugs .bug-link{margin:1px 4px 1px 0}\n@media(max-width:720px){.suite-toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}.suite-toolbar>input{grid-column:1/-1}.feature-group-body{padding-left:10px}.feature-summary{padding:12px 10px}}";
  D.CSS += "\n.dashboard-main{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:start;min-width:0}\n#panels{min-width:0}\n.tabs{display:flex;flex-direction:column;flex-wrap:nowrap;align-items:center;gap:4px;width:64px;min-width:64px;padding:10px 6px 60px 8px}\n.tab{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:50px;min-width:50px;max-width:50px;min-height:72px;height:auto;padding:8px 5px;border:1px solid #1e2b45;border-radius:6px;background:#111d33;color:#9fb3d0;writing-mode:vertical-rl;text-orientation:mixed;white-space:nowrap;font-size:11px;line-height:1.1}\n.tab.active{background:#16243d;color:#fff;font-weight:600;box-shadow:inset 3px 0 0 #38bdf8}\n.panel{min-width:0;padding:16px 20px 60px 14px}\n@media(max-width:720px){.dashboard-main{grid-template-columns:54px minmax(0,1fr)}.tabs{width:54px;min-width:54px;padding:8px 4px 40px}.tab{width:44px;min-width:44px;max-width:44px;min-height:66px;padding:7px 4px;font-size:10px}.panel{padding:12px 10px 50px 8px}}";
  D.CSS += "\n:root{--dvdash-controls-height:52px}\n.tabs{position:sticky;top:calc(var(--dvdash-controls-height) + 8px);align-self:start;z-index:12;max-height:calc(100vh - var(--dvdash-controls-height) - 16px);overflow-y:auto;scrollbar-width:thin}\n.panel-sticky,.suite-sticky{position:sticky;top:var(--dvdash-controls-height);z-index:11;background:#0b1220;padding-top:8px;padding-bottom:12px;box-shadow:0 12px 18px rgba(3,8,18,.42)}\n.panel-sticky>.cards,.suite-sticky>.cards{margin-bottom:0}\n@media(max-width:980px), (max-height:700px){.panel-sticky,.suite-sticky{position:static;box-shadow:none;padding-top:0}}\n@media(max-width:720px){.tabs{top:calc(var(--dvdash-controls-height) + 6px);max-height:calc(100vh - var(--dvdash-controls-height) - 12px)}}";
  D.CSS += "\n.insights-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:4px 0 14px}.trend-scroll{max-width:100%;overflow-x:auto}.trend-scroll>svg{min-width:720px}.trend-table-details,.change-group{margin-top:10px;border-top:1px solid #1c2942;padding-top:6px}.trend-table-details>summary,.change-group>summary{cursor:pointer;color:#7dd3fc;font-size:12px;font-weight:600;min-height:32px;display:flex;align-items:center}.table-scroll{max-width:100%;overflow:auto}.table-scroll>table{min-width:760px}.change-list{display:grid;gap:5px;padding:5px 0}.change-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:7px 8px;border:1px solid #1c2942;border-radius:7px;background:#0f1a2e}.change-title{flex:1;min-width:220px;color:#d7e3f4}.change-state{font-size:11px;color:#f8d4a2;font-weight:700}.result-link{white-space:nowrap}@media(max-width:720px){.insights-toolbar>*{width:100%}.trend-scroll>svg{min-width:660px}.change-title{min-width:150px}}";
  D.CSS += "\n.query-control{display:inline-flex;gap:6px;align-items:center}.query-control select{min-width:260px;max-width:420px}.query-modal-backdrop{position:fixed;inset:0;z-index:200;background:rgba(3,8,18,.78);display:flex;align-items:center;justify-content:center;padding:20px}.query-modal{width:min(760px,100%);max-height:calc(100vh - 40px);overflow:auto;background:#101b30;border:1px solid #35527a;border-radius:12px;padding:18px;box-shadow:0 24px 80px rgba(0,0,0,.58)}.query-modal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.query-modal h2{margin:0;font-size:18px}.query-form{display:grid;grid-template-columns:minmax(160px,.7fr) minmax(300px,1.6fr) auto;gap:10px;align-items:end;padding:12px;border:1px solid #253858;border-radius:9px;background:#0c1729}.query-form label{display:grid;gap:5px;color:#9fb3d0;font-size:11px}.query-form input{width:100%;min-width:0}.query-help{margin:8px 0 12px;color:#8fa3c0;font-size:11px}.query-list{display:grid;gap:7px}.query-list-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid #253858;border-radius:8px;background:#0f1a2e}.query-list-name{font-weight:700;color:#dbeafe;overflow-wrap:anywhere}.query-list-meta{margin-top:3px;color:#8fa3c0;font-size:11px;overflow-wrap:anywhere}.query-error{min-height:18px;margin-top:8px;color:#fda4af;font-size:12px}@media(max-width:900px){.query-control select{min-width:190px;max-width:300px}.query-form{grid-template-columns:1fr}.query-form button{width:100%}}@media(max-width:620px){.query-control{width:100%}.query-control select{flex:1;min-width:0;max-width:none}.query-modal-backdrop{padding:8px}.query-modal{max-height:calc(100vh - 16px);padding:12px}}";
  D.card = function (k, v, tone) {
    var c = D.el('div', 'card');
    if (tone) {
      c.style.borderLeft = '4px solid ' + tone;
      c.style.background = 'linear-gradient(135deg,' + D.rgba(tone, .17) + ',rgba(17,29,51,.98) 68%)';
    }
    c.appendChild(D.el('div', 'k', k));
    var val = D.el('div', 'v', v == null ? '-' : String(v)); c.appendChild(val); c._val = val;
    return c;
  };
  D.fitCardValues = function () {
    Array.prototype.forEach.call(document.querySelectorAll('.panel.active .card .v'), function (value) {
      if (!value.clientWidth) return;
      var size = 22, minimum = 15;
      value.style.fontSize = size + 'px';
      while (size > minimum && value.scrollWidth > value.clientWidth) {
        size -= 1;
        value.style.fontSize = size + 'px';
      }
    });
  };
  D.box = function (title) { var b = D.el('div', 'box'); if (title) b.appendChild(D.el('h3', null, title)); return b; };
  D.bugTable = function (cases) {
    var grouped = {};
    cases.forEach(function (testCase) {
      (testCase.bugs || []).forEach(function (bug) {
        if (!grouped[bug.id]) grouped[bug.id] = { bug: bug, cases: [] };
        grouped[bug.id].cases.push(testCase);
      });
    });
    var t = D.el('table'), thead = D.el('thead'), hr = D.el('tr');
    ['Bug', 'State', 'Severity', 'Priority', 'Title', 'Linked Test Cases'].forEach(function (h) { hr.appendChild(D.el('th', null, h)); });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = D.el('tbody'), ids = Object.keys(grouped).sort(function (a, b) { return +a - +b; });
    if (!ids.length) {
      var er = D.el('tr'), td = D.el('td', 'empty', 'No linked Bugs found yet. This tracking area is reserved and will populate automatically from Test Case work item Links.');
      td.colSpan = 6; er.appendChild(td); tb.appendChild(er);
    }
    ids.forEach(function (id) {
      var entry = grouped[id], tr = D.el('tr');
      var bugCell = D.el('td'); bugCell.appendChild(D.bugLink(entry.bug)); tr.appendChild(bugCell);
      var stateCell = D.el('td'); stateCell.appendChild(D.chip(entry.bug.state)); tr.appendChild(stateCell);
      tr.appendChild(D.el('td', null, D.severityInfo(entry.bug.severity).label));
      var priority = D.priorityLevel(entry.bug.priority);
      tr.appendChild(D.el('td', null, priority ? 'P' + priority : 'Not set'));
      tr.appendChild(D.el('td', null, entry.bug.title));
      var casesCell = D.el('td');
      entry.cases.forEach(function (testCase, index) {
        if (index) casesCell.appendChild(document.createTextNode(', '));
        var link = D.el('a', 'caseid', '#' + testCase.id); link.href = D.wiUrl(testCase.id); link.target = '_blank'; link.rel = 'noopener';
        casesCell.appendChild(link);
      });
      tr.appendChild(casesCell); tb.appendChild(tr);
    });
    t.appendChild(tb); return t;
  };
  D.statsTable = function (counts) {
    var total = D.sum(counts), t = D.el('table'), thead = D.el('thead'), hr = D.el('tr');
    ['State', 'Count', 'Share', ''].forEach(function (h, i) { hr.appendChild(D.el('th', (i === 1 || i === 2) ? 'num' : null, h)); });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = D.el('tbody'), keys = D.orderStates(Object.keys(counts));
    if (!keys.length) { var er = D.el('tr'), td = D.el('td', 'empty', 'No data in the selected time range'); td.colSpan = 4; er.appendChild(td); tb.appendChild(er); }
    keys.forEach(function (k) {
      var tr = D.el('tr'), td1 = D.el('td'); td1.appendChild(D.chip(k)); tr.appendChild(td1);
      tr.appendChild(D.el('td', 'num', String(counts[k])));
      tr.appendChild(D.el('td', 'num', total ? (counts[k] * 100 / total).toFixed(1) + '%' : '-'));
      var td4 = D.el('td'), bar = D.el('div', 'bar'), seg = D.el('div');
      seg.style.width = (total ? counts[k] * 100 / total : 0) + '%'; seg.style.background = D.colorFor(k);
      bar.appendChild(seg); td4.appendChild(bar); tr.appendChild(td4); tb.appendChild(tr);
    });
    var tr2 = D.el('tr', 'total');
    tr2.appendChild(D.el('td', null, 'Total'));
    tr2.appendChild(D.el('td', 'num', String(total)));
    tr2.appendChild(D.el('td', 'num', total ? '100%' : '-'));
    tr2.appendChild(D.el('td'));
    tb.appendChild(tr2); t.appendChild(tb); return t;
  };
  D.bugLink = function (bug) {
    var link = D.el('a', 'bug-link', 'BUG #' + bug.id);
    link.href = D.wiUrl(bug.id); link.target = '_blank'; link.rel = 'noopener';
    link.title = (bug.state || 'Unknown state') + ' · ' + (bug.title || ('Bug #' + bug.id));
    return link;
  };
  D.caseRow = function (n) {
    var row = D.el('div', 'caserow'); row._case = n;
    D.decorateBlock(row, n.type || 'Test Case', n.state);
    var a = D.el('a', 'caseid', '#' + n.id); a.href = D.wiUrl(n.id); a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a);
    row.appendChild(D.typeBadge(n.type || 'Test Case'));
    row.appendChild(D.el('span', 'casetitle', n.title));
    row.appendChild(D.chip(n.state));
    row.appendChild(D.testResultBadge(n.latestResult));
    var metrics = n.metrics || {};
    if (D.hasMetric(metrics.priority)) row.appendChild(D.metricBadge('Priority', 'P' + (D.priorityLevel(metrics.priority) || metrics.priority), '#c084fc'));
    if (D.hasMetric(metrics.sampleSize)) row.appendChild(D.metricBadge('Sample', metrics.sampleSize, '#38bdf8'));
    if (D.hasMetric(metrics.testDuration)) row.appendChild(D.metricBadge('Duration', metrics.testDuration, '#fbbf24'));
    (n.bugs || []).forEach(function (bug) { row.appendChild(D.bugLink(bug)); });
    if (n.assigned) row.appendChild(D.el('span', 'date', n.assigned));
    row.appendChild(D.el('span', 'date', D.fmt(n.changed)));
    return row;
  };
  D.tree = function (node, level) {
    if (node.type === 'Test Case') return D.caseRow(node);
    var d = D.el('details', 'node lvl' + Math.min(level, 3)), sm = D.el('summary');
    D.decorateBlock(d, node.type, node.state);
    sm.appendChild(D.el('span', 'ntitle', node.title));
    sm.appendChild(D.typeBadge(node.type));
    sm.appendChild(D.el('span', 'spacer'));
    var cases = D.collect(node, 'Test Case');
    if (cases.length) {
      var m = D.countStates(cases);
      D.orderStates(Object.keys(m)).forEach(function (k) { sm.appendChild(D.chip(k, m[k])); });
      sm.appendChild(D.el('span', 'small', cases.length + ' cases'));
    } else { sm.appendChild(D.chip(node.state)); }
    var lk = D.el('a', 'small', '↗'); lk.href = D.wiUrl(node.id); lk.target = '_blank'; lk.rel = 'noopener';
    lk.title = 'Open in Azure DevOps #' + node.id;
    lk.addEventListener('click', function (e) { e.stopPropagation(); });
    sm.appendChild(lk); d.appendChild(sm);
    var body = D.el('div', 'nodebody');
    (node.children || []).forEach(function (c) { body.appendChild(D.tree(c, level + 1)); });
    d.appendChild(body); return d;
  };
  D.applyFilter = function (panel, text) {
    text = (text || '').trim().toLowerCase();
    panel.querySelectorAll('.caserow').forEach(function (row) {
      var n = row._case;
      var bugText = (n.bugs || []).map(function (bug) { return ' bug #' + bug.id + ' ' + bug.title + ' ' + bug.state; }).join('');
      var metricText = Object.keys(n.metrics || {}).map(function (key) { return ' ' + key + ' ' + n.metrics[key]; }).join('');
      var resultText = n.latestResult ? (' test result ' + n.latestResult.outcome + ' run ' + n.latestResult.runId + ' ' + n.latestResult.runName) : ' no test result';
      var hit = !text || (n.title + ' #' + n.id + ' ' + n.state + bugText + metricText + resultText).toLowerCase().indexOf(text) >= 0;
      row.classList.toggle('hide', !hit);
    });
    var ds = panel.querySelectorAll('details.node');
    for (var j = ds.length - 1; j >= 0; j--) {
      var vis = ds[j].querySelectorAll('.caserow:not(.hide)').length;
      ds[j].classList.toggle('hide', !!text && vis === 0);
      if (text && vis > 0) ds[j].open = true;
    }
  };
  D.featureInventory = function () {
    var rack = D.S.racks[0], groups = [], byKey = {};
    if (!rack) return groups;
    function groupFor(feature) {
      var key = feature ? String(feature.id) : 'unmapped';
      if (!byKey[key]) {
        var name = feature ? feature.title.replace(/^(\[[^\]]*\]\s*)+/, '').trim() : 'Unmapped';
        byKey[key] = { id: key, name: name || ('Feature #' + feature.id), feature: feature, cases: [] };
        groups.push(byKey[key]);
      }
      return byKey[key];
    }
    function visit(node, currentFeature) {
      var feature = currentFeature;
      if (node !== rack && node.type === 'Feature') feature = node;
      if (node.type === 'Test Case') groupFor(feature).cases.push({ testCase: node, rack: rack, feature: feature });
      (node.children || []).forEach(function (child) { visit(child, feature); });
    }
    visit(rack, null);
    return groups;
  };
  D.xmlEsc = function (value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  };
  D.suiteExportRows = function () {
    var rows = [];
    D.featureInventory().forEach(function (group) {
      group.cases.forEach(function (entry) {
        var testCase = entry.testCase, fields = testCase.suiteFields || {}, metrics = testCase.metrics || {};
        rows.push({
          rack: entry.rack.label, id: testCase.id, title: testCase.title, feature: group.name, state: testCase.state,
          changed: D.fmt(testCase.changed),
          priority: D.hasMetric(metrics.priority) ? ('P' + (D.priorityLevel(metrics.priority) || metrics.priority)) : '-',
          sampleSize: D.displayFieldValue(metrics.sampleSize), cycles: D.displayFieldValue(metrics.numberOfCycles), duration: D.displayFieldValue(metrics.testDuration),
          scriptType: D.displayFieldValue(fields.scriptType), crcSdk: D.displayFieldValue(fields.crcSdk), igsOwner: D.displayFieldValue(fields.igsOwner),
          bugs: (testCase.bugs || []).map(function (bug) { return 'BUG #' + bug.id + (bug.title ? ' - ' + bug.title : ''); }).join('; ') || '-',
          comments: D.displayFieldValue(fields.comments), url: D.wiUrl(testCase.id)
        });
      });
    });
    return rows;
  };
  D.suiteXlsx = function () {
    var rows = D.suiteExportRows();
    var headers = ['Rack', 'Case ID', 'Title', 'Test Feature', 'State', 'Changed Date', 'Priority', 'Sample Size', 'Number of Cycles', 'Test Duration', 'Script type', 'CRC SDK', 'IGS Owner', 'Linked Bugs', 'Comments', 'Azure DevOps URL'];
    var widths = [70, 72, 360, 90, 90, 110, 60, 80, 90, 95, 80, 80, 110, 240, 260, 300];
    var dataRows = rows.map(function (row) { return [row.rack, { value: row.id, href: row.url }, row.title, row.feature, row.state, row.changed, row.priority, row.sampleSize, row.cycles, row.duration, row.scriptType, row.crcSdk, row.igsOwner, row.bugs, row.comments, { value: row.url, href: row.url }]; });
    return { bytes: D.xlsxWorkbook([{ name: 'Rack 1 Features', headers: headers, rows: dataRows, widths: widths }]), count: rows.length };
  };
  D.exportSuiteExcel = function () {
    var result = D.suiteXlsx(), now = new Date();
    function pad(value) { return value < 10 ? '0' + value : String(value); }
    var stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes());
    D.downloadBlob(result.bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', D.reportPrefix() + '-Rack1-Test-Features-' + stamp + '.xlsx');
    D.setStatus('Downloaded unfrozen XLSX workbook with ' + result.count + ' Rack 1 Test Feature case rows.', 'info');
  };
  D.featureCaseTable = function (entries, featureName) {
    var scroll = D.el('div', 'feature-table-scroll');
    var table = D.el('table', 'feature-table'), thead = D.el('thead'), header = D.el('tr');
    ['ID', 'Title', 'State', 'Latest Test Result', 'Changed', 'Priority', 'Sample Size', 'Cycles', 'Duration', 'Script type', 'CRC SDK', 'IGS Owner', 'Linked Bugs', 'Comments'].forEach(function (label) { header.appendChild(D.el('th', null, label)); });
    thead.appendChild(header); table.appendChild(thead);
    var tbody = D.el('tbody');
    entries.forEach(function (entry) {
      var testCase = entry.testCase, fields = testCase.suiteFields || {}, metrics = testCase.metrics || {};
      var row = D.el('tr', 'feature-case-row'); row.style.borderLeftColor = D.colorFor(testCase.state);
      row.title = 'Rack: ' + entry.rack.label + ' · Feature: ' + featureName + ' · State: ' + testCase.state;
      var idCell = D.el('td', 'feature-id'), idLink = D.el('a', 'caseid', String(testCase.id));
      idLink.href = D.wiUrl(testCase.id); idLink.target = '_blank'; idLink.rel = 'noopener'; idCell.appendChild(idLink); row.appendChild(idCell);
      row.appendChild(D.el('td', 'feature-title', testCase.title));
      var stateCell = D.el('td'); stateCell.appendChild(D.chip(testCase.state)); row.appendChild(stateCell);
      var resultCell = D.el('td', 'result-link');
      if (testCase.latestResult) { var resultLink = D.el('a', null, testCase.latestResult.outcome + ' · Run #' + testCase.latestResult.runId); resultLink.href = testCase.latestResult.runUrl; resultLink.target = '_blank'; resultLink.rel = 'noopener'; resultCell.appendChild(resultLink); }
      else resultCell.textContent = 'No result';
      row.appendChild(resultCell);
      row.appendChild(D.el('td', null, D.fmt(testCase.changed)));
      var priority = D.priorityLevel(metrics.priority);
      row.appendChild(D.el('td', null, D.hasMetric(metrics.priority) ? (priority ? 'P' + priority : D.displayFieldValue(metrics.priority)) : '-'));
      row.appendChild(D.el('td', null, D.displayFieldValue(metrics.sampleSize)));
      row.appendChild(D.el('td', null, D.displayFieldValue(metrics.numberOfCycles)));
      row.appendChild(D.el('td', null, D.displayFieldValue(metrics.testDuration)));
      row.appendChild(D.el('td', null, D.displayFieldValue(fields.scriptType)));
      row.appendChild(D.el('td', null, D.displayFieldValue(fields.crcSdk)));
      row.appendChild(D.el('td', 'feature-owner', D.displayFieldValue(fields.igsOwner)));
      var bugs = D.el('td', 'feature-bugs');
      if ((testCase.bugs || []).length) (testCase.bugs || []).forEach(function (bug) { bugs.appendChild(D.bugLink(bug)); });
      else bugs.textContent = '-';
      row.appendChild(bugs);
      var comments = D.displayFieldValue(fields.comments), commentsCell = D.el('td', 'feature-comments', comments);
      commentsCell.title = comments === '-' ? '' : comments; row.appendChild(commentsCell);
      row._featureSearch = [testCase.id, testCase.title, featureName, entry.rack.label, testCase.state, testCase.latestResult && testCase.latestResult.outcome, testCase.latestResult && testCase.latestResult.runId, metrics.priority,
        metrics.sampleSize, metrics.numberOfCycles, metrics.testDuration, D.fmt(testCase.changed),
        (testCase.bugs || []).map(function (bug) { return 'BUG #' + bug.id + ' ' + bug.title + ' ' + bug.state; }).join(' '),
        D.displayFieldValue(fields.scriptType), D.displayFieldValue(fields.crcSdk), D.displayFieldValue(fields.igsOwner), comments].join(' ').toLowerCase();
      tbody.appendChild(row);
    });
    table.appendChild(tbody); scroll.appendChild(table); return scroll;
  };
  D.suitePanel = function () {
    var wrap = D.el('div'), groups = D.featureInventory(), allEntries = [];
    groups.forEach(function (group) { allEntries = allEntries.concat(group.cases); });
    var rackCaseCount = D.S.racks[0] ? D.collect(D.S.racks[0], 'Test Case').length : 0;
    var unmapped = (groups.filter(function (group) { return group.name === 'Unmapped'; })[0] || { cases: [] }).cases.length;
    var sticky = D.el('div', 'suite-sticky'), cards = D.el('div', 'cards');
    [
      D.card('RACK 1 TEST FEATURES', groups.filter(function (group) { return group.name !== 'Unmapped'; }).length, '#38bdf8'),
      D.card('RACK 1 CASES', rackCaseCount, '#34d399'),
      D.card('LISTED / RACK 1 CASES', allEntries.length + ' / ' + rackCaseCount, allEntries.length === rackCaseCount ? '#34d399' : '#fb7185'),
      D.card('UNMAPPED CASES', unmapped, unmapped ? '#fb7185' : '#2dd4bf')
    ].forEach(function (card) { cards.appendChild(card); });
    sticky.appendChild(cards); wrap.appendChild(sticky);
    wrap.appendChild(D.el('p', 'suite-intro', 'This list is rebuilt directly from the current Rack 1 Feature hierarchy after every query. Every Rack 1 Test Case is grouped under its nearest parent Test Feature and uses the same live State, Bug and metric data as the Rack 1 tab.'));
    var toolbar = D.el('div', 'suite-toolbar');
    var expand = D.el('button', null, 'Expand all'), collapse = D.el('button', null, 'Collapse all');
    var download = D.el('button', 'primary', 'Download Excel (.xlsx)'), search = D.el('input');
    download.id = 'suiteExcelBtn'; download.title = 'Download all Rack 1 Test Feature case fields for Excel';
    search.placeholder = 'Search feature / case / state / field …';
    toolbar.appendChild(expand); toolbar.appendChild(collapse); toolbar.appendChild(download); toolbar.appendChild(search); wrap.appendChild(toolbar);
    var groupsHost = D.el('div', 'feature-groups'); wrap.appendChild(groupsHost);
    groups.forEach(function (group, index) {
      var details = D.el('details', 'feature-group'); if (index === 0) details.open = true;
      var summary = D.el('summary', 'feature-summary');
      summary.appendChild(D.el('span', 'feature-group-name', group.name)); summary.appendChild(D.el('span', 'suite-pill', group.cases.length + ' cases'));
      details.appendChild(summary);
      var body = D.el('div', 'feature-group-body'); body.appendChild(D.featureCaseTable(group.cases, group.name)); details.appendChild(body);
      groupsHost.appendChild(details);
    });
    expand.addEventListener('click', function () { wrap.querySelectorAll('details.feature-group').forEach(function (details) { details.open = true; }); });
    collapse.addEventListener('click', function () { wrap.querySelectorAll('details.feature-group').forEach(function (details) { details.open = false; }); });
    download.addEventListener('click', function () { D.exportSuiteExcel(); });
    search.addEventListener('input', function () { D.applySuiteFilter(wrap, search.value); });
    return wrap;
  };
  D.applySuiteFilter = function (panel, text) {
    text = String(text || '').trim().toLowerCase();
    panel.querySelectorAll('.feature-case-row').forEach(function (row) { row.classList.toggle('hide', !!text && row._featureSearch.indexOf(text) < 0); });
    panel.querySelectorAll('.feature-group').forEach(function (group) {
      var visible = group.querySelectorAll('.feature-case-row:not(.hide)').length;
      group.classList.toggle('hide', !!text && !visible);
      if (text && visible) group.open = true;
    });
  };
  D.rackTable = function () {
    var stateSet = {};
    var rows = D.S.racks.map(function (r) {
      var m = D.countStates(D.collect(r, 'Test Case').filter(D.inRange));
      for (var k in m) stateSet[k] = 1; return { r: r, m: m };
    });
    var states = D.orderStates(Object.keys(stateSet));
    if (!states.length) return D.el('div', 'empty', 'No data in the selected time range');
    var t = D.el('table'), thead = D.el('thead'), hr = D.el('tr');
    hr.appendChild(D.el('th', null, 'Rack'));
    states.forEach(function (s) { hr.appendChild(D.el('th', 'num', s)); });
    hr.appendChild(D.el('th', 'num', 'Total')); thead.appendChild(hr); t.appendChild(thead);
    var tb = D.el('tbody'), totals = {}, grand = 0;
    rows.forEach(function (row) {
      var tr = D.el('tr'), td0 = D.el('td');
      var a = D.el('a', null, row.r.label + ' — ' + row.r.title.replace(/^(\[[^\]]*\]\s*)+/, ''));
      a.href = D.wiUrl(row.r.id); a.target = '_blank'; a.rel = 'noopener'; td0.appendChild(a); tr.appendChild(td0);
      var tot = 0;
      states.forEach(function (s) { var v = row.m[s] || 0; tot += v; totals[s] = (totals[s] || 0) + v; tr.appendChild(D.el('td', 'num', String(v))); });
      grand += tot; tr.appendChild(D.el('td', 'num', String(tot))); tb.appendChild(tr);
    });
    var tr2 = D.el('tr', 'total'); tr2.appendChild(D.el('td', null, 'Total'));
    states.forEach(function (s) { tr2.appendChild(D.el('td', 'num', String(totals[s] || 0))); });
    tr2.appendChild(D.el('td', 'num', String(grand))); tb.appendChild(tr2); t.appendChild(tb); return t;
  };
  D.updateStickyOffset = function () {
    var controls = document.querySelector('.controls');
    if (controls) document.documentElement.style.setProperty('--dvdash-controls-height', Math.ceil(controls.getBoundingClientRect().height) + 'px');
    requestAnimationFrame(D.fitCardValues);
  };
  D.installStickyOffset = function () {
    if (window.__dvdashControlsObserver && window.__dvdashControlsObserver.disconnect) window.__dvdashControlsObserver.disconnect();
    if (window.__dvdashStickyResize) window.removeEventListener('resize', window.__dvdashStickyResize);
    window.__dvdashStickyResize = D.updateStickyOffset; window.addEventListener('resize', window.__dvdashStickyResize);
    if (window.ResizeObserver) {
      window.__dvdashControlsObserver = new ResizeObserver(D.updateStickyOffset);
      var controls = document.querySelector('.controls'); if (controls) window.__dvdashControlsObserver.observe(controls);
    }
    D.updateStickyOffset(); requestAnimationFrame(D.updateStickyOffset);
  };
  D.refreshQuerySelector = function () {
    var select = document.getElementById('querySel'); if (!select) return;
    select.innerHTML = '';
    (D.S.queries || []).forEach(function (query) {
      var option = D.el('option', null, query.name + ' · ' + query.project); option.value = D.queryKey(query);
      if (option.value === D.S.activeQueryKey) option.selected = true;
      select.appendChild(option);
    });
  };
  D.updateIdentity = function () {
    var query = D.activeQuery(), rackText = D.S.racks.length ? (' — ' + D.S.racks.length + ' Racks Test Status Dashboard') : ' — Test Status Dashboard';
    document.title = query.name + ' — Test Status Dashboard';
    var title = document.getElementById('dashboardTitle'); if (title) title.textContent = query.name + rackText;
    var source = document.getElementById('querySource');
    if (source) { source.textContent = 'Azure DevOps Query: ' + query.name; source.href = query.queryUrl; }
    D.refreshQuerySelector();
  };
  D.switchQuery = function (key) {
    var query = (D.S.queries || []).filter(function (item) { return D.queryKey(item) === key; })[0]; if (!query) return;
    D.applyQuery(query, true); D.S.active = 0; D.S.racks = []; D.S.loadedAt = null; D.S.snapshotComparison = null;
    D.updateIdentity(); D.buildPanels(); D.load();
  };
  D.openQueryManager = function () {
    var old = document.querySelector('.query-modal-backdrop'); if (old) old.remove();
    var backdrop = D.el('div', 'query-modal-backdrop'), modal = D.el('section', 'query-modal');
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'queryManagerTitle');
    var head = D.el('div', 'query-modal-head'), title = D.el('h2', null, 'Manage Azure DevOps Queries'); title.id = 'queryManagerTitle'; head.appendChild(title);
    var close = D.el('button', null, 'Close'); close.addEventListener('click', function () { backdrop.remove(); }); head.appendChild(close); modal.appendChild(head);
    var form = D.el('div', 'query-form'), nameLabel = D.el('label', null, 'Display name (optional)'), nameInput = D.el('input'); nameInput.placeholder = 'Example: C4144 DV-Scale'; nameLabel.appendChild(nameInput);
    var urlLabel = D.el('label', null, 'Azure DevOps Query URL'), urlInput = D.el('input'); urlInput.placeholder = 'https://azurecsi.visualstudio.com/Project/_queries/query/{id}/'; urlLabel.appendChild(urlInput);
    var add = D.el('button', 'primary', 'Add Query'); form.appendChild(nameLabel); form.appendChild(urlLabel); form.appendChild(add); modal.appendChild(form);
    modal.appendChild(D.el('p', 'query-help', 'Queries are saved only in this browser. The dashboard performs read-only API calls and never changes the Query or any work item.'));
    var error = D.el('div', 'query-error'); modal.appendChild(error);
    var list = D.el('div', 'query-list'); modal.appendChild(list);
    function renderList() {
      list.innerHTML = '';
      (D.S.queries || []).forEach(function (query) {
        var row = D.el('div', 'query-list-row'), info = D.el('div'), name = D.el('div', 'query-list-name', query.name + (D.queryKey(query) === D.S.activeQueryKey ? ' · Active' : ''));
        info.appendChild(name); info.appendChild(D.el('div', 'query-list-meta', query.orgName + ' / ' + query.project + ' / ' + query.queryId)); row.appendChild(info);
        if (query.builtin) row.appendChild(D.el('span', 'small', 'Built in'));
        else {
          var remove = D.el('button', null, 'Remove'); remove.addEventListener('click', function () {
            var wasActive = D.queryKey(query) === D.S.activeQueryKey;
            D.S.queries = D.S.queries.filter(function (item) { return D.queryKey(item) !== D.queryKey(query); }); D.saveQueryCatalog();
            if (wasActive) { D.applyQuery(D.S.queries[0], true); D.S.active = 0; D.updateIdentity(); D.load(); }
            renderList(); D.refreshQuerySelector();
          }); row.appendChild(remove);
        }
        list.appendChild(row);
      });
    }
    add.addEventListener('click', function () {
      error.textContent = '';
      try {
        var query = D.parseQueryUrl(urlInput.value, nameInput.value), key = D.queryKey(query);
        if ((D.S.queries || []).some(function (item) { return D.queryKey(item) === key; })) throw new Error('This Query is already in the selector.');
        D.S.queries.push(query); D.saveQueryCatalog(); D.refreshQuerySelector(); renderList(); nameInput.value = ''; urlInput.value = '';
        D.setStatus('Added Query "' + query.name + '" to this browser. Select it from the Query menu to load its dashboard.', 'info');
      } catch (addError) { error.textContent = String((addError && addError.message) || addError); }
    });
    backdrop.addEventListener('click', function (event) { if (event.target === backdrop) backdrop.remove(); });
    renderList(); backdrop.appendChild(modal); document.body.appendChild(backdrop); urlInput.focus();
  };
  D.buildShell = function () {
    document.head.innerHTML = ''; document.body.innerHTML = '';
    document.title = D.activeQuery().name + ' — Test Status Dashboard';
    var st = D.el('style'); st.textContent = D.CSS; document.head.appendChild(st);
    var mc = D.el('meta'); mc.setAttribute('charset', 'utf-8'); document.head.appendChild(mc);

    var header = D.el('header');
    var left = D.el('div');
    var dashboardTitle = D.el('h1', null, D.activeQuery().name + ' — Test Status Dashboard'); dashboardTitle.id = 'dashboardTitle'; left.appendChild(dashboardTitle);
    var sub = D.el('div', 'sub');
    sub.appendChild(document.createTextNode('Source: '));
    var qa = D.el('a', null, 'Azure DevOps Query: ' + D.activeQuery().name); qa.id = 'querySource';
    qa.href = D.CFG.queryUrl; qa.target = '_blank'; qa.rel = 'noopener'; sub.appendChild(qa);
    sub.appendChild(document.createTextNode(' ·  Every open / refresh of this page re-runs the query using the selected mode'));
    left.appendChild(sub); header.appendChild(left);
    var right = D.el('div'); right.style.display = 'flex'; right.style.gap = '8px'; right.style.alignItems = 'center'; right.style.flexWrap = 'wrap';
    var upd = D.el('span', 'sub', 'Updated: —'); upd.id = 'updated'; right.appendChild(upd);
    var rb = D.el('button', 'primary', 'Re-run query'); rb.id = 'reloadBtn'; right.appendChild(rb);
    var eb = D.el('button', null, 'Export offline snapshot .html'); eb.id = 'exportBtn'; right.appendChild(eb);
    header.appendChild(right); document.body.appendChild(header);

    var ctl = D.el('div', 'controls');
    var queryControl = D.el('span', 'query-control'), queryLabel = D.el('label', null, 'Query'), querySelect = D.el('select'); querySelect.id = 'querySel'; queryLabel.appendChild(querySelect);
    var queryManage = D.el('button', null, 'Add / manage'); queryManage.id = 'queryManageBtn'; queryControl.appendChild(queryLabel); queryControl.appendChild(queryManage); ctl.appendChild(queryControl); D.refreshQuerySelector();
    var l0 = D.el('label', null, 'Data source');
    var ms = D.el('select'); ms.id = 'modeSel';
    D.MODES.forEach(function (o) { var op = D.el('option', null, o[1]); op.value = o[0]; if (o[0] === D.S.mode) op.selected = true; ms.appendChild(op); });
    l0.appendChild(ms); ctl.appendChild(l0);

    var pw = D.el('span'); pw.id = 'proxyWrap';
    pw.style.display = D.S.mode === 'proxy' ? 'inline-flex' : 'none';
    pw.style.gap = '6px'; pw.style.alignItems = 'center';
    var pi = D.el('input'); pi.id = 'proxyInput'; pi.value = D.getProxy(); pi.placeholder = 'http://localhost:8080'; pi.style.minWidth = '210px';
    var ps = D.el('button', null, 'Save proxy'); ps.id = 'proxySave';
    pw.appendChild(pi); pw.appendChild(ps); ctl.appendChild(pw);

    var l1 = D.el('label', null, 'Time range (by Changed Date)');
    var rs = D.el('select'); rs.id = 'rangeSel';
    D.RANGES.forEach(function (o) { var op = D.el('option', null, o[1]); op.value = o[0]; if (o[0] === D.S.range) op.selected = true; rs.appendChild(op); });
    l1.appendChild(rs); ctl.appendChild(l1);
    var l2 = D.el('label', null, 'Chart type');
    var ts = D.el('select'); ts.id = 'typeSel';
    [['pie', 'Pie chart'], ['bar', 'Bar chart']].forEach(function (o) { var op = D.el('option', null, o[1]); op.value = o[0]; if (o[0] === D.S.chartType) op.selected = true; ts.appendChild(op); });
    l2.appendChild(ts); ctl.appendChild(l2);
    var l3 = D.el('label', null, ' Auto refresh every 5 min');
    var cb = D.el('input'); cb.type = 'checkbox'; cb.id = 'autoRef'; cb.style.minWidth = 'auto';
    l3.insertBefore(cb, l3.firstChild); ctl.appendChild(l3);
    ctl.appendChild(D.el('span', 'spacer'));
    var lg = D.el('span', 'small'); lg.appendChild(document.createTextNode('State colours: '));
    ['Not Started', 'In Progress', 'Passed', 'Failed', 'Blocked'].forEach(function (s) { lg.appendChild(D.chip(s)); lg.appendChild(document.createTextNode(' ')); });
    ctl.appendChild(lg);
    var tl = D.el('span', 'small colour-key'); tl.appendChild(document.createTextNode('Work item colours: '));
    ['Feature', 'System Requirement', 'Test Case'].forEach(function (type) { tl.appendChild(D.typeBadge(type)); });
    ctl.appendChild(tl);
    document.body.appendChild(ctl); D.refreshQuerySelector();
    D.installStickyOffset();

    var banner = D.el('div', 'banner info', 'Preparing to load…'); banner.id = 'banner'; document.body.appendChild(banner);
    var main = D.el('main', 'dashboard-main');
    var tabs = D.el('div', 'tabs'); tabs.id = 'tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-orientation', 'vertical'); main.appendChild(tabs);
    var panels = D.el('div'); panels.id = 'panels'; main.appendChild(panels);
    document.body.appendChild(main);

    querySelect.addEventListener('change', function (event) { D.switchQuery(event.target.value); });
    queryManage.addEventListener('click', D.openQueryManager);
    ms.addEventListener('change', function (e) {
      D.S.mode = e.target.value;
      try { localStorage.setItem('dvdashMode', D.S.mode); } catch (err) { }
      document.getElementById('proxyWrap').style.display = D.S.mode === 'proxy' ? 'inline-flex' : 'none';
      D.updateStickyOffset();
      D.load();
    });
    ps.addEventListener('click', function () {
      var v = document.getElementById('proxyInput').value.trim();
      if (v) { try { localStorage.setItem('dvdashProxy', v); } catch (err) { } D.load(); }
    });
    rs.addEventListener('change', function (e) { D.S.range = e.target.value; D.refresh(); });
    ts.addEventListener('change', function (e) { D.S.chartType = e.target.value; D.refresh(); });
    rb.addEventListener('click', function () { D.load(); });
    eb.addEventListener('click', function () { D.exportHtml(); });
    if (!D._timer) D._timer = setInterval(function () { var c = document.getElementById('autoRef'); if (c && c.checked && D.S.mode !== 'snapshot') D.load(); }, 300000);
  };
  D.buildPanels = function () {
    D.updateIdentity();
    var tabsBar = document.getElementById('tabs'), host = document.getElementById('panels');
    tabsBar.innerHTML = ''; host.innerHTML = ''; D.S.panels = [];
    var defs = [{ kind: 'ov', label: 'Overview (' + D.S.racks.length + ' Racks)' }]
      .concat(D.S.racks.map(function (r) { return { kind: 'rack', label: r.label, rack: r }; }))
      .concat([{ kind: 'insights', label: 'Insights' }, { kind: 'suite', label: 'Test Features' }]);
    defs.forEach(function (def, idx) {
      var tab = D.el('button', 'tab' + (idx === D.S.active ? ' active' : ''), def.label);
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', idx === D.S.active ? 'true' : 'false');
      tab.addEventListener('click', function () { D.showTab(idx); });
      tabsBar.appendChild(tab);
      var panel = D.el('div', 'panel' + (idx === D.S.active ? ' active' : ''));
      var panelId = 'dashboard-panel-' + idx; panel.id = panelId; panel.setAttribute('role', 'tabpanel'); tab.setAttribute('aria-controls', panelId);
      var refs = { kind: def.kind, rack: def.rack, panel: panel, tab: tab };
      var cards = D.el('div', 'cards');
      if (def.kind === 'ov') {
        refs.cRacks = D.card('RACKS', D.S.racks.length, '#38bdf8');
        refs.cFeat = D.card('FEATURES', 0, '#c084fc');
        refs.cReq = D.card('SYSTEM REQS', 0, '#fbbf24');
        refs.cCase = D.card('TOTAL TEST CASES', '-', '#34d399');
        refs.cFiltered = D.card('UPDATED IN RANGE', 0, '#60a5fa');
        refs.cPass = D.card('PASS CASES / RATE', '-', '#2dd4bf');
        refs.cFail = D.card('FAIL CASES (BLOCKED) / RATE', '-', '#fb7185');
        refs.cProgress = D.card('IN PROGRESS CASES', 0, '#818cf8');
        refs.cBugs = D.card('BUGS / AFFECTED CASES', '-', '#fb923c');
        refs.cPass.title = 'Closed Test Cases are counted as Pass. Rate denominator: Test Cases in the selected time range.';
        refs.cFail.title = 'Blocked Test Cases are counted as Fail. Rate denominator: Test Cases in the selected time range.';
        refs.cProgress.title = 'Test Cases whose current Azure DevOps State is In Progress.';
        refs.cBugs.title = 'Unique linked Bugs / Test Cases affected by at least one linked Bug.';
        [refs.cRacks, refs.cFeat, refs.cReq, refs.cCase, refs.cFiltered, refs.cPass, refs.cFail, refs.cProgress, refs.cBugs].forEach(function (c) { cards.appendChild(c); });
        var stickyTop = D.el('div', 'panel-sticky'); stickyTop.appendChild(cards); panel.appendChild(stickyTop);
        var grid = D.el('div', 'grid');
        var b1 = D.box('Test Case state distribution — all Racks');
        refs.chartHost = D.el('div', 'chartwrap'); b1.appendChild(refs.chartHost);
        refs.legendHost = D.el('div'); b1.appendChild(refs.legendHost);
        var b2 = D.box('Rack comparison (stacked bar)');
        refs.cmpHost = D.el('div', 'chartwrap'); b2.appendChild(refs.cmpHost);
        grid.appendChild(b1); grid.appendChild(b2); panel.appendChild(grid);
        var b3 = D.box('Rack × State summary table');
        refs.tableBox = D.el('div'); b3.appendChild(refs.tableBox); panel.appendChild(b3);
        var bPriority = D.box('Test Case completion by Priority — Closed = completed');
        refs.priorityBox = D.el('div'); bPriority.appendChild(refs.priorityBox); panel.appendChild(bPriority);
        var bMetrics = D.box('Sample Size, Number_of_cycles & Test Duration — largest / longest first');
        refs.metricBox = D.el('div'); bMetrics.appendChild(refs.metricBox); panel.appendChild(bMetrics);
        var b4 = D.box('Linked Bug tracking — from Test Case Links');
        refs.bugStatsBox = D.el('div'); b4.appendChild(refs.bugStatsBox);
        refs.bugBox = D.el('div', 'bug-detail-scroll'); b4.appendChild(refs.bugBox); panel.appendChild(b4);
      } else if (def.kind === 'rack') {
        refs.cFeat = D.card('FEATURES', 0, '#c084fc');
        refs.cReq = D.card('SYSTEM REQS', 0, '#fbbf24');
        refs.cCase = D.card('TEST CASES', '-', '#34d399');
        refs.cFiltered = D.card('UPDATED IN RANGE', 0, '#60a5fa');
        refs.cBugs = D.card('LINKED BUGS', 0, '#f87171');
        refs.cBugs.title = 'Unique Bug work items linked from Test Cases in this Rack.';
        [refs.cFeat, refs.cReq, refs.cCase, refs.cFiltered, refs.cBugs].forEach(function (c) { cards.appendChild(c); });
        var rackSticky = D.el('div', 'panel-sticky'); rackSticky.appendChild(cards); panel.appendChild(rackSticky);
        var g = D.el('div', 'grid');
        var rb1 = D.box(def.rack.label + ' State distribution');
        refs.chartHost = D.el('div', 'chartwrap'); rb1.appendChild(refs.chartHost);
        refs.legendHost = D.el('div'); rb1.appendChild(refs.legendHost);
        var rb2 = D.box('State summary table');
        refs.tableBox = D.el('div'); rb2.appendChild(refs.tableBox);
        g.appendChild(rb1); g.appendChild(rb2); panel.appendChild(g);
        var rbPriority = D.box('Test Case completion by Priority — Closed = completed');
        refs.priorityBox = D.el('div'); rbPriority.appendChild(refs.priorityBox); panel.appendChild(rbPriority);
        var rbMetrics = D.box('Sample Size, Number_of_cycles & Test Duration — largest / longest first');
        refs.metricBox = D.el('div'); rbMetrics.appendChild(refs.metricBox); panel.appendChild(rbMetrics);
        var tb = D.box('Feature → System Requirement → Test Case (click to expand)');
        var bar = D.el('div', 'tree-toolbar');
        var bExp = D.el('button', null, 'Expand all'), bCol = D.el('button', null, 'Collapse all');
        var search = D.el('input'); search.placeholder = 'Search case title / ID / state / bug …'; search.style.minWidth = '0';
        bExp.addEventListener('click', function () { panel.querySelectorAll('details.node').forEach(function (d) { d.open = true; }); });
        bCol.addEventListener('click', function () { panel.querySelectorAll('details.node').forEach(function (d) { d.open = false; }); });
        search.addEventListener('input', function () { D.applyFilter(panel, search.value); });
        bar.appendChild(bExp); bar.appendChild(bCol); bar.appendChild(search); tb.appendChild(bar);
        var treeHost = D.el('div');
        (def.rack.children || []).forEach(function (c) { treeHost.appendChild(D.tree(c, 1)); });
        tb.appendChild(treeHost); panel.appendChild(tb);
      } else if (def.kind === 'insights') {
        refs.insightsHost = D.insightsPanel();
        panel.appendChild(refs.insightsHost);
      } else {
        refs.suiteHost = D.suitePanel();
        panel.appendChild(refs.suiteHost);
      }
      host.appendChild(panel); D.S.panels.push(refs);
    });
  };
  D.showTab = function (idx) {
    D.S.active = idx;
    D.S.panels.forEach(function (p, i) { var active = i === idx; p.tab.classList.toggle('active', active); p.tab.setAttribute('aria-selected', active ? 'true' : 'false'); p.panel.classList.toggle('active', active); });
    D.refresh();
  };
  D.drawInto = function (host, counts) {
    host.innerHTML = '';
    host.appendChild(D.S.chartType === 'bar' ? D.bar(counts) : D.pie(counts));
  };
  D.latest = function (cases) { var b = null; cases.forEach(function (c) { if (c.changed && (!b || c.changed > b)) b = c.changed; }); return b; };
  D.refresh = function () {
    var allCases = [], allFeat = [], allReq = [];
    D.S.racks.forEach(function (r) {
      allCases = allCases.concat(D.collect(r, 'Test Case'));
      allFeat = allFeat.concat(D.collect(r, 'Feature'));
      allReq = allReq.concat(D.collect(r, 'System Requirement'));
    });
    D.S.panels.forEach(function (p) {
      if (p.kind === 'ov') {
        var f = allCases.filter(D.inRange);
        var bugCases = allCases.filter(function (c) { return (c.bugs || []).length > 0; });
        var linkedBugs = D.uniqueBugs(allCases);
        var outcomes = D.outcomeSummary(f);
        p.cFeat._val.textContent = allFeat.length;
        p.cReq._val.textContent = allReq.length;
        p.cCase._val.textContent = allCases.length;
        p.cFiltered._val.textContent = f.length;
        p.cPass._val.textContent = D.outcomeValue(outcomes.pass, outcomes.passRate);
        p.cFail._val.textContent = D.outcomeValue(outcomes.fail, outcomes.failRate);
        p.cProgress._val.textContent = outcomes.inProgress;
        p.cBugs._val.textContent = linkedBugs.length + ' / ' + bugCases.length;
        p.tableBox.innerHTML = ''; p.tableBox.appendChild(D.rackTable());
        p.priorityBox.innerHTML = ''; p.priorityBox.appendChild(D.priorityCompletionChart(f));
        p.metricBox.innerHTML = ''; p.metricBox.appendChild(D.metricInventoryPanel(f));
        p.bugStatsBox.innerHTML = ''; p.bugStatsBox.appendChild(D.bugStats(allCases));
        p.bugBox.innerHTML = ''; p.bugBox.appendChild(D.bugTable(allCases));
        var counts = D.countStates(f);
        D.drawInto(p.chartHost, counts);
        p.legendHost.innerHTML = ''; p.legendHost.appendChild(D.legend(counts));
        var stateSet = {};
        var perRack = D.S.racks.map(function (r) { var m = D.countStates(D.collect(r, 'Test Case').filter(D.inRange)); for (var k in m) stateSet[k] = 1; return m; });
        p.cmpHost.innerHTML = '';
        p.cmpHost.appendChild(D.stacked(D.S.racks.map(function (r) { return r.label; }), perRack, D.orderStates(Object.keys(stateSet))));
      } else if (p.kind === 'rack') {
        var cs = D.collect(p.rack, 'Test Case'), fc = cs.filter(D.inRange);
        p.cFeat._val.textContent = D.collect(p.rack, 'Feature').length;
        p.cReq._val.textContent = D.collect(p.rack, 'System Requirement').length;
        p.cCase._val.textContent = cs.length;
        p.cFiltered._val.textContent = fc.length;
        p.cBugs._val.textContent = D.uniqueBugs(cs).length;
        var c2 = D.countStates(fc);
        p.tableBox.innerHTML = ''; p.tableBox.appendChild(D.statsTable(c2));
        p.priorityBox.innerHTML = ''; p.priorityBox.appendChild(D.priorityCompletionChart(fc));
        p.metricBox.innerHTML = ''; p.metricBox.appendChild(D.metricInventoryPanel(fc));
        D.drawInto(p.chartHost, c2);
        p.legendHost.innerHTML = ''; p.legendHost.appendChild(D.legend(c2));
      }
    });
    var tf = allCases.filter(D.inRange).length, totalLinkedBugs = D.uniqueBugs(allCases).length;
    var bugNote = D.S.bugLinkWarning ? ' Bug link lookup was skipped, but the core dashboard data is current.' : '';
    var metricNote = D.S.metricFieldWarning ? ' Some custom Test Case metric fields were unavailable; the rest of the dashboard is current.' : '';
    var testNote = D.S.testResults && D.S.testResults.status === 'error' ? ' Test Runs/Results are unavailable; open Insights for details.' : '';
    var rl = (D.RANGES.filter(function (x) { return x[0] === D.S.range; })[0] || ['', ''])[1];
    var ml = (D.MODES.filter(function (x) { return x[0] === D.S.mode; })[0] || ['', ''])[1];
    var src = D.S.snapshotMode ? ('Offline snapshot (' + D.fmt(D.S.loadedAt) + ')') : (ml + ' · ' + D.fmt(D.S.loadedAt) + ' query re-run');
    requestAnimationFrame(D.fitCardValues);
    if (!tf && allCases.length) {
      D.setStatus(src + ': loaded ' + allCases.length + ' test cases, but nothing was updated within "' + rl + '" — charts are empty. Latest change: ' + D.fmt(D.latest(allCases)) + '.' + bugNote + metricNote + testNote, 'warn');
    } else if (D.S.racks.length) {
      D.setStatus(src + ': ' + D.S.racks.length + ' racks, ' + allCases.length + ' test cases, ' + totalLinkedBugs + ' linked Bugs; "' + rl + '" contains ' + tf + ' updated items.' + bugNote + metricNote + testNote, (D.S.bugLinkWarning || D.S.metricFieldWarning || testNote) ? 'warn' : 'info');
    }
  };
  D.load = async function () {
    var modeLabel = (D.MODES.filter(function (m) { return m[0] === D.S.mode; })[0] || ['', ''])[1];
    if (D.S.mode === 'snapshot') {
      var s = D.readSnapshot();
      if (!s || !s.racks || !s.racks.length) {
        D.setStatus('No offline snapshot available. Switch to "Live query" or "Local proxy" and load successfully once (a snapshot is then saved automatically), or open an exported snapshot HTML file.', 'err');
        return;
      }
      D.S.racks = s.racks; D.S.loadedAt = s.savedAt || null; D.S.snapshotMode = true; D.S.bugLinkWarning = ''; D.S.metricFieldWarning = '';
      D.S.testResults = s.testResults || { status: 'unavailable', runs: [], error: 'This snapshot predates Test Result storage.' };
      D.S.snapshotComparison = s.snapshotComparison || { status: 'first', previousAt: null, currentAt: D.S.loadedAt, added: [], removed: [], stateChanged: [], updatedThisWeek: [] };
      document.getElementById('updated').textContent = 'Snapshot: ' + D.fmt(D.S.loadedAt);
      if (D.S.active > D.S.racks.length + 2) D.S.active = 0;
      D.buildPanels(); D.refresh();
      return;
    }
    D.setStatus('Running the query with "' + modeLabel + '" and fetching work items …', 'info');
    try {
      var previous = D.readSnapshot();
      var res = await D.runQuery();
      D.S.racks = res.racks; D.S.loadedAt = new Date().toISOString(); D.S.snapshotMode = false;
      await D.loadSupplementalData(D.baseFor(), D.allCases());
      D.S.snapshotComparison = D.compareSnapshot(previous);
      document.getElementById('updated').textContent = 'Updated: ' + D.fmt(D.S.loadedAt);
      D.saveSnapshot(previous);
      if (D.S.active > D.S.racks.length + 2) D.S.active = 0;
      D.buildPanels(); D.refresh();
    } catch (e) {
      var m = String((e && e.message) || e);
      var hint = '';
      if (D.S.mode === 'live' && location.origin !== D.CFG.org) hint = '"Live query" requires this page itself to be on the ' + D.CFG.org + ' domain. If you opened a local .html file, choose "Offline snapshot" or "Local proxy" instead.';
      else if (D.S.mode === 'live') hint = 'Azure DevOps rejected or could not complete the REST request. The HTTP detail above identifies the failing API call; the page is already on the correct same-origin domain.';
      else hint = 'Cannot reach the proxy ' + D.getProxy() + '. Make sure the proxy is running, the URL is correct, and that it returns CORS headers.';
      if (m === 'AUTH') hint = 'Authentication failed: sign in to Azure DevOps in this browser (or configure a PAT on the proxy side) and try again.';
      var snap = D.readSnapshot();
      D.setStatus('Load failed (' + m + '). ' + hint + (snap ? '  A snapshot from ' + D.fmt(snap.savedAt) + '  is available — switch to "Offline snapshot" to view it.' : ''), 'err');
    }
  };
  D.MODES = [["live","Live query (same-origin REST API)"],["snapshot","Offline snapshot (no network)"],["proxy","Local proxy (custom URL)"]];
  D.getProxy = function () { return (localStorage.getItem('dvdashProxy') || 'http://localhost:8080').replace(/\/+$/, ''); };
  D.baseFor = function () { return D.S.mode === 'proxy' ? D.getProxy() : D.CFG.org; };
  D.snapshotPayload = function () {
    return {
      savedAt: D.S.loadedAt || new Date().toISOString(), query: Object.assign({}, D.activeQuery()), racks: D.S.racks,
      testResults: D.S.testResults, snapshotComparison: D.S.snapshotComparison
    };
  };
  D.snapshotCaseMap = function (snapshot) {
    var map = {};
    ((snapshot && snapshot.racks) || []).forEach(function (rack) {
      D.collect(rack, 'Test Case').forEach(function (testCase) {
        map[String(testCase.id)] = { id: testCase.id, title: testCase.title, rack: rack.label || rack.title || 'Rack', state: testCase.state || '?', changed: testCase.changed || null };
      });
    });
    return map;
  };
  D.compareSnapshot = function (previous) {
    var current = { savedAt: D.S.loadedAt, racks: D.S.racks }, before = D.snapshotCaseMap(previous), after = D.snapshotCaseMap(current);
    var comparison = { status: previous && previous.racks ? 'ok' : 'first', previousAt: previous && previous.savedAt || null, currentAt: D.S.loadedAt, added: [], removed: [], stateChanged: [], updatedThisWeek: [] };
    Object.keys(after).forEach(function (id) {
      if (comparison.status !== 'first' && !before[id]) comparison.added.push(after[id]);
      else if (comparison.status !== 'first' && before[id].state !== after[id].state) comparison.stateChanged.push({ id: after[id].id, title: after[id].title, rack: after[id].rack, beforeState: before[id].state, afterState: after[id].state, changed: after[id].changed });
      if (after[id].changed && Date.now() - new Date(after[id].changed).getTime() <= 7 * 86400000) comparison.updatedThisWeek.push(after[id]);
    });
    if (comparison.status !== 'first') Object.keys(before).forEach(function (id) { if (!after[id]) comparison.removed.push(before[id]); });
    ['added', 'removed', 'stateChanged', 'updatedThisWeek'].forEach(function (key) {
      comparison[key].sort(function (a, b) { return String(b.changed || '').localeCompare(String(a.changed || '')) || (+a.id - +b.id); });
    });
    return comparison;
  };
  D.saveSnapshot = function (previous) {
    try {
      var historyKey = D.snapshotStorageKey('dvdashSnapshotHistory'), snapshotKey = D.snapshotStorageKey('dvdashSnapshot');
      if (previous && previous.racks && previous.savedAt) {
        var history = [];
        try { history = JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch (historyError) { history = []; }
        var day = D.isoDay(previous.savedAt);
        history = history.filter(function (entry) { return entry && D.isoDay(entry.savedAt) !== day; });
        history.push(previous); history.sort(function (a, b) { return String(a.savedAt).localeCompare(String(b.savedAt)); });
        localStorage.setItem(historyKey, JSON.stringify(history.slice(-14)));
      }
      localStorage.setItem(snapshotKey, JSON.stringify(D.snapshotPayload())); return true;
    }
    catch (e) { return false; }
  };
  D.readSnapshot = function () {
    if (D.EMBEDDED && D.EMBEDDED.racks) return D.EMBEDDED;
    try {
      var raw = localStorage.getItem(D.snapshotStorageKey('dvdashSnapshot'));
      if (!raw && D.CFG.queryId === '9254024e-6a97-44ed-953b-1aa07d38fb48') raw = localStorage.getItem('dvdashSnapshot');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  D.serialize = function () {
    var parts = [];
    Object.keys(D).forEach(function (k) {
      if (k === 'EMBEDDED') return;
      var v = D[k];
      if (typeof v === 'function') parts.push('D.' + k + ' = ' + v.toString() + ';');
      else if (k === 'S') parts.push('D.S = ' + JSON.stringify({ racks: [], loadedAt: null, range: D.S.range || 'all', chartType: D.S.chartType || 'pie', panels: [], active: 0, mode: 'snapshot', queries: D.S.queries || [], activeQueryKey: D.S.activeQueryKey || '', testResults: { status: 'idle', runs: [] }, snapshotComparison: null }) + ';');
      else if (k === '_timer' || k === '_statusFadeTimer' || k === '_statusHideTimer') return;
      else parts.push('D.' + k + ' = ' + JSON.stringify(v) + ';');
    });
    return parts.join('\n').replace(/<\/script/gi, '<\\/script');
  };
  D.exportHtml = function () {
    if (!D.S.racks || !D.S.racks.length) { D.setStatus('Nothing to export yet — load data successfully first.', 'warn'); return; }
    var snap = JSON.stringify(D.snapshotPayload()).replace(/</g, '\\u003c');
    var html = '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">'
      + '<title>' + D.xmlEsc(D.activeQuery().name) + ' Test Status Dashboard (Offline snapshot)</title></head><body>'
      + '<script id="dvdash-snapshot" type="application/json">' + snap + '<\/script>'
      + '<script>\nvar extensionContext = null;\nvar D = {};\n' + D.serialize()
      + '\nD.EMBEDDED = JSON.parse(document.getElementById("dvdash-snapshot").textContent);'
      + '\nD.S.mode = "snapshot";'
      + '\nD.buildShell(); D.load();\n<\/script></body></html>';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = D.reportPrefix() + '-Dashboard-snapshot.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    D.setStatus('Exported offline snapshot HTML containing ' + D.collect({ children: D.S.racks, type: 'x' }, 'Test Case').length + ' test cases. It can be opened offline on any computer.', 'info');
  };
  D.persistWire = function () {
    var rs = document.getElementById('rangeSel'), ts = document.getElementById('typeSel');
    if (rs) rs.addEventListener('change', function (e) { try { localStorage.setItem('dvdashRange', e.target.value); } catch (x) { } });
    if (ts) ts.addEventListener('change', function (e) { try { localStorage.setItem('dvdashType', e.target.value); } catch (x) { } });
  };
  D.boot = function () {
    try {
      D.S.mode = localStorage.getItem('dvdashMode') || D.S.mode || 'live';
      D.S.range = localStorage.getItem('dvdashRange') || D.S.range || 'all';
      D.S.chartType = localStorage.getItem('dvdashType') || D.S.chartType || 'pie';
    } catch (e) { }
    D.loadQueryCatalog();
    D.buildShell(); D.persistWire(); D.load();
  };
  D.boot();
})();
