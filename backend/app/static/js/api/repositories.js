// Repository previews are optional, public GitHub reads. Challenge creation still
// uses the application's authenticated MCP pipeline; no credential reaches JS.
export function repositoryClient({ owner, repo }, signal) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return async (path = "", params = {}) => {
    const url = new URL(`${base}${path}`);
    url.search = new URLSearchParams(params).toString();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timeout = setTimeout(abort, 12000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: "omit",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (response.status === 404) throw new Error("Repository or branch not found, or preview requires private access.");
      if ([403, 429].includes(response.status)) throw new Error("GitHub preview rate limit or permission limit reached. Try again later.");
      // An empty repository has no commits or Git tree yet.
      if (response.status === 409 && (path === "/commits" || path.startsWith("/git/trees/"))) {
        return { data: path === "/commits" ? [] : { tree: [] }, link: "" };
      }
      if (!response.ok) throw new Error(`GitHub preview failed (${response.status}).`);
      return {
        data: response.status === 204 ? [] : await response.json(),
        link: response.headers.get("Link") || "",
      };
    } catch (error) {
      if (signal.aborted) throw error;
      if (controller.signal.aborted) throw new Error("GitHub preview timed out. Try again.");
      if (error instanceof TypeError) throw new Error("Unable to reach GitHub for the repository preview.");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  };
}
