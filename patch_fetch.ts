export async function fetchWithRetry(url: string, options: any, maxRetries = 3, initialDelay = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    const res = await fetch(url, options);
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      attempt++;
      if (attempt >= maxRetries) return res;
      // Exponential backoff with jitter
      const delay = initialDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
      console.log(`HTTP ${res.status} for ${url}. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
    } else {
      return res;
    }
  }
  throw new Error("Unreachable");
}
