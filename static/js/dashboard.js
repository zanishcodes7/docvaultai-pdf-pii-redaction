(function () {
  var root = document.documentElement;
  var themeBtn = document.getElementById("theme-btn");
  var themeIcon = document.getElementById("theme-icon");
  var themeText = document.getElementById("theme-text");

  function applyTheme(mode) {
    root.setAttribute("data-theme", mode);
    localStorage.setItem("dv_studio_theme", mode);
    if (mode === "light") {
      themeIcon.innerHTML = "&#9789;";
      themeText.textContent = "Daylight";
    } else {
      themeIcon.innerHTML = "&#9728;";
      themeText.textContent = "Nightfall";
    }
  }
  applyTheme(localStorage.getItem("dv_studio_theme") || "light");

  themeBtn.addEventListener("click", function () {
    applyTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light");
  });

  var navTabs = Array.prototype.slice.call(document.querySelectorAll(".nav-tab[data-page]"));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".page-panel"));

  function navigateTo(pageName) {
    navTabs.forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-page") === pageName);
    });
    panels.forEach(function (panel) {
      var isTarget = panel.id === "page-" + pageName;
      panel.classList.toggle("active", isTarget);
      if (isTarget) {
        panel.querySelectorAll(".anim-enter").forEach(function (el) {
          el.style.animation = "none";
          void el.offsetHeight;
          el.style.animation = "";
        });
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (pageName === "vault") {
      loadVaultTable();
    }
  }

  navTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      navigateTo(tab.getAttribute("data-page"));
    });
  });

  document.getElementById("go-upload-btn").addEventListener("click", function () {
    navigateTo("upload");
  });
  document.getElementById("go-process-btn").addEventListener("click", function () {
    navigateTo("process");
  });
  document.getElementById("btn-continue-process").addEventListener("click", function () {
    navigateTo("process");
  });

  /* 3D POINTER TILT ON HERO SHOWCASE & CARDS */
  var heroTilt = document.getElementById("hero-3d-tilt");
  if (heroTilt) {
    heroTilt.addEventListener("mousemove", function (e) {
      var r = heroTilt.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      heroTilt.style.transform =
        "perspective(900px) rotateY(" + (x * 16).toFixed(2) + "deg) rotateX(" + (-y * 14).toFixed(2) + "deg) translateZ(8px)";
    });
    heroTilt.addEventListener("mouseleave", function () {
      heroTilt.style.transform = "";
    });
  }

  Array.prototype.slice.call(document.querySelectorAll(".bento-card, .metric-box, .rule-card")).forEach(function (card) {
    card.addEventListener("mousemove", function (e) {
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform =
        "perspective(800px) rotateY(" + (x * 8).toFixed(2) + "deg) rotateX(" + (-y * 8).toFixed(2) + "deg) translateY(-3px)";
    });
    card.addEventListener("mouseleave", function () {
      card.style.transform = "";
    });
  });

  var ruleBoxes = Array.prototype.slice.call(document.querySelectorAll("input[data-rule]"));
  ruleBoxes.forEach(function (box) {
    box.addEventListener("change", function () {
      var rule = box.getAttribute("data-rule");
      var checked = box.checked;
      ruleBoxes.forEach(function (other) {
        if (other.getAttribute("data-rule") === rule) other.checked = checked;
      });
    });
  });

  function collectRules() {
    var obj = {};
    document.querySelectorAll("#page-process input[data-rule]").forEach(function (cb) {
      obj[cb.getAttribute("data-rule")] = cb.checked;
    });
    return obj;
  }

  var dropArea = document.getElementById("drop-area");
  var pdfInput = document.getElementById("pdf-input");
  var btnProcess = document.getElementById("btn-process");
  var selectedLabel = document.getElementById("selected-file-label");
  var uploadReadyText = document.getElementById("upload-ready-text");
  var procStatus = document.getElementById("proc-status");
  var queuedFile = null;

  function stagePdf(file) {
    if (!file) return;
    queuedFile = file;
    var label = file.name + " (" + (file.size / 1024).toFixed(1) + " KB)";
    dropArea.classList.add("has-file");
    selectedLabel.textContent = "Staged: " + label;
    uploadReadyText.textContent = label + " — ready on Process page";
    btnProcess.disabled = false;
    procStatus.textContent = "File Staged";
  }

  function popStat(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("pop-stat");
    void el.offsetWidth;
    el.classList.add("pop-stat");
  }

  function renderJobOutput(job) {
    if (!job || !job.audit) return;
    var aud = job.audit;
    var masked = aud.total_redacted != null ? aud.total_redacted : 0;
    var pagesCount = aud.pages != null ? aud.pages : 1;
    var ms = aud.latency_ms != null ? aud.latency_ms : 0;

    dropArea.classList.remove("scanning");
    procStatus.textContent = "Completed";

    popStat("out-masked", String(masked));
    popStat("out-pages", String(pagesCount));
    popStat("out-ms", ms + " ms");
    popStat("out-mode", job.mode || "local-preview");

    document.getElementById("view-title").textContent = job.filename;
    document.getElementById("view-sub").textContent = job.timestamp + " · " + masked + " masked entity/entities";

    document.getElementById("dl-group").style.display = "flex";
    document.getElementById("dl-raw").href = "/api/file/raw/" + encodeURIComponent(job.key) + "?dl=1";
    document.getElementById("dl-redacted").href = "/api/file/redacted/" + encodeURIComponent(job.key) + "?dl=1";

    document.getElementById("pdf-raw").src = "/api/file/raw/" + encodeURIComponent(job.key);
    document.getElementById("pdf-redacted").src = "/api/file/redacted/" + encodeURIComponent(job.key);

    var b = aud.breakdown || {};
    document.getElementById("counts-row").innerHTML =
      "<span>Emails <b>" + (b.emails || 0) + "</b></span>" +
      "<span>Phones <b>" + (b.phones || 0) + "</b></span>" +
      "<span>CNIC/IDs <b>" + (b.ids || 0) + "</b></span>" +
      "<span>Cards/IBAN <b>" + (b.cards || 0) + "</b></span>" +
      "<span>Custom <b>" + (b.custom || 0) + "</b></span>";

    var findings = aud.findings || [];
    if (!findings.length) {
      document.getElementById("audit-detail").innerHTML =
        "<span class=\"muted-text\">Total masked entities: " + masked + ".</span>";
    } else {
      document.getElementById("audit-detail").innerHTML = findings.map(function (f) {
        return "<span class=\"finding-pill\">p." + f.page + " · " + f.type + " · " + f.sample + "</span>";
      }).join("");
    }
  }

  function runRedaction() {
    if (!queuedFile) return;
    dropArea.classList.add("scanning");
    procStatus.textContent = "Processing...";
    btnProcess.disabled = true;

    var fd = new FormData();
    fd.append("file", queuedFile);
    fd.append("rules", JSON.stringify(collectRules()));
    fd.append("custom_terms", document.getElementById("custom-kw").value || "");

    fetch("/api/process", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        btnProcess.disabled = false;
        dropArea.classList.remove("scanning");
        if (res.error) {
          alert(res.error);
          procStatus.textContent = "Error";
          return;
        }
        renderJobOutput(res);
      })
      .catch(function (err) {
        btnProcess.disabled = false;
        dropArea.classList.remove("scanning");
        procStatus.textContent = "Error";
        alert("Processing error: " + err);
      });
  }

  dropArea.addEventListener("click", function () { pdfInput.click(); });
  dropArea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pdfInput.click();
    }
  });
  pdfInput.addEventListener("change", function () {
    if (pdfInput.files && pdfInput.files[0]) stagePdf(pdfInput.files[0]);
  });
  dropArea.addEventListener("dragover", function (e) { e.preventDefault(); dropArea.classList.add("over"); });
  dropArea.addEventListener("dragleave", function () { dropArea.classList.remove("over"); });
  dropArea.addEventListener("drop", function (e) {
    e.preventDefault();
    dropArea.classList.remove("over");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) stagePdf(e.dataTransfer.files[0]);
  });
  btnProcess.addEventListener("click", runRedaction);

  var historyOpen = false;
  var jobsList = document.getElementById("jobs-list");
  var btnToggleHist = document.getElementById("btn-toggle-history");
  var btnClearHist = document.getElementById("btn-clear-history");

  function renderHistory(jobs) {
    if (!jobs || !jobs.length) {
      jobsList.innerHTML = "<div class=\"muted-text\">No saved PDF runs.</div>";
      return;
    }
    jobsList.innerHTML = "";
    jobs.forEach(function (j) {
      var masked = (j.audit && j.audit.total_redacted) || 0;
      var row = document.createElement("div");
      row.className = "history-row";
      row.innerHTML =
        "<div><strong>" + j.filename + "</strong> <small>(" + j.timestamp + ")</small></div>" +
        "<span class=\"status-chip\">" + masked + " masked</span>";
      row.addEventListener("click", function () {
        renderJobOutput(j);
        document.getElementById("output-card").scrollIntoView({ behavior: "smooth" });
      });
      jobsList.appendChild(row);
    });
  }

  function fetchOverview(cb) {
    fetch("/api/overview")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var pipe = data.pipeline || {};
        var chip = document.getElementById("pipe-chip");
        var lbl = document.getElementById("pipe-label");
        var modePill = document.getElementById("pipe-mode-pill");
        if (pipe.online) {
          chip.classList.add("online");
          lbl.textContent = "Floci Online";
          if (modePill) modePill.textContent = "Online";
        } else {
          chip.classList.remove("online");
          lbl.textContent = "Floci Offline";
          if (modePill) modePill.textContent = "Local";
        }
        if (document.getElementById("kv-ep")) {
          document.getElementById("kv-ep").textContent = pipe.endpoint || "http://localhost:4566";
          document.getElementById("kv-q").textContent = pipe.queue_depth || 0;
          document.getElementById("kv-b").textContent = (pipe.buckets && pipe.buckets.length) ? pipe.buckets.join(", ") : "None";
        }
        if (typeof cb === "function") cb(data.jobs || []);
      });
  }

  btnToggleHist.addEventListener("click", function () {
    historyOpen = !historyOpen;
    if (historyOpen) {
      jobsList.style.display = "flex";
      btnClearHist.style.display = "inline-block";
      btnToggleHist.textContent = "Hide History";
      fetchOverview(renderHistory);
    } else {
      jobsList.style.display = "none";
      btnClearHist.style.display = "none";
      btnToggleHist.textContent = "Show History";
    }
  });

  function clearAllHistory() {
    fetch("/api/clear", { method: "POST" }).then(function () {
      renderHistory([]);
      loadVaultTable();
    });
  }

  btnClearHist.addEventListener("click", clearAllHistory);
  document.getElementById("btn-vault-clear").addEventListener("click", clearAllHistory);

  function loadVaultTable() {
    fetchOverview(function (jobs) {
      var tbody = document.getElementById("vault-tbody");
      if (!jobs.length) {
        tbody.innerHTML = "<tr><td colspan=\"6\" class=\"muted-text\">No documents in history.</td></tr>";
        return;
      }
      tbody.innerHTML = jobs.map(function (j) {
        var aud = j.audit || {};
        return "<tr>" +
          "<td><strong>" + j.filename + "</strong></td>" +
          "<td><span class=\"status-chip\">" + (aud.total_redacted || 0) + "</span></td>" +
          "<td>" + (aud.pages || 1) + "</td>" +
          "<td>" + (aud.latency_ms || 0) + " ms</td>" +
          "<td>" + j.mode + "</td>" +
          "<td>" + j.timestamp + "</td>" +
          "</tr>";
      }).join("");
    });
  }

  document.getElementById("btn-vault-refresh").addEventListener("click", loadVaultTable);

  fetchOverview(null);
})();