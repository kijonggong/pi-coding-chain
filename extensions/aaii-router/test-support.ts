/** Simple SDK package boundary shared by component and router integration tests. */
const PI_TUI_STUB = `
let customCancel;

export function setCustomCancelBinding(key) {
  customCancel = key;
}

export function matchesKey(data, keyId) {
  switch (keyId) {
    case "up": return data === "\\x1b[A";
    case "down": return data === "\\x1b[B";
    case "shift+up": return data === "\\x1b[1;2A";
    case "shift+k": return data === "K";
    case "shift+down": return data === "\\x1b[1;2B";
    case "shift+j": return data === "J";
    case "enter": return data === "\\r";
    case "escape": return data === "\\x1b";
    default: return data === keyId;
  }
}

export function getKeybindings() {
  return {
    matches(data, binding) {
      return binding === "tui.select.cancel" && data === customCancel;
    },
  };
}
`;

const SDK_STUB = `
export const VIRTUAL_MODEL_STATE_ENTRY = "virtual_model_state";
`;

export function sdkStubPackages(directory: string) {
  return Object.fromEntries([
    ["@earendil-works/pi-tui", PI_TUI_STUB],
    ["@earendil-works/pi-coding-agent", `${SDK_STUB}\nexport const getAgentDir = () => ${JSON.stringify(directory)};\n`],
  ].map(([name, body]) => [name, {
    "package.json": JSON.stringify({ name, type: "module", exports: { ".": "./index.js" } }),
    "index.js": body,
  }]));
}
