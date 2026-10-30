// /api/face-swap.js - Vercel Serverless Function for Magic Hour API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Helper function to upload base64 image to temporary host
  async function base64ToPublicUrl(base64Data, filename) {
    const matches = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/png';
    const buffer = Buffer.from(matches ? matches[2] : base64Data, 'base64');

    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('file', blob, filename);

    const uploadRes = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: formData
    });

    if (!uploadRes.ok) {
      throw new Error(`Failed to host temporary image (${uploadRes.status})`);
    }

    const uploadJson = await uploadRes.json();
    // Transform preview link into direct raw image link
    return uploadJson.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
  }

  try {
    if (!process.env.MAGIC_HOUR_API_KEY) {
      return res.status(500).json({ error: 'CRITICAL: MAGIC_HOUR_API_KEY is missing in Vercel environment variables!' });
    }

    const { sourceImageBase64, targetImageBase64 } = req.body;

    if (!sourceImageBase64 || !targetImageBase64) {
      return res.status(400).json({ error: 'Missing image payload from frontend' });
    }

    // Convert Base64 payload into direct public image URLs for Magic Hour
    const sourceUrl = await base64ToPublicUrl(sourceImageBase64, 'source.png');
    const targetUrl = await base64ToPublicUrl(targetImageBase64, 'target.png');

    // Call Magic Hour API with direct URLs
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
          source_file_path: sourceUrl,
          target_file_path: targetUrl
        }
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({ error: `Magic Hour API Error (${response.status}): ${responseText}` });
    }

    const data = JSON.parse(responseText);

    // If Magic Hour immediately returns download links:
    if (data.downloads && data.downloads.length > 0) {
      const imgRes = await fetch(data.downloads[0]);
      const imgBuffer = await imgRes.arrayBuffer();
      
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(Buffer.from(imgBuffer));
    }

    return res.status(500).json({ error: 'Magic Hour job submitted but output not ready immediately.', raw: data });

  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
}
