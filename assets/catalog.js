(() => {
  const programs = [
    { code: "ABM", name: "Biologie médicale", shortName: "Biologie médicale", englishName: "Medical biology", status: "Confirmé", note: "Ancien code : BM" },
    { code: "TIC", name: "Génie informatique et télécom", shortName: "Informatique et télécom", englishName: "Computer science and telecom", status: "Confirmé", note: "Ancien code : GTIC" },
    { code: "PFMI", name: "Procédés de fabrication et maintenance des équipements industriels", shortName: "Fabrication et maintenance industrielle", englishName: "Industrial manufacturing and maintenance", status: "Confirmé", note: "Code confirmé" },
    { code: "PEA", name: "Génie des procédés d’expertises et analyses", shortName: "Expertises et analyses", englishName: "Expertise and analysis", status: "À confirmer", note: "Déduit de GPEA" },
    { code: "PP", name: "Génie des procédés de productions industrielles", shortName: "Productions industrielles", englishName: "Industrial production processes", status: "À confirmer", note: "Déduit de GPPI" },
    { code: "BBA", name: "Administration des affaires", shortName: "Administration des affaires", englishName: "Business administration", status: "À confirmer", note: "Déduit de LPAA" },
    { code: "SJ", name: "Ingénierie juridique", shortName: "Ingénierie juridique", englishName: "Legal engineering", status: "À confirmer", note: "Déduit de SPJ" },
    { code: "NUT", name: "Hygiène, nutrition, santé et environnement", shortName: "Nutrition et environnement", englishName: "Hygiene, nutrition, health and environment", status: "Code proposé", note: "Code court proposé pour la filière nutrition" }
  ];
  const sites = [
    { id: "COT", city: "Cotonou", zone: "01", points: [{ name: "Siège", address: "Rue 1886, derrière Immeuble Air France, route de l’Aéroport", phone: "+229 01 99 19 00 85" }, { name: "Akpakpa", address: "Campus Universitaire", phone: "+229 01 96 17 19 10" }] },
    { id: "CAL", city: "Calavi", zone: "02", points: [{ name: "Centre d’application", address: "Centre d’application", phone: "+229 01 96 17 19 10" }] },
    { id: "PNV", city: "Porto-Novo", zone: "03", points: [{ name: "Centre d’application", address: "Centre d’application", phone: "+229 01 66 66 65 27" }] },
    { id: "PRK", city: "Parakou", zone: "03", points: [{ name: "Centre d’application", address: "Centre d’application", phone: "+229 01 97 80 06 71" }] },
    { id: "DJG", city: "Djougou", zone: "04", points: [{ name: "Centre d’application", address: "Centre d’application", phone: "+229 55 55 08 08" }] }
  ];
  const levels = ["LP1", "LP2", "LP3", "M1", "M2"];
  const demoApplications = [
    { id: "demo-pending-1", firstName: "Mariam", lastName: "Adéyè", email: "mariam.demo@example.test", phone: "+229 01 90 00 00 03", sex: "F", program: "BBA", level: "LP3", site: "CAL", status: "pending", temporaryMatricule: "TMP-261022-A7C9", finalMatricule: "", photo: "", submittedAt: "2026-10-22T08:30:00.000Z", demo: true },
    { id: "demo-approved-1", firstName: "Claire", lastName: "Dossou", email: "claire.demo@example.test", phone: "+229 01 90 00 00 01", sex: "F", birthDate: "2005-01-15", program: "ABM", level: "LP1", site: "COT", status: "approved", temporaryMatricule: "TMP-261020-K3P8", finalMatricule: "IRGIB-4821F", photo: "", submittedAt: "2026-10-20T09:10:00.000Z", approvedAt: "2026-10-20T10:00:00.000Z", demo: true }
  ];
  const groupKey = (site, program, level) => `${site}-${program}-${level}`;
  const allGroups = () => sites.flatMap(site => programs.flatMap(program => levels.map(level => ({ key: groupKey(site.id, program.code, level), site: site.id, program: program.code, level }))));
  const getProgram = code => programs.find(item => item.code === code) || programs[0];
  const getSite = id => sites.find(item => item.id === id) || sites[0];
  const loadJson = (key, fallback) => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback.map(item => ({ ...item })); } catch { return fallback.map(item => ({ ...item })); } };
  const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const loadApplications = () => loadJson("irgib-campus-applications-v2", demoApplications);
  const saveApplications = value => saveJson("irgib-campus-applications-v2", value);
  const loadProfile = email => {
    try {
      if (email) {
        const saved = localStorage.getItem(`irgib-campus-profile-v2:${encodeURIComponent(email.toLowerCase())}`);
        if (saved) return JSON.parse(saved);
      }
      const legacy = JSON.parse(localStorage.getItem("irgib-campus-profile-v2") || "null");
      return !email || legacy?.email?.toLowerCase() === email.toLowerCase() ? legacy : null;
    } catch { return null; }
  };
  const saveProfile = value => {
    const serialized = JSON.stringify(value);
    localStorage.setItem("irgib-campus-profile-v2", serialized);
    if (value?.email) localStorage.setItem(`irgib-campus-profile-v2:${encodeURIComponent(value.email.toLowerCase())}`, serialized);
  };
  const loadAttendance = () => loadJson("irgib-campus-attendance-v2", []);
  const saveAttendance = value => saveJson("irgib-campus-attendance-v2", value);
  const makeTemporaryMatricule = applications => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 500; attempt++) {
      const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      const candidate = `TMP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${suffix}`;
      if (!applications.some(item => item.temporaryMatricule === candidate)) return candidate;
    }
    throw new Error("Impossible de créer un matricule temporaire libre.");
  };
  const makeFinalMatricule = applications => {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const digits = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
      const suffix = Math.random() < 0.5 ? "F" : "B";
      const candidate = `IRGIB-${digits}${suffix}`;
      if (!applications.some(item => item.finalMatricule === candidate)) return candidate;
    }
    throw new Error("Le stock de matricules libres est épuisé.");
  };
  const academicYear = "2026-2027";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const formatBirth = value => {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    const fr = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date);
    const en = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
    return `${fr} / ${en}`;
  };
  const cardHtml = (app, qrId) => {
    const program = getProgram(app.program);
    const site = getSite(app.site);
    const esc = escapeHtml;
    const matricule = app.finalMatricule || "À APPROUVER";
    const sex = app.sex === "F" ? "Féminin / Female" : "Masculin / Male";
    const photo = app.photo ? `<img src="${app.photo}" alt="Photo de ${esc(app.firstName)} ${esc(app.lastName)}">` : `<div class="card-v2-photo-placeholder">PHOTO</div>`;
    const points = site.points.map(point => `<div class="card-v2-point"><small>${esc(point.name)}</small><strong>${esc(point.address)}</strong><b>${esc(point.phone)}</b></div>`).join("");
    return `<article class="student-card id-card-front card-v2 card-v2-front"><header class="card-v2-header"><img class="card-v2-logo" src="../assets/blason.jpg" alt="Blason IRGIB AFRICA"><div class="card-v2-brand"><strong>UNIVERSITÉ IRGIB-AFRICA</strong><span>IRGIB AFRICA UNIVERSITY</span><small>CARTE ÉTUDIANTE / STUDENT CARD</small></div></header><div class="card-v2-main"><div class="card-v2-portrait">${photo}<div class="card-v2-matricule"><small>MATRICULE / STUDENT ID</small><strong>${esc(matricule)}</strong></div></div><div class="card-v2-details"><div class="card-v2-field"><small>NOM / SURNAME</small><strong class="card-v2-name">${esc(String(app.lastName || "").toUpperCase())}</strong></div><div class="card-v2-field"><small>PRÉNOM / FIRST NAME</small><strong>${esc(app.firstName)}</strong></div><div class="card-v2-field"><small>DATE DE NAISSANCE / DATE OF BIRTH</small><strong>${formatBirth(app.birthDate)}</strong></div><div class="card-v2-field"><small>SEXE / SEX</small><strong>${esc(sex)}</strong></div><div class="card-v2-field"><small>FILIÈRE / PROGRAM</small><strong>${esc(program.shortName)}</strong><em>${esc(program.englishName || "")}</em></div><div class="card-v2-field"><small>NIVEAU / LEVEL</small><strong>${esc(app.level)}</strong></div></div><div class="card-v2-verification"><div class="card-v2-qr" id="${esc(qrId)}"></div><strong>SCANNEZ POUR VÉRIFIER</strong><small>SCAN TO VERIFY</small></div></div><footer class="card-v2-footer"><strong>${esc(site.city.toUpperCase())} - BÉNIN</strong><span>ANNÉE ACADÉMIQUE ${academicYear}</span><a href="https://www.irgibafrica.university/" target="_blank" rel="noopener noreferrer">www.irgibafrica.university</a></footer></article><article class="student-card id-card-front card-back card-v2 card-v2-back"><header class="card-v2-back-head"><strong>IRGIB AFRICA UNIVERSITY</strong></header><div class="card-v2-back-body"><div class="card-v2-back-points">${points}</div><div class="card-v2-back-block"><small>Filière / Program</small><strong>${esc(program.shortName)}</strong><em>${esc(program.englishName || "")}</em></div></div><footer class="card-v2-back-footer"><span>Carte personnelle · à présenter sur le campus<em>Personal card · to be presented on campus</em></span><div class="card-v2-back-mark"><img src="../assets/blason.jpg" alt=""><b>IRGIB AFRICA</b></div></footer></article>`;
  };
  const todayKey = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("fr-CA", { timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    return `${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}-${parts.find(part => part.type === "day").value}`;
  };

  window.IRGIB_DATA = { programs, sites, levels, academicYear, demoApplications, groupKey, allGroups, getProgram, getSite, loadApplications, saveApplications, loadProfile, saveProfile, loadAttendance, saveAttendance, makeTemporaryMatricule, makeFinalMatricule, formatBirth, cardHtml, todayKey };
})();
