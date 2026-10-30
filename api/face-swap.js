// /api/face-swap.js - Vercel Serverless Function for Magic Hour API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Upload Base64 to temporary hosting for direct URL access
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

    if (!uploadRes.ok) throw new Error(`Failed to host temporary image (${uploadRes.status})`);
    const uploadJson = await uploadRes.json();
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

    // 1. Get temporary public URLs
    const sourceUrl = await base64ToPublicUrl(sourceImageBase64, 'source.png');
    const targetUrl = await base64ToPublicUrl(targetImageBase64, 'target.png');

    // 2. Submit face swap request
    const submitRes = await fetch('https://api.magichour.ai/v1/face-swap-photo', {
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

    const submitText = await submitRes.text();
    if (!submitRes.ok) {
      return res.status(submitRes.status).json({ error: `Magic Hour API Error (${submitRes.status}): ${submitText}` });
    }

    const submitData = JSON.parse(submitText);
    const jobId = submitData.id;

    if (!jobId) {
      return res.status(500).json({ error: 'Failed to retrieve job ID from Magic Hour', raw: submitData });
    }

    // 3. Fast-poll status (checking every 1 second, max 8 seconds total)
    let imageUrl = null;
    for (let i = 0; i < 8; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const statusRes = await fetch(`https://api.magichour.ai/v1/image-projects/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.MAGIC_HOUR_API_KEY}`
        }
      });

      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();

      if (statusData.downloads && statusData.downloads.length > 0) {
        imageUrl = statusData.downloads[0];
        break;
      }
      if (statusData.status === 'failed') {
        return res.status(500).json({ error: 'Magic Hour processing failed on their servers', raw: statusData });
      }
    }

    if (!imageUrl) {
      return res.status(504).json({ error: 'Magic Hour generation is taking longer than usual. Please try again in a few seconds.' });
    }

    // 4. Send final image back to frontend
    const imgRes = await fetch(imageUrl);
    const imgBuffer = await imgRes.arrayBuffer();

    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(Buffer.from(imgBuffer));

  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
}
