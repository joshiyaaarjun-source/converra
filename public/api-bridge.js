// CONVERRA API bridge.
// The supplied prototype currently calculates demo values in-browser.
// Use these helpers when replacing individual local calculations with API calls.
const CONVERRA_API = window.CONVERRA_API || `${location.origin}/api`;

async function converraFetch(path, options = {}) {
  const res = await fetch(`${CONVERRA_API}${path}`, {
    headers: {"Content-Type":"application/json", ...(options.headers || {})},
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "CONVERRA API request failed");
  return data;
}
