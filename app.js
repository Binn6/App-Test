const STORAGE_KEY = "balikpapan-prototype-data-v1";
const OFFLINE_DRAFT_KEY = "balikpapan-offline-drafts-v1";

const statusSequence = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "REVISED", "FINAL_SENT"];
const bboxBalikpapan = {
  southWest: [-1.42, 116.67],
  northEast: [-1.00, 117.03],
};

let db = loadDb();
let activeUser = null;
let selectedReportId = null;
let map;
let marker;
let trendChart;

function loadDb() {
  const fallback = {
    accounts: [
      { id: crypto.randomUUID(), name: "KPH Balikpapan", email: "kph@contoh.id", role: "VERIFIKATOR", group: "Balikpapan" },
      { id: crypto.randomUUID(), name: "Balai PS Kaltim", email: "balai@contoh.id", role: "BALAI", group: "Kaltim" },
      { id: crypto.randomUUID(), name: "Admin", email: "admin@contoh.id", role: "ADMIN", group: "System" },
    ],
    reports: [],
    notifications: [],
    template: "Template PDF: Judul, Identitas, Ringkasan, Tabel Progress, Lokasi, Lampiran",
  };
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || fallback;
  } catch {
    return fallback;
  }
}

function saveDb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function nowStamp() {
  return new Date().toLocaleString("id-ID");
}

function setNetworkBanner() {
  const banner = document.getElementById("networkBanner");
  if (navigator.onLine) {
    banner.textContent = "Online";
    banner.className = "banner online";
  } else {
    banner.textContent = "Offline (Draft lokal aktif)";
    banner.className = "banner offline";
  }
}

function parsePipeRows(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kegiatan = "", target = "", indikator = ""] = line.split("|");
      return { kegiatan: kegiatan.trim(), target: target.trim(), indikator: indikator.trim() };
    });
}

function parseCsvRows(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kegiatan = "", persen = "0", catatan = ""] = line.split(",");
      return { kegiatan: kegiatan.trim(), persen: Number(persen.trim() || 0), catatan: catatan.trim() };
    });
}

function filesToMeta(input) {
  return [...input.files].map((f) => ({ name: f.name, type: f.type || "application/octet-stream", size: f.size }));
}

function createNewReport() {
  return {
    id: `LAP-${Date.now()}`,
    createdAt: nowStamp(),
    updatedAt: nowStamp(),
    groupName: activeUser?.name || "",
    email: activeUser?.email || "",
    region: "Balikpapan",
    quarter: "Q1",
    year: new Date().getFullYear(),
    planningDoc: { title: "", description: "", fileReference: "", poaRef: [] },
    summary: "",
    activities: [],
    annualLog: "",
    location: { name: "", lat: null, lng: null },
    attachments: { photos: [], docs: [] },
    status: "DRAFT",
    history: [{ status: "DRAFT", comment: "Draft dibuat", user: activeUser?.name || "System", timestamp: nowStamp() }],
  };
}

function renderKpis() {
  const box = document.getElementById("kpiCards");
  const counts = statusSequence.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  db.reports.forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
  box.innerHTML = Object.entries(counts)
    .map(([status, count]) => `<div class="kpi"><strong>${count}</strong><div>${status}</div></div>`)
    .join("");
}

function renderTrend() {
  const ctx = document.getElementById("trendChart");
  const buckets = {};
  db.reports.forEach((r) => {
    const key = `${r.year}-${r.quarter}`;
    buckets[key] = (buckets[key] || 0) + 1;
  });
  const labels = Object.keys(buckets);
  const values = Object.values(buckets);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Jumlah Laporan", data: values, borderColor: "#0a7c86", tension: 0.25 }],
    },
    options: { responsive: true, plugins: { legend: { display: true } } },
  });
}

function statusPill(status) {
  return `<span class="status-pill">${status}</span>`;
}

function canSeeReport(report) {
  if (!activeUser) return false;
  if (activeUser.role === "PELAPOR") return report.groupName === activeUser.name;
  if (activeUser.role === "VERIFIKATOR") return ["SUBMITTED", "UNDER_REVIEW", "REVISED", "APPROVED", "REJECTED"].includes(report.status);
  if (activeUser.role === "BALAI") return ["APPROVED", "FINAL_SENT"].includes(report.status);
  return true;
}

