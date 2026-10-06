// Incompatible fixture bundle (should not be executed because host rejects platform version)
if (typeof window !== "undefined" && window.definePlugin) {
  window.definePlugin({
    strategy: {
      check: () => ({ ok: true }),
      decide: (input) => ({
        chosen: [input.options[0]?.id || ""],
        explanation: "Incompatible plugin",
      }),
    },
  });
}
