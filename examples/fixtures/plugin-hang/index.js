// Hanging fixture bundle: never resolves to test timeout teardown
if (typeof window !== "undefined" && window.definePlugin) {
  window.definePlugin({
    strategy: {
      check: () => ({ ok: true }),
      decide: () =>
        new Promise(() => {
          // Intentionally never resolve or reject
        }),
    },
  });
}