function renderReportList() {
  const list = document.getElementById("reportList");
  const statusFilter = document.getElementById("statusFilter").value;
  const yearFilter = document.getElementById("yearFilter").value;

  let reports = db.reports.filter(canSeeReport);
  if (statusFilter !== "ALL") reports = reports.filter((r) => r.status === statusFilter);
  if (yearFilter) reports = reports.filter((r) => String(r.year) === String(yearFilter));

  if (!reports.length) {
    list.innerHTML = '<p class="muted">Belum ada laporan.</p>';
    return;
  }
  list.innerHTML = reports
    .sort((a, b) => b.id.localeCompare(a.id))
    .map(
      (r) => `
      <div class="report-item">
        <strong>${r.id}</strong> - ${r.groupName} - ${r.quarter}/${r.year}
        <div>${statusPill(r.status)} • updated ${r.updatedAt}</div>
        <div class="actions" style="margin-top:8px;">
          <button onclick="openDetail('${r.id}')">Lihat Detail</button>
          ${activeUser.role === "PELAPOR" ? `<button class="secondary" onclick="loadToForm('${r.id}')">Edit</button>` : ""}
        </div>
      </div>
    `,
    )
    .join("");
}

window.openDetail = function openDetail(id) {
  selectedReportId = id;
  const report = db.reports.find((r) => r.id === id);
  if (!report) return;

  const detail = document.getElementById("reportDetail");
  const timeline = report.history
    .map((h) => `<p><strong>${h.status}</strong> - ${h.comment} <br/><small>${h.user} • ${h.timestamp}</small></p>`)
    .join("");
  detail.innerHTML = `
    <h3>${report.id} ${statusPill(report.status)}</h3>
    <p><strong>Kelompok:</strong> ${report.groupName} | <strong>Triwulan:</strong> ${report.quarter}/${report.year}</p>
    <p><strong>Ringkasan:</strong> ${report.summary || "-"}</p>
    <p><strong>Lokasi:</strong> ${report.location.name || "-"} (${report.location.lat ?? "?"}, ${report.location.lng ?? "?"})</p>
    <p><strong>Lampiran:</strong> Foto ${report.attachments.photos.length}, Dokumen ${report.attachments.docs.length}</p>
    <div class="timeline">${timeline}</div>
  `;

  const actions = document.getElementById("detailActions");
  actions.innerHTML = "";

  if (activeUser.role === "VERIFIKATOR" && ["SUBMITTED", "UNDER_REVIEW", "REVISED"].includes(report.status)) {
    const approve = document.createElement("button");
    approve.textContent = "Approve";
    approve.onclick = () => updateStatus(report.id, "APPROVED", "Disetujui verifikator");

    const reject = document.createElement("button");
    reject.textContent = "Reject";
    reject.className = "danger";
    reject.onclick = () => {
      const reason = prompt("Alasan penolakan:");
      if (reason) updateStatus(report.id, "REJECTED", reason);
    };
    actions.append(approve, reject);
  }

  if (activeUser.role === "PELAPOR" && report.status === "REJECTED") {
    const reviseBtn = document.createElement("button");
    reviseBtn.textContent = "Tandai Revisi";
    reviseBtn.className = "secondary";
    reviseBtn.onclick = () => updateStatus(report.id, "REVISED", "Revisi oleh pelapor");
    actions.append(reviseBtn);
  }

  if (["APPROVED", "FINAL_SENT"].includes(report.status) && ["BALAI", "VERIFIKATOR", "PELAPOR"].includes(activeUser.role)) {
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export PDF";
    exportBtn.onclick = () => exportPdf(report.id);
    actions.append(exportBtn);
  }

  if (activeUser.role === "BALAI" && report.status === "APPROVED") {
    const finalBtn = document.createElement("button");
    finalBtn.textContent = "Tandai FINAL_SENT";
    finalBtn.onclick = () => updateStatus(report.id, "FINAL_SENT", "Diteruskan ke Balai PS");
    actions.append(finalBtn);
  }
};

