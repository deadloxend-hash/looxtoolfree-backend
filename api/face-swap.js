// /api/face-swap.js - Vercel Serverless Function for Magic Hour API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!process.env.MAGIC_HOUR_API_KEY) {
      return res.status(500).json({ error: 'CRITICAL: MAGIC_HOUR_API_KEY is missing in Vercel environment variables!' });
    }

    const { sourceImageBase64, targetImageBase64 } = req.body;

    if (!sourceImageBase64 || !targetImageBase64) {
      return res.status(400).json({ error: 'Missing image payload from frontend' });
    }

    // 1. Step one with Magic Hour usually requires getting an upload URL or passing direct base64 if supported.
    // Let's call Magic Hour's Face Swap Photo endpoint:
    const response = await fetch('https://api.magichour.ai/v1/face-swap-photo', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MAGIC_HOUR_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: "LOOX Face Swap",
        assets: {
          face_swap_mode: "all-faces",
          source_file_path: sourceImageBase64,
          target_file_path: targetImageBase64
        }
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({ error: `Magic Hour API Error (${response.status}): ${responseText}` });
    }

    const data = JSON.parse(responseText);

    // Magic Hour returns a project ID / job. If it provides output files directly or a download link:
    if (data.downloads && data.downloads.length > 0) {
      const imgUrl = data.downloads[0];
      const imgRes = await fetch(imgUrl);
      const imgBuffer = await imgRes.arrayBuffer();
      
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(Buffer.from(imgBuffer));
    }

    return res.status(500).json({ error: 'Job initiated, but no immediate download returned. Check async job flow.', raw: data });

  } catch (err) {
    return res.status(500).json({ error: 'Internal Exception: ' + err.message });
  }
}
