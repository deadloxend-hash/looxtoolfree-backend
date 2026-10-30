export default async function handler(req, res) {
  // 1. Enable CORS so your GitHub Pages site can talk to Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 2. Handle browser preflight checks
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. Ensure the incoming request is a POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 4. Forward the raw image data to Photoroom using your hidden API key
    const response = await fetch('https://sdk.photoroom.com/v1/segment', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.PHOTOROOM_API_KEY,
        'Content-Type': req.headers['content-type'] || 'image/png'
      },
      body: req
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    // 5. Send the cutout PNG binary back to your GitHub frontend
    const imageBuffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(Buffer.from(imageBuffer));

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server proxy error' });
  }
}
