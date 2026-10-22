(() => {
  const programs = [
    { code: "ABM", name: "Biologie médicale", shortName: "Biologie médicale", status: "Confirmé", note: "Ancien code : BM" },
    { code: "TIC", name: "Génie informatique et télécom", shortName: "Informatique et télécom", status: "Confirmé", note: "Ancien code : GTIC" },
    { code: "PFMI", name: "Procédés de fabrication et maintenance des équipements industriels", shortName: "Fabrication et maintenance industrielle", status: "Confirmé", note: "Code confirmé" },
    { code: "PEA", name: "Génie des procédés d’expertises et analyses", shortName: "Expertises et analyses", status: "À confirmer", note: "Déduit de GPEA" },
    { code: "PP", name: "Génie des procédés de productions industrielles", shortName: "Productions industrielles", status: "À confirmer", note: "Déduit de GPPI" },
    { code: "BBA", name: "Administration des affaires", shortName: "Administration des affaires", status: "À confirmer", note: "Déduit de LPAA" },
    { code: "SJ", name: "Ingénierie juridique", shortName: "Ingénierie juridique", status: "À confirmer", note: "Déduit de SPJ" },
    { code: "NUT", name: "Hygiène, nutrition, santé et environnement", shortName: "Nutrition et environnement", status: "Code proposé", note: "Code court proposé pour la filière nutrition" }
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
    { id: "demo-approved-1", firstName: "Claire", lastName: "Dossou", email: "claire.demo@example.test", phone: "+229 01 90 00 00 01", sex: "F", program: "ABM", level: "LP1", site: "COT", status: "approved", temporaryMatricule: "TMP-261020-K3P8", finalMatricule: "IRGIB-4821F", photo: "", submittedAt: "2026-10-20T09:10:00.000Z", approvedAt: "2026-10-20T10:00:00.000Z", demo: true }
  ];
  const groupKey = (site, program, level) => `${site}-${program}-${level}`;
  const allGroups = () => sites.flatMap(site => programs.flatMap(program => levels.map(level => ({ key: groupKey(site.id, program.code, level), site: site.id, program: program.code, level }))));
  const getProgram = code => programs.find(item => item.code === code) || programs[0];
  const getSite = id => sites.find(item => item.id === id) || sites[0];
  const loadJson = (key, fallback) => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback.map(item => ({ ...item })); } catch { return fallback.map(item => ({ ...item })); } };
  const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const loadApplications = () => loadJson("irgib-campus-applications-v2", demoApplications);
  const saveApplications = value => saveJson("irgib-campus-applications-v2", value);
  const loadProfile = () => { try { return JSON.parse(localStorage.getItem("irgib-campus-profile-v2") || "null"); } catch { return null; } };
  const saveProfile = value => localStorage.setItem("irgib-campus-profile-v2", JSON.stringify(value));
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
  const todayKey = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("fr-CA", { timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    return `${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}-${parts.find(part => part.type === "day").value}`;
  };

  window.IRGIB_DATA = { programs, sites, levels, demoApplications, groupKey, allGroups, getProgram, getSite, loadApplications, saveApplications, loadProfile, saveProfile, loadAttendance, saveAttendance, makeTemporaryMatricule, makeFinalMatricule, todayKey };
})();
