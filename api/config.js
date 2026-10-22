// Only public browser configuration is returned. Never add a service-role key here.
module.exports = function configHandler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "method_not_allowed" });
  }
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  let legacyAnon = false;
  try { legacyAnon = JSON.parse(Buffer.from(anonKey.split(".")[1], "base64url").toString("utf8")).role === "anon"; } catch {}
  const isPublishable = anonKey?.startsWith("sb_publishable_") || legacyAnon;
  if (!url || !anonKey || !isPublishable || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
    return response.status(503).json({ error: "supabase_not_configured" });
  }
  return response.status(200).json({ url, anonKey });
};
