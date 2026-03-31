// Vercel Serverless Function — GET /api/shared-data
// Proxies learned_data.json from private GitHub repo using server-side token

const OWNER = process.env.GITHUB_OWNER || "andrey-243"
const REPO  = process.env.GITHUB_REPO  || "lk_sn_url_gen"
const FILE  = "learned_data.json"
const API   = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const token = process.env.GITHUB_TOKEN
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN not configured" })

  try {
    const getRes = await fetch(API, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
    })
    if (!getRes.ok) return res.status(500).json({ error: "Failed to fetch shared data" })
    const fileData = await getRes.json()
    const content = JSON.parse(Buffer.from(fileData.content, "base64").toString("utf8"))
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300")
    return res.status(200).json(content)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
