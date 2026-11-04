export function parseModels(output) {
  return [...new Set(output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(s=>s.trim()).filter(s=>s && s!=='MODEL'))]
    .filter(s=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s));
}
export function modelId(name) { return name === 'Auto' ? 'auto' : name === 'Fast' ? 'fast' : name; }