window.loadToForm = function loadToForm(id) {
  const report = db.reports.find((r) => r.id === id);
  if (!report) return;
  document.getElementById("reportId").value = report.id;
  document.getElementById("quarterInput").value = report.quarter;
  document.getElementById("yearInput").value = report.year;
  document.getElementById("planningTitle").value = report.planningDoc.title;
  document.getElementById("planningDesc").value = report.planningDoc.description;
  document.getElementById("poaInput").value = report.planningDoc.poaRef.map((p) => `${p.kegiatan}|${p.target}|${p.indikator}`).join("\n");
  document.getElementById("summaryInput").value = report.summary;
  document.getElementById("activityProgressInput").value = report.activities.map((a) => `${a.kegiatan},${a.persen},${a.catatan}`).join("\n");
  document.getElementById("annualLogInput").value = report.annualLog;
  document.getElementById("locationName").value = report.location.name;
  document.getElementById("coordInput").value = `${report.location.lat ?? ""},${report.location.lng ?? ""}`;
  if (report.location.lat && report.location.lng && map) {
    const latlng = L.latLng(report.location.lat, report.location.lng);
    marker?.setLatLng(latlng);
    map.panTo(latlng);
  }
  renderAttachmentPreview(report.attachments);
};

function renderAttachmentPreview(attachments) {
  document.getElementById("attachmentPreview").innerHTML = `
    <strong>Preview Lampiran:</strong>
    <div>Foto: ${attachments.photos.map((f) => f.name).join(", ") || "-"}</div>
    <div>Dokumen: ${attachments.docs.map((f) => f.name).join(", ") || "-"}</div>
  `;
}

function recordNotification(type, to, subject, body) {
  db.notifications.unshift({ type, to, subject, body, timestamp: nowStamp() });
  db.notifications = db.notifications.slice(0, 80);
  saveDb();
  renderNotifications();
}

function updateStatus(reportId, status, comment) {
  const report = db.reports.find((r) => r.id === reportId);
  if (!report) return;

  report.status = status;
  report.updatedAt = nowStamp();
  report.history.push({ status, comment, user: activeUser.name, timestamp: nowStamp() });

  if (["SUBMITTED", "REVISED"].includes(status)) {
    report.status = "UNDER_REVIEW";
    report.history.push({ status: "UNDER_REVIEW", comment: "Masuk antrian verifikasi", user: "System", timestamp: nowStamp() });
    const verifikators = db.accounts.filter((a) => a.role === "VERIFIKATOR");
    verifikators.forEach((v) => recordNotification("EMAIL", v.email, `Laporan ${report.id} masuk`, "Mohon verifikasi laporan baru."));
  }

  if (["APPROVED", "REJECTED"].includes(status)) {
    recordNotification("EMAIL", report.email, `Laporan ${report.id} ${status}`, comment);
  }

  saveDb();
  renderAll();
  if (selectedReportId) openDetail(selectedReportId);
}

