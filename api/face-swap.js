// /api/face-swap.js - Vercel Serverless Function (Debug Version)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Check if API key exists in backend runtime
    if (!process.env.SEGMIND_API_KEY) {
      return res.status(500).json({ error: 'CRITICAL: SEGMIND_API_KEY is missing in Vercel environment variables!' });
    }

    const { sourceImageBase64, targetImageBase64 } = req.body;

    if (!sourceImageBase64 || !targetImageBase64) {
      return res.status(400).json({ error: 'Missing image payload from frontend' });
    }

    const cleanSource = sourceImageBase64.replace(/^data:image\/\w+;base64,/, '');
    const cleanTarget = targetImageBase64.replace(/^data:image\/\w+;base64,/, '');

    const response = await fetch('https://api.segmind.com/v1/faceswap-v2', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.SEGMIND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_img: cleanSource,
        target_img: cleanTarget,
        base64: true,
        face_restore: 'codeformer-v0.1.0.pth'
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      // Return the exact error message from Segmind or Vercel
      return res.status(response.status).json({ error: `Segmind API Error (${response.status}): ${responseText}` });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse JSON from Segmind response', raw: responseText });
    }
    
    if (data.image) {
      const imgBuffer = Buffer.from(data.image, 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(imgBuffer);
    }

    return res.status(500).json({ error: 'Invalid response structure from provider', raw: data });

  } catch (err) {
    return res.status(500).json({ error: 'Internal Exception: ' + err.message });
  }
}
