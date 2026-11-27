(function () {
  var root = document.documentElement;
  var curtain = document.getElementById("curtain");
  var themeBtn = document.getElementById("theme-btn");
  var themeIcon = document.getElementById("theme-icon");
  var themeText = document.getElementById("theme-text");

  function setTheme(t) {
    root.setAttribute("data-theme", t);
    localStorage.setItem("dv_pos_theme", t);
    if (t === "positivus") {
      themeIcon.innerHTML = "&#9789;";
      themeText.textContent = "Redo Orange";
    } else {
      themeIcon.innerHTML = "&#9728;";
      themeText.textContent = "Slate Blue Tint";
    }
  }
  setTheme(localStorage.getItem("dv_pos_theme") || "positivus");

  themeBtn.addEventListener("click", function () {
    curtain.classList.add("show");
    setTimeout(function () {
      setTheme(root.getAttribute("data-theme") === "positivus" ? "obsidian" : "positivus");
    }, 160);
    setTimeout(function () {
      curtain.classList.remove("show");
    }, 340);
  });

  var navButtons = Array.prototype.slice.call(document.querySelectorAll(".nav-link[data-page]"));
  var pages = Array.prototype.slice.call(document.querySelectorAll(".page-view"));

  function openPage(pageName) {
    navButtons.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-page") === pageName);
    });
    pages.forEach(function (p) {
      p.classList.toggle("active", p.id === "page-" + pageName);
    });
    if (pageName === "vault") {
      loadVaultTable();
    }
  }

  navButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      openPage(btn.getAttribute("data-page"));
    });
  });

  function setFlowStep(stepNum) {
    [1, 2, 3].forEach(function (n) {
      var el = document.getElementById("flow-" + n);
      if (el) el.classList.toggle("active", n === stepNum);
    });
  }

  var allRuleBoxes = Array.prototype.slice.call(document.querySelectorAll("input[data-rule]"));
  allRuleBoxes.forEach(function (box) {
    box.addEventListener("change", function () {
      var ruleName = box.getAttribute("data-rule");
      var isChecked = box.checked;
      allRuleBoxes.forEach(function (other) {
        if (other.getAttribute("data-rule") === ruleName) other.checked = isChecked;
      });
    });
  });

  function selectedRules() {
    var out = {};
    document.querySelectorAll("#page-studio input[data-rule]").forEach(function (cb) {
      out[cb.getAttribute("data-rule")] = cb.checked;
    });
    return out;
  }

  var dropArea = document.getElementById("drop-area");
  var pdfInput = document.getElementById("pdf-input");
  var btnProcess = document.getElementById("btn-process");
  var selectedLabel = document.getElementById("selected-file-label");
  var procStatus = document.getElementById("proc-status");
  var queuedFile = null;

  function stageFile(file) {
    if (!file) return;
    queuedFile = file;
    selectedLabel.textContent = "Selected: " + file.name + " (" + (file.size / 1024).toFixed(1) + " KB)";
    btnProcess.disabled = false;
    procStatus.textContent = "Ready to Process";
    setFlowStep(1);
  }

  function showResult(job) {
    if (!job || !job.audit) return;
    var aud = job.audit;
    var masked = aud.total_redacted != null ? aud.total_redacted : 0;
    var pgs = aud.pages != null ? aud.pages : 1;
    var ms = aud.latency_ms != null ? aud.latency_ms : 0;

    setFlowStep(3);
    procStatus.textContent = "Final Output Ready";

    document.getElementById("out-masked").textContent = masked;
    document.getElementById("out-pages").textContent = pgs;
    document.getElementById("out-ms").textContent = ms + " ms";
    document.getElementById("out-mode").textContent = job.mode || "local-preview";

    document.getElementById("view-title").textContent = "3. Final Output — " + job.filename;
    document.getElementById("view-sub").textContent = job.timestamp + " · " + masked + " entity/entities masked";

    document.getElementById("dl-group").style.display = "flex";
    document.getElementById("dl-raw").href = "/api/file/raw/" + encodeURIComponent(job.key) + "?dl=1";
    document.getElementById("dl-redacted").href = "/api/file/redacted/" + encodeURIComponent(job.key) + "?dl=1";

    document.getElementById("pdf-raw").src = "/api/file/raw/" + encodeURIComponent(job.key);
    document.getElementById("pdf-redacted").src = "/api/file/redacted/" + encodeURIComponent(job.key);

    var b = aud.breakdown || {};
    document.getElementById("counts-row").innerHTML =
      "<span>Emails: <b>" + (b.emails || 0) + "</b></span>" +
      "<span>Phones: <b>" + (b.phones || 0) + "</b></span>" +
      "<span>CNIC/IDs: <b>" + (b.ids || 0) + "</b></span>" +
      "<span>Cards/IBAN: <b>" + (b.cards || 0) + "</b></span>" +
      "<span>Custom: <b>" + (b.custom || 0) + "</b></span>";

    var findings = aud.findings || [];
    if (!findings.length) {
      document.getElementById("audit-detail").textContent = "Masked count: " + masked + ".";
    } else {
      document.getElementById("audit-detail").innerHTML = findings.map(function (f) {
        return "<span class=\"finding-chip\">p." + f.page + " · " + f.type + " · " + f.sample + "</span>";
      }).join("");
    }
  }

  function processQueuedPdf() {
    if (!queuedFile) return;
    setFlowStep(2);
    procStatus.textContent = "Processing...";
    btnProcess.disabled = true;

    var fd = new FormData();
    fd.append("file", queuedFile);
    fd.append("rules", JSON.stringify(selectedRules()));
    fd.append("custom_terms", document.getElementById("custom-kw").value || "");

    fetch("/api/process", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        btnProcess.disabled = false;
        if (res.error) {
          alert(res.error);
          procStatus.textContent = "Error";
          setFlowStep(1);
          return;
        }
        showResult(res);
      })
      .catch(function (err) {
        btnProcess.disabled = false;
        procStatus.textContent = "Error";
        setFlowStep(1);
        alert("Processing error: " + err);
      });
  }

  dropArea.addEventListener("click", function () { pdfInput.click(); });
  pdfInput.addEventListener("change", function () {
    if (pdfInput.files && pdfInput.files[0]) stageFile(pdfInput.files[0]);
  });
  dropArea.addEventListener("dragover", function (e) { e.preventDefault(); dropArea.classList.add("over"); });
  dropArea.addEventListener("dragleave", function () { dropArea.classList.remove("over"); });
  dropArea.addEventListener("drop", function (e) {
    e.preventDefault();
    dropArea.classList.remove("over");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) stageFile(e.dataTransfer.files[0]);
  });
  btnProcess.addEventListener("click", processQueuedPdf);

  var historyOpen = false;
  var jobsList = document.getElementById("jobs-list");
  var btnToggleHist = document.getElementById("btn-toggle-history");
  var btnClearHist = document.getElementById("btn-clear-history");

  function renderHistoryDrawer(jobs) {
    if (!jobs || !jobs.length) {
      jobsList.innerHTML = "<div class=\"muted-empty\">No saved PDF runs.</div>";
      return;
    }
    jobsList.innerHTML = "";
    jobs.forEach(function (j) {
      var masked = (j.audit && j.audit.total_redacted) || 0;
      var row = document.createElement("div");
      row.className = "job-row";
      row.innerHTML =
        "<div><strong>" + j.filename + "</strong> <small>(" + j.timestamp + ")</small></div>" +
        "<span class=\"lime-badge\">" + masked + " masked</span>";
      row.addEventListener("click", function () {
        showResult(j);
        document.getElementById("output-card").scrollIntoView({ behavior: "smooth" });
      });
      jobsList.appendChild(row);
    });
  }

  function fetchOverviewData(cb) {
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
      fetchOverviewData(renderHistoryDrawer);
    } else {
      jobsList.style.display = "none";
      btnClearHist.style.display = "none";
      btnToggleHist.textContent = "Show History";
    }
  });

  function clearHistory() {
    fetch("/api/clear", { method: "POST" }).then(function () {
      renderHistoryDrawer([]);
      loadVaultTable();
    });
  }

  btnClearHist.addEventListener("click", clearHistory);
  document.getElementById("btn-vault-clear").addEventListener("click", clearHistory);

  function loadVaultTable() {
    fetchOverviewData(function (jobs) {
      var tbody = document.getElementById("vault-tbody");
      if (!jobs.length) {
        tbody.innerHTML = "<tr><td colspan=\"6\" class=\"muted-empty\">No documents in history.</td></tr>";
        return;
      }
      tbody.innerHTML = jobs.map(function (j) {
        var aud = j.audit || {};
        return "<tr>" +
          "<td><strong>" + j.filename + "</strong></td>" +
          "<td><span class=\"lime-badge\">" + (aud.total_redacted || 0) + "</span></td>" +
          "<td>" + (aud.pages || 1) + "</td>" +
          "<td>" + (aud.latency_ms || 0) + " ms</td>" +
          "<td>" + j.mode + "</td>" +
          "<td>" + j.timestamp + "</td>" +
          "</tr>";
      }).join("");
    });
  }

  document.getElementById("btn-vault-refresh").addEventListener("click", loadVaultTable);

  fetchOverviewData(null);
})();