function buildReportFromForm() {
  const id = document.getElementById("reportId").value || `LAP-${Date.now()}`;
  const existing = db.reports.find((r) => r.id === id);
  const locationRaw = document.getElementById("coordInput").value.split(",");
  const lat = Number(locationRaw[0]);
  const lng = Number(locationRaw[1]);

  const report = existing || createNewReport();
  report.id = id;
  report.groupName = activeUser.name;
  report.email = activeUser.email;
  report.quarter = document.getElementById("quarterInput").value;
  report.year = Number(document.getElementById("yearInput").value);
  report.planningDoc.title = document.getElementById("planningTitle").value;
  report.planningDoc.description = document.getElementById("planningDesc").value;
  report.planningDoc.poaRef = parsePipeRows(document.getElementById("poaInput").value);
  report.summary = document.getElementById("summaryInput").value;
  report.activities = parseCsvRows(document.getElementById("activityProgressInput").value);
  report.annualLog = document.getElementById("annualLogInput").value;
  report.location = {
    name: document.getElementById("locationName").value,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
  report.attachments = {
    photos: filesToMeta(document.getElementById("photoInput")),
    docs: filesToMeta(document.getElementById("docInput")),
  };
  report.updatedAt = nowStamp();
  return report;
}

function saveDraft(offlineOnly = false) {
  const report = buildReportFromForm();
  if (offlineOnly || !navigator.onLine) {
    const drafts = JSON.parse(localStorage.getItem(OFFLINE_DRAFT_KEY) || "[]");
    const idx = drafts.findIndex((d) => d.id === report.id);
    if (idx >= 0) drafts[idx] = report;
    else drafts.push(report);
    localStorage.setItem(OFFLINE_DRAFT_KEY, JSON.stringify(drafts));
    alert("Draft disimpan offline.");
    return;
  }

  const idx = db.reports.findIndex((r) => r.id === report.id);
  if (idx >= 0) db.reports[idx] = { ...db.reports[idx], ...report };
  else db.reports.push(report);
  if (!db.reports[idx]?.history?.length) {
    db.reports[idx].history = [{ status: "DRAFT", comment: "Draft tersimpan", user: activeUser.name, timestamp: nowStamp() }];
  }
  saveDb();
  renderAll();
  alert("Draft tersimpan.");
}

function submitReport() {
  const report = buildReportFromForm();
  const idx = db.reports.findIndex((r) => r.id === report.id);

  if (idx >= 0) db.reports[idx] = { ...db.reports[idx], ...report };
  else db.reports.push(report);

  const target = db.reports.find((r) => r.id === report.id);
  if (!target.history?.length) target.history = [];
  target.history.push({ status: "SUBMITTED", comment: "Laporan dikirim pelapor", user: activeUser.name, timestamp: nowStamp() });
  saveDb();
  updateStatus(target.id, "SUBMITTED", "Laporan disubmit");
}

function syncOfflineDrafts() {
  if (!navigator.onLine) {
    alert("Masih offline.");
    return;
  }
  const drafts = JSON.parse(localStorage.getItem(OFFLINE_DRAFT_KEY) || "[]");
  drafts.forEach((d) => {
    const idx = db.reports.findIndex((r) => r.id === d.id);
    if (idx >= 0) db.reports[idx] = { ...db.reports[idx], ...d };
    else db.reports.push(d);
    db.reports[idx >= 0 ? idx : db.reports.length - 1].history ||= [];
    db.reports[idx >= 0 ? idx : db.reports.length - 1].history.push({
      status: "DRAFT",
      comment: "Sinkronisasi draft offline",
      user: activeUser?.name || "System",
      timestamp: nowStamp(),
    });
  });
  localStorage.removeItem(OFFLINE_DRAFT_KEY);
  saveDb();
  renderAll();
  alert(`${drafts.length} draft offline tersinkron.`);
}

function exportPdf(reportId) {
  const report = db.reports.find((r) => r.id === reportId);
  if (!report) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(14);
  doc.text("Laporan Triwulan - Balikpapan", 14, 15);
  doc.setFontSize(11);
  doc.text(`ID: ${report.id}`, 14, 25);
  doc.text(`Kelompok: ${report.groupName}`, 14, 32);
  doc.text(`Triwulan/Tahun: ${report.quarter}/${report.year}`, 14, 39);
  doc.text(`Status: ${report.status}`, 14, 46);
  doc.text(`Ringkasan: ${report.summary || "-"}`.slice(0, 120), 14, 53);
  doc.text(`Lokasi: ${report.location.name} (${report.location.lat}, ${report.location.lng})`, 14, 60);

  doc.text("Progress PoA:", 14, 70);
  report.activities.slice(0, 8).forEach((a, i) => {
    doc.text(`${i + 1}. ${a.kegiatan} - ${a.persen}% - ${a.catatan}`.slice(0, 100), 16, 78 + i * 7);
  });

  const y = 78 + Math.min(report.activities.length, 8) * 7 + 10;
  doc.text(`Lampiran Foto: ${report.attachments.photos.map((f) => f.name).join(", ") || "-"}`.slice(0, 110), 14, y);
  doc.text(`Lampiran Dok: ${report.attachments.docs.map((f) => f.name).join(", ") || "-"}`.slice(0, 110), 14, y + 8);
  doc.save(`${report.id}.pdf`);
}

function renderNotifications() {
  const container = document.getElementById("notificationLog");
  container.innerHTML = db.notifications
    .map((n) => `<div>[${n.timestamp}] ${n.type} → ${n.to}: ${n.subject}</div>`)
    .join("") || '<p class="muted">Belum ada notifikasi.</p>';
}

function sendReminder() {
  const overdue = db.reports.filter((r) => ["SUBMITTED", "UNDER_REVIEW"].includes(r.status));
  if (!overdue.length) {
    alert("Tidak ada laporan yang perlu reminder.");
    return;
  }
  db.accounts
    .filter((a) => a.role === "VERIFIKATOR")
    .forEach((a) => recordNotification("REMINDER", a.email, "Reminder verifikasi laporan", `Ada ${overdue.length} laporan menunggu review.`));
  alert("Reminder dikirim (simulasi). ");
}

function renderAccounts() {
  const box = document.getElementById("accountList");
  box.innerHTML = db.accounts
    .map((a) => `<div>${a.name} (${a.role}) - ${a.email} - ${a.group || "-"}</div>`)
    .join("");
  document.getElementById("templateInput").value = db.template;
}

function renderAll() {
  renderKpis();
  renderTrend();
  renderReportList();
  renderNotifications();
  renderAccounts();
}

function setupMap() {
  if (map) return;
  map = L.map("map", {
    maxBounds: [bboxBalikpapan.southWest, bboxBalikpapan.northEast],
  }).setView([-1.2654, 116.8312], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const bounds = L.latLngBounds(bboxBalikpapan.southWest, bboxBalikpapan.northEast);
  L.rectangle(bounds, { color: "#0a7c86", weight: 1 }).addTo(map);

  map.on("click", (ev) => {
    if (!bounds.contains(ev.latlng)) {
      alert("Lokasi harus di area Balikpapan.");
      return;
    }
    marker = marker || L.marker(ev.latlng).addTo(map);
    marker.setLatLng(ev.latlng);
    document.getElementById("coordInput").value = `${ev.latlng.lat.toFixed(6)},${ev.latlng.lng.toFixed(6)}`;
  });
}

function resetForm() {
  const form = document.getElementById("reportForm");
  form.reset();
  document.getElementById("reportId").value = `LAP-${Date.now()}`;
  document.getElementById("yearInput").value = new Date().getFullYear();
  document.getElementById("coordInput").value = "";
  document.getElementById("attachmentPreview").innerHTML = "";
}

function applyRoleVisibility() {
  const role = activeUser?.role;
  const formSection = document.getElementById("reportFormSection");
  const adminSection = document.getElementById("adminSection");

  formSection.classList.toggle("hidden", role !== "PELAPOR");
  adminSection.classList.toggle("hidden", role !== "ADMIN");
}

function attachEvents() {
  document.getElementById("authForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const role = document.getElementById("roleSelect").value;
    const name = document.getElementById("nameInput").value.trim();
    const email = document.getElementById("emailInput").value.trim();
    const region = document.getElementById("regionInput").value.trim() || "Balikpapan";

    activeUser = db.accounts.find((a) => a.email === email) || { id: crypto.randomUUID(), name, email, role, group: region };
    if (!db.accounts.some((a) => a.email === email)) {
      db.accounts.push(activeUser);
      saveDb();
    }

    document.getElementById("activeUser").textContent = activeUser.name;
    document.getElementById("activeRole").textContent = `Peran: ${activeUser.role}`;
    document.getElementById("authSection").classList.add("hidden");
    document.getElementById("appSection").classList.remove("hidden");

    applyRoleVisibility();
    setupMap();
    resetForm();
    renderAll();
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    activeUser = null;
    document.getElementById("appSection").classList.add("hidden");
    document.getElementById("authSection").classList.remove("hidden");
  });

  document.getElementById("saveDraftBtn").addEventListener("click", () => saveDraft());
  document.getElementById("submitReportBtn").addEventListener("click", submitReport);
  document.getElementById("syncBtn").addEventListener("click", syncOfflineDrafts);
  document.getElementById("sendReminderBtn").addEventListener("click", sendReminder);
  document.getElementById("statusFilter").addEventListener("change", renderReportList);
  document.getElementById("yearFilter").addEventListener("input", renderReportList);

  document.getElementById("photoInput").addEventListener("change", () => {
    const docs = filesToMeta(document.getElementById("docInput"));
    const photos = filesToMeta(document.getElementById("photoInput"));
    renderAttachmentPreview({ photos, docs });
  });

  document.getElementById("docInput").addEventListener("change", () => {
    const docs = filesToMeta(document.getElementById("docInput"));
    const photos = filesToMeta(document.getElementById("photoInput"));
    renderAttachmentPreview({ photos, docs });
  });

  document.getElementById("accountForm").addEventListener("submit", (e) => {
    e.preventDefault();
    db.accounts.push({
      id: crypto.randomUUID(),
      name: document.getElementById("accountName").value,
      email: document.getElementById("accountEmail").value,
      role: document.getElementById("accountRole").value,
      group: document.getElementById("accountGroup").value,
    });
    saveDb();
    renderAccounts();
    e.target.reset();
  });

  document.getElementById("templateInput").addEventListener("change", (e) => {
    db.template = e.target.value;
    saveDb();
  });

  window.addEventListener("online", setNetworkBanner);
  window.addEventListener("offline", setNetworkBanner);
}

attachEvents();
setNetworkBanner();
