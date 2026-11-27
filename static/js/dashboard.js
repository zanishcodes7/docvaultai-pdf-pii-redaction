(function () {
  var root = document.documentElement;
  var curtain = document.getElementById("curtain");
  var themeBtn = document.getElementById("theme-btn");
  var themeIcon = document.getElementById("theme-icon");
  var themeText = document.getElementById("theme-text");

  function setTheme(mode) {
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
  setTheme(localStorage.getItem("dv_studio_theme") || "light");

  themeBtn.addEventListener("click", function () {
    curtain.classList.add("show");
    setTimeout(function () {
      setTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light");
    }, 160);
    setTimeout(function () {
      curtain.classList.remove("show");
    }, 340);
  });

  var navButtons = Array.prototype.slice.call(document.querySelectorAll(".nav-link[data-page]"));
  var pages = Array.prototype.slice.call(document.querySelectorAll(".page-view"));

  function openPage(pageName) {
    navButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-page") === pageName);
    });
    pages.forEach(function (page) {
      var isMatch = page.id === "page-" + pageName;
      page.classList.toggle("active", isMatch);
      if (isMatch) {
        page.querySelectorAll(".anim-stagger").forEach(function (el) {
          el.style.animation = "none";
          void el.offsetHeight;
          el.style.animation = "";
        });
      }
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
    [1, 2, 3].forEach(function (num) {
      var el = document.getElementById("flow-" + num);
      if (el) el.classList.toggle("active", num === stepNum);
    });
  }

  function pulseKpi(id, nextText) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = nextText;
    el.classList.remove("kpi-pop");
    void el.offsetWidth;
    el.classList.add("kpi-pop");
  }

  var allRuleBoxes = Array.prototype.slice.call(document.querySelectorAll("input[data-rule]"));
  allRuleBoxes.forEach(function (box) {
    box.addEventListener("change", function () {
      var ruleName = box.getAttribute("data-rule");
      var checked = box.checked;
      allRuleBoxes.forEach(function (other) {
        if (other.getAttribute("data-rule") === ruleName) other.checked = checked;
      });
    });
  });

  function selectedRules() {
    var rules = {};
    document.querySelectorAll("#page-studio input[data-rule]").forEach(function (cb) {
      rules[cb.getAttribute("data-rule")] = cb.checked;
    });
    return rules;
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
    dropArea.classList.add("has-file");
    selectedLabel.textContent = file.name + " · " + (file.size / 1024).toFixed(1) + " KB";
    btnProcess.disabled = false;
    procStatus.textContent = "Queued";
    setFlowStep(1);
  }

  function showResult(job) {
    if (!job || !job.audit) return;
    var aud = job.audit;
    var masked = aud.total_redacted != null ? aud.total_redacted : 0;
    var pagesCount = aud.pages != null ? aud.pages : 1;
    var latency = aud.latency_ms != null ? aud.latency_ms : 0;

    dropArea.classList.remove("scanning");
    setFlowStep(3);
    procStatus.textContent = "Completed";

    pulseKpi("out-masked", String(masked));
    pulseKpi("out-pages", String(pagesCount));
    pulseKpi("out-ms", latency + " ms");
    pulseKpi("out-mode", job.mode || "local-preview");

    document.getElementById("view-title").textContent = job.filename;
    document.getElementById("view-sub").textContent = job.timestamp + " · " + masked + " redacted item(s)";

    document.getElementById("dl-group").style.display = "flex";
    document.getElementById("dl-raw").href = "/api/file/raw/" + encodeURIComponent(job.key) + "?dl=1";
    document.getElementById("dl-redacted").href = "/api/file/redacted/" + encodeURIComponent(job.key) + "?dl=1";

    document.getElementById("pdf-raw").src = "/api/file/raw/" + encodeURIComponent(job.key);
    document.getElementById("pdf-redacted").src = "/api/file/redacted/" + encodeURIComponent(job.key);

    var b = aud.breakdown || {};
    document.getElementById("counts-row").innerHTML =
      "<span>Emails <b>" + (b.emails || 0) + "</b></span>" +
      "<span>Phones <b>" + (b.phones || 0) + "</b></span>" +
      "<span>CNIC / IDs <b>" + (b.ids || 0) + "</b></span>" +
      "<span>Cards / IBAN <b>" + (b.cards || 0) + "</b></span>" +
      "<span>Custom <b>" + (b.custom || 0) + "</b></span>";

    var findings = aud.findings || [];
    if (!findings.length) {
      document.getElementById("audit-detail").innerHTML =
        "<span class=\"audit-placeholder\">Total masked entities: " + masked + ".</span>";
    } else {
      document.getElementById("audit-detail").innerHTML = findings.map(function (f, idx) {
        return "<span class=\"finding-pill\" style=\"animation-delay:" + Math.min(idx * 25, 250) + "ms\">p." + f.page + " · " + f.type + " · " + f.sample + "</span>";
      }).join("");
    }
  }

  function processQueuedPdf() {
    if (!queuedFile) return;
    setFlowStep(2);
    dropArea.classList.add("scanning");
    procStatus.textContent = "Processing";
    btnProcess.disabled = true;

    var formData = new FormData();
    formData.append("file", queuedFile);
    formData.append("rules", JSON.stringify(selectedRules()));
    formData.append("custom_terms", document.getElementById("custom-kw").value || "");

    fetch("/api/process", { method: "POST", body: formData })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        btnProcess.disabled = false;
        dropArea.classList.remove("scanning");
        if (data.error) {
          alert(data.error);
          procStatus.textContent = "Error";
          setFlowStep(1);
          return;
        }
        showResult(data);
      })
      .catch(function (err) {
        btnProcess.disabled = false;
        dropArea.classList.remove("scanning");
        procStatus.textContent = "Error";
        setFlowStep(1);
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
      jobsList.innerHTML = "<div class=\"empty-cell\">No saved runs yet.</div>";
      return;
    }
    jobsList.innerHTML = "";
    jobs.forEach(function (job) {
      var masked = (job.audit && job.audit.total_redacted) || 0;
      var item = document.createElement("div");
      item.className = "run-item";
      item.innerHTML =
        "<div><strong>" + job.filename + "</strong><small>" + job.timestamp + "</small></div>" +
        "<span class=\"badge-tag\">" + masked + " masked</span>";
      item.addEventListener("click", function () {
        showResult(job);
        document.getElementById("output-card").scrollIntoView({ behavior: "smooth" });
      });
      jobsList.appendChild(item);
    });
  }

  function fetchOverviewData(callback) {
    fetch("/api/overview")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var pipe = data.pipeline || {};
        var chip = document.getElementById("pipe-chip");
        var label = document.getElementById("pipe-label");
        var modePill = document.getElementById("pipe-mode-pill");
        if (pipe.online) {
          chip.classList.add("online");
          label.textContent = "Floci Online";
          if (modePill) modePill.textContent = "Online";
        } else {
          chip.classList.remove("online");
          label.textContent = "Floci Offline";
          if (modePill) modePill.textContent = "Fallback";
        }
        if (document.getElementById("kv-ep")) {
          document.getElementById("kv-ep").textContent = pipe.endpoint || "http://localhost:4566";
          document.getElementById("kv-q").textContent = pipe.queue_depth || 0;
          document.getElementById("kv-b").textContent = (pipe.buckets && pipe.buckets.length) ? pipe.buckets.join(", ") : "None";
        }
        if (typeof callback === "function") callback(data.jobs || []);
      });
  }

  btnToggleHist.addEventListener("click", function () {
    historyOpen = !historyOpen;
    if (historyOpen) {
      jobsList.style.display = "flex";
      btnClearHist.style.display = "inline-block";
      btnToggleHist.textContent = "Hide Runs";
      fetchOverviewData(renderHistoryDrawer);
    } else {
      jobsList.style.display = "none";
      btnClearHist.style.display = "none";
      btnToggleHist.textContent = "Show Runs";
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
        tbody.innerHTML = "<tr><td colspan=\"6\" class=\"empty-cell\">No audit entries found.</td></tr>";
        return;
      }
      tbody.innerHTML = jobs.map(function (job) {
        var aud = job.audit || {};
        return "<tr>" +
          "<td><strong>" + job.filename + "</strong></td>" +
          "<td><span class=\"badge-tag\">" + (aud.total_redacted || 0) + "</span></td>" +
          "<td>" + (aud.pages || 1) + "</td>" +
          "<td>" + (aud.latency_ms || 0) + " ms</td>" +
          "<td>" + job.mode + "</td>" +
          "<td>" + job.timestamp + "</td>" +
          "</tr>";
      }).join("");
    });
  }

  document.getElementById("btn-vault-refresh").addEventListener("click", loadVaultTable);

  fetchOverviewData(null);
})();