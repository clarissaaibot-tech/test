// Hands the browser the Google Maps key from the Vercel env var GOOGLE_MAPS_API_KEY.
// A Maps JavaScript/Tiles key is always visible to the browser; protect it by
// restricting it to this site's address in Google Cloud, not by hiding it.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ googleKey: process.env.GOOGLE_MAPS_API_KEY || null }));
};
