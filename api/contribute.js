// Vercel Serverless Function — POST /api/contribute
// Merges contribution data into learned_data.json via GitHub API
// Requires env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO

const OWNER = process.env.GITHUB_OWNER || "andrey-243"
const REPO  = process.env.GITHUB_REPO  || "lk_sn_url_gen"
const FILE  = "learned_data.json"
const API   = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const token = process.env.GITHUB_TOKEN
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN not configured" })

  try {
    const contribution = req.body
    if (!contribution) return res.status(400).json({ error: "No data provided" })

    // 1. Fetch current file from GitHub
    const getRes = await fetch(API, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
    })
    if (!getRes.ok) return res.status(500).json({ error: "Failed to fetch current data" })
    const fileData = await getRes.json()
    const current = JSON.parse(Buffer.from(fileData.content, "base64").toString("utf8"))
    const sha = fileData.sha

    // 2. Merge contribution into current data
    const merged = mergeData(current, contribution)
    merged.last_updated = new Date().toISOString().split("T")[0]
    merged.version = (current.version || 1)

    // 3. Push updated file back to GitHub
    const encoded = Buffer.from(JSON.stringify(merged, null, 2)).toString("base64")
    const putRes = await fetch(API, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `chore: merge contribution [${new Date().toISOString()}]`,
        content: encoded,
        sha
      })
    })
    if (!putRes.ok) {
      const err = await putRes.json()
      return res.status(500).json({ error: "Failed to push update", detail: err })
    }

    return res.status(200).json({ success: true, merged })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

function mergeData(base, incoming) {
  const out = {
    version: base.version || 1,
    last_updated: base.last_updated || "",
    geo_ids: { ...(base.geo_ids || {}) },
    titles: JSON.parse(JSON.stringify(base.titles || {})),
    keywords: JSON.parse(JSON.stringify(base.keywords || {}))
  }

  // Merge geo_ids — high confidence wins
  Object.entries(incoming.geo_ids || {}).forEach(([name, val]) => {
    if (!out.geo_ids[name] || (val.confidence === "high" && out.geo_ids[name].confidence !== "high")) {
      out.geo_ids[name] = val
    }
  })

  // Merge titles
  Object.entries(incoming.titles || {}).forEach(([key, val]) => {
    if (!out.titles[key]) out.titles[key] = { include: [], sector: [], exclude: [] }
    ;["include", "sector", "exclude"].forEach(field => {
      ;(val[field] || []).forEach(t => { if (!out.titles[key][field].includes(t)) out.titles[key][field].push(t) })
    })
  })

  // Merge keywords
  Object.entries(incoming.keywords || {}).forEach(([key, terms]) => {
    if (!out.keywords[key]) out.keywords[key] = []
    ;(terms || []).forEach(t => { if (!out.keywords[key].includes(t)) out.keywords[key].push(t) })
  })

  return out
}